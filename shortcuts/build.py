#!/usr/bin/env python3
"""Build and sign a shortcut from its Cherri source.

    python3 build.py "Kcal Deficit.cherri"

Steps:
1. Compile with Cherri (unsigned).
2. Fix numbers in Health filters: Cherri reads dictionary literals as JSON
   and writes every number as a decimal (4.0). iOS saves these filter values
   as whole numbers (4), and the "Weight" filter is not recognized otherwise
   (it falls back to "Steps, last 7 days").
3. Sign: on macOS with `shortcuts sign`, elsewhere with RoutineHub's
   signing service (HubSign, the same service Cherri uses on Linux).

Needs Cherri (https://cherrilang.org), Python 3 and curl.
"""

import json
import os
import plistlib
import subprocess
import sys
import tempfile

HUBSIGN_URL = "https://hubsign.routinehub.services/sign"


def to_int(value):
    """Turn whole-number floats into ints, recursively."""
    if isinstance(value, dict):
        return {k: to_int(v) for k, v in value.items()}
    if isinstance(value, list):
        return [to_int(v) for v in value]
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def fix_filters(shortcut):
    for action in shortcut["WFWorkflowActions"]:
        params = action["WFWorkflowActionParameters"]
        if "WFContentItemFilter" in params:
            params["WFContentItemFilter"] = to_int(params["WFContentItemFilter"])


def sign(xml, name, out_path):
    if sys.platform == "darwin":
        with tempfile.TemporaryDirectory() as tmp:
            unsigned = os.path.join(tmp, "unsigned.shortcut")
            with open(unsigned, "wb") as f:
                f.write(xml)
            subprocess.run(["shortcuts", "sign", "-i", unsigned, "-o", out_path, "-m", "anyone"], check=True)
        return
    body = json.dumps({"shortcutName": name, "shortcut": xml.decode("utf-8")}).encode("utf-8")
    result = subprocess.run(
        ["curl", "-sS", "--fail-with-body", "-X", "POST", HUBSIGN_URL,
         "-H", "Content-Type: application/json", "--data-binary", "@-", "--max-time", "60"],
        input=body, capture_output=True,
    )
    signed = result.stdout
    if result.returncode != 0 or not signed.startswith(b"AEA1"):
        sys.exit("Signing failed: " + (result.stderr or signed[:200]).decode("utf-8", "replace"))
    with open(out_path, "wb") as f:
        f.write(signed)


def main():
    if len(sys.argv) != 2 or not sys.argv[1].endswith(".cherri"):
        sys.exit(__doc__)
    source = os.path.abspath(sys.argv[1])
    folder = os.path.dirname(source)
    name = os.path.basename(source)[: -len(".cherri")]
    unsigned = os.path.join(folder, name + "_unsigned.shortcut")

    subprocess.run(["cherri", source, "--skip-sign", "--no-ansi"], check=True, cwd=folder)
    try:
        with open(unsigned, "rb") as f:
            shortcut = plistlib.load(f)
    finally:
        if os.path.exists(unsigned):
            os.remove(unsigned)

    fix_filters(shortcut)
    xml = plistlib.dumps(shortcut, fmt=plistlib.FMT_XML)
    out_path = os.path.join(folder, name + ".shortcut")
    sign(xml, name, out_path)
    print(f"Built {out_path}")


if __name__ == "__main__":
    main()
