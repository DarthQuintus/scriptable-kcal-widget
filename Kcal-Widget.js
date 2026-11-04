// Kcal Deficit Widget for Scriptable
// https://github.com/DarthQuintus/scriptable-kcal-widget
//
// Shows the 7-day averages of calorie expenditure, calorie intake,
// deficit/surplus and macronutrients from Apple Health, plus today's totals
// (intake and macros) in gray. Protein and fat are rated in g per kg body
// weight, each with a small color scale and a marker.
//
// Scriptable cannot access Apple Health, so an Apple Shortcut reads the data
// and saves it as "kcal.json" in iCloud Drive/Scriptable. This script reads
// that file and draws the widget.
//
// Expected keys in kcal.json (German keys are accepted as well):
//   7-day averages: Expenditure (Bedarf), Active (Aktiv), Intake (Aufnahme),
//                   Protein, Fat (Fett), Carbs (Kohlenhydrate), Weight (Gewicht)
//   today's totals (optional): TodayIntake (HeuteAufnahme), TodayProtein (HeuteProtein),
//                   TodayFat (HeuteFett), TodayCarbs (HeuteKohlenhydrate)
//
// Today's totals are only shown if the file contains them. If the file was not
// written today (e.g. after midnight), they are shown as 0.
//
// The widget only reads the file – it never runs the shortcut. Run the shortcut
// after logging food (and e.g. via a daily automation shortly after midnight),
// ideally only on the device that logs the data. Tapping the widget opens
// Scriptable and downloads the latest file from iCloud.
//
// MIT License – Copyright (c) 2026 Anton Angierski

// ---------- Settings ----------
const LANGUAGE = "en";            // "en" or "de"
const FILE = "kcal.json";         // file name in iCloud Drive/Scriptable
const STALE_HOURS = 26;           // data older than this is marked orange
const REFRESH_MIN = 15;           // requested widget update interval (iOS decides in the end)

// ---------- Body weight ----------
const WEIGHT_KG = null;           // fallback if the shortcut does not provide a weight, e.g. 80
const TARGET_WEIGHT_KG = null;    // optional: base protein and fat on target weight (useful with significant overweight)

// ---------- Rating levels (goal: lose fat, build muscle) ----------
// Format: [upper limit (exclusive), color] – ascending
//
// Protein in g per kg body weight
//   < 0.8    red          below the general recommendation (RDA)
//   0.8–1.2  orange       enough for health, hardly for muscle growth
//   1.2–1.6  yellow       more protein still improves muscle growth
//   1.6–2.0  lightGreen   plateau for muscle gain (Morton et al. 2018: ~1.6 g/kg)
//   ≥ 2.0    darkGreen    helps preserve muscle in a deficit (ISSN: up to 2.3–3.1)
const LEVELS_PROTEIN = [
  [0.8, "red"], [1.2, "orange"], [1.6, "yellow"], [2.0, "lightGreen"], [Infinity, "darkGreen"],
];
// Fat in g per kg body weight
//   The lower limits are well founded (~0.5–0.6 g/kg minimum for hormones and
//   fat-soluble vitamins). There is no fixed upper limit – too much fat mainly
//   crowds out protein and carbs, so the upper levels are a rule of thumb.
//   < 0.5 red · 0.5–0.6 orange · 0.6–0.8 yellow · 0.8–1.2 darkGreen
//   1.2–1.4 yellow · 1.4–1.6 orange · ≥ 1.6 red
const LEVELS_FAT = [
  [0.5, "red"], [0.6, "orange"], [0.8, "yellow"], [1.2, "darkGreen"],
  [1.4, "yellow"], [1.6, "orange"], [Infinity, "red"],
];
// Carbs: not rated (they fill the remaining calories)
// Today's totals: not rated (a day in progress would almost always look "too low") → gray

// Range of the color scales below the ratings (values outside sit at the edge)
const SCALE_PROTEIN = { min: 0.4, max: 2.4, levels: LEVELS_PROTEIN };
const SCALE_FAT = { min: 0.2, max: 1.8, levels: LEVELS_FAT };

// ---------- Texts ----------
const TEXTS = {
  en: {
    locale: "en-US",
    dateFormat: "MM/dd HH:mm",
    title: "🔥 Kcal · 7-day average",
    titleSmall: "🔥 7-day avg",
    updated: "Updated",
    deficit: "deficit / day",
    surplus: "surplus / day",
    perDay: "kcal/day",
    expenditure: "Expenditure",
    active: "thereof active",
    intake: "Intake",
    today: "today",
    carbs: "C",
    target: "Target",
    noData: "Kcal: no data",
    noWeight: "No weight – add it to the shortcut or set WEIGHT_KG.",
    missingFile: "kcal.json is missing – run the shortcut once.",
  },
  de: {
    locale: "de-DE",
    dateFormat: "dd.MM. HH:mm",
    title: "🔥 Kcal · Ø letzte 7 Tage",
    titleSmall: "🔥 Ø 7 Tage",
    updated: "Stand",
    deficit: "Defizit / Tag",
    surplus: "Überschuss / Tag",
    perDay: "kcal/Tag",
    expenditure: "Energiebedarf",
    active: "davon aktiv",
    intake: "Aufnahme",
    today: "heute",
    carbs: "KH",
    target: "Ziel",
    noData: "Kcal: keine Daten",
    noWeight: "Kein Gewicht – im Kurzbefehl ergänzen oder WEIGHT_KG setzen.",
    missingFile: "kcal.json fehlt – Kurzbefehl einmal ausführen.",
  },
};
const T = TEXTS[LANGUAGE] || TEXTS.en;

const C = {
  bg: Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e")),
  text: Color.dynamic(new Color("#1c1c1e"), Color.white()),
  sub: Color.dynamic(new Color("#6e6e73"), new Color("#98989d")),
  // 5-level rating
  darkGreen: Color.dynamic(new Color("#1e9e46"), new Color("#30c45a")),
  lightGreen: Color.dynamic(new Color("#7cb518"), new Color("#b5e655")),
  yellow: Color.dynamic(new Color("#c9a400"), new Color("#ffd60a")),
  orange: new Color("#ff9f0a"),
  red: new Color("#ff453a"),
  green: new Color("#30d158"),
};
// Scale colors (images cannot switch between light and dark mode)
const SCALE_COLORS = {
  red: "#ff453a", orange: "#ff9f0a", yellow: "#ffd60a", lightGreen: "#a8dc3c", darkGreen: "#30c45a",
};

// ---------- Load data ----------
// In the app (e.g. after tapping the widget) the file is fetched from iCloud;
// in the widget, iOS only gives a few seconds, so the local copy may be older.
const fm = FileManager.iCloud();
const path = fm.joinPath(fm.documentsDirectory(), FILE);
let data = null, updatedAt = null, error = null;

try {
  if (!fm.fileExists(path)) throw new Error(T.missingFile);
  await fm.downloadFileFromiCloud(path);
  data = JSON.parse(fm.readString(path));
  updatedAt = fm.modificationDate(path);
} catch (e) {
  error = e.message;
}

// Reads the first existing key (English or German) as a number
function num(...keys) {
  if (!data) return null;
  for (const key of keys) {
    if (data[key] == null) continue;
    const n = parseFloat(String(data[key]).replace(",", "."));
    if (!isNaN(n)) return n;
  }
  return null;
}
function fmt(n) {
  return n == null ? "–" : Math.round(n).toLocaleString(T.locale);
}
function fmt1(n) {
  return n.toLocaleString(T.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

const d = {
  expenditure: num("Expenditure", "Bedarf"),
  active: num("Active", "Aktiv"),
  intake: num("Intake", "Aufnahme"),
  deficit: null,
  protein: num("Protein"),
  fat: num("Fat", "Fett"),
  carbs: num("Carbs", "Kohlenhydrate"),
  weight: num("Weight", "Gewicht") ?? WEIGHT_KG,
};

// Deficit = expenditure − intake (positive = deficit, negative = surplus)
if (d.expenditure != null && d.intake != null) {
  d.deficit = d.expenditure - d.intake;
}

// ---------- Today's totals ----------
const TODAY_KEYS = {
  intake: ["TodayIntake", "HeuteAufnahme"],
  protein: ["TodayProtein", "HeuteProtein"],
  fat: ["TodayFat", "HeuteFett"],
  carbs: ["TodayCarbs", "HeuteKohlenhydrate"],
};
// Only shown if the shortcut provides them at all
const hasToday = !!data && Object.values(TODAY_KEYS).flat().some((k) => k in data);
// File from an earlier day (e.g. after midnight) → nothing eaten yet today → 0
const fileIsFromToday = !!updatedAt && updatedAt.toDateString() === new Date().toDateString();
const today = {};
for (const [k, keys] of Object.entries(TODAY_KEYS)) {
  today[k] = !hasToday ? null : fileIsFromToday ? (num(...keys) ?? 0) : 0;
}

// ---------- Rate macros ----------
function levelName(value, levels) {
  for (const [limit, color] of levels) if (value < limit) return color;
  return null;
}
const refWeight = TARGET_WEIGHT_KG ?? d.weight;

// info[k] = { text, color, value, scale } – shown next to the grams, scale below
function rate(grams, scale) {
  if (grams == null || !refWeight) return null;
  const gkg = Math.round((grams / refWeight) * 10) / 10; // color matches the displayed number
  const name = levelName(gkg, scale.levels);
  return { text: fmt1(gkg) + " g/kg", color: name ? C[name] : C.sub, value: gkg, scale };
}
const info = {
  protein: rate(d.protein, SCALE_PROTEIN),
  fat: rate(d.fat, SCALE_FAT),
};

// Targets for the large widget
const target = {
  proteinMin: refWeight ? refWeight * 1.6 : null,
  proteinOpt: refWeight ? refWeight * 2.0 : null,
};

const isDeficit = d.deficit == null || d.deficit >= 0;
const defColor = isDeficit ? C.green : C.orange;
const defLabel = isDeficit ? T.deficit : T.surplus;
const defValue = d.deficit == null ? "–" : fmt(Math.abs(d.deficit));

let updatedText = "";
let isStale = false;
if (updatedAt) {
  const df = new DateFormatter();
  df.dateFormat = T.dateFormat;
  updatedText = T.updated + " " + df.string(updatedAt);
  isStale = (Date.now() - updatedAt.getTime()) / 36e5 > STALE_HOURS;
}

// ---------- Color scale ----------
function hexToRgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToColor([r, g, b]) {
  return new Color("#" + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join(""));
}
// One color stop in the middle of each level (clipped to the scale range),
// so the color below the marker matches the color of the rating text.
function scaleStops(s) {
  const stops = [];
  let lo = -Infinity;
  for (const [limit, name] of s.levels) {
    const a = Math.max(lo, s.min), b = Math.min(limit, s.max);
    if (b > a) stops.push([(a + b) / 2, hexToRgb(SCALE_COLORS[name])]);
    lo = limit;
  }
  return stops;
}
function colorAt(v, stops) {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [p1, c1] = stops[i];
    if (v <= p1) {
      const [p0, c0] = stops[i - 1];
      const t = (v - p0) / (p1 - p0);
      return c0.map((x, j) => x + (c1[j] - x) * t);
    }
  }
  return stops[stops.length - 1][1];
}
// Gradient bar with rounded ends and a small marker at the value
function scaleImage(value, s, width, height) {
  const ctx = new DrawContext();
  ctx.size = new Size(width, height);
  ctx.opaque = false;
  ctx.respectScreenScale = true;

  const stops = scaleStops(s);
  const cy = 5.5;          // vertical center of bar and marker (bar sits close below the text)
  const barH = 5, r = barH / 2, step = 0.5;
  for (let x = 0; x < width; x += step) {
    const xc = x + step / 2;
    // round off both ends
    let dy = 0;
    const edge = Math.min(xc, width - xc);
    if (edge < r) dy = r - Math.sqrt(r * r - (r - edge) * (r - edge));
    const v = s.min + (xc / width) * (s.max - s.min);
    ctx.setFillColor(rgbToColor(colorAt(v, stops)));
    ctx.fillRect(new Rect(x, cy - r + dy, step + 0.3, barH - 2 * dy));
  }

  // marker: white with a dark outline, visible on every color
  const pos = Math.min(Math.max((value - s.min) / (s.max - s.min), 0), 1);
  const mx = Math.min(Math.max(pos * width, 2), width - 2);
  const outer = new Path();
  outer.addRoundedRect(new Rect(mx - 2, cy - 5, 4, 10), 1.5, 1.5);
  ctx.addPath(outer);
  ctx.setFillColor(new Color("#000000", 0.6));
  ctx.fillPath();
  const inner = new Path();
  inner.addRoundedRect(new Rect(mx - 1, cy - 4, 2, 8), 1, 1);
  ctx.addPath(inner);
  ctx.setFillColor(Color.white());
  ctx.fillPath();

  return ctx.getImage();
}

// ---------- Helpers ----------
function txt(stack, s, font, color, lines = 1) {
  const t = stack.addText(s);
  t.font = font;
  t.textColor = color;
  t.lineLimit = lines;
  t.minimumScaleFactor = 0.5;
  return t;
}
function row(stack, label, value, big) {
  const r = stack.addStack();
  r.centerAlignContent();
  txt(r, label, Font.systemFont(big ? 15 : 13), C.sub);
  r.addSpacer(8);
  r.addSpacer();
  txt(r, value, Font.semiboldSystemFont(big ? 16 : 14), C.text);
}
function header(w, small, big) {
  const h = w.addStack();
  h.centerAlignContent();
  txt(h, small ? T.titleSmall : T.title, Font.boldSystemFont(small ? 13 : big ? 17 : 15), C.text);
  if (!small) {
    h.addSpacer();
    txt(h, updatedText, Font.systemFont(big ? 12 : 11), isStale ? C.orange : C.sub);
  }
}
// Macros: protein left, fat center, carbs right – grams plus colored g/kg rating.
// Second line: today's grams in gray below the average grams (if provided)
// and a color scale below each rating.
function macros(stack, big) {
  const m = stack.addStack();
  m.bottomAlignContent();
  const secondFont = Font.semiboldRoundedSystemFont(big ? 14 : 12);
  const secondH = big ? 17 : 14;  // about the line height of secondFont
  const scaleW = big ? 62 : 52;   // about as wide as the rating text

  // One column per part with two lines. Columns without a visible second line
  // get an invisible one of the same height, so all first lines stay on one baseline.
  function col(cell, s, font, color, below) {
    const c = cell.addStack();
    c.layoutVertically();
    txt(c, s, font, color);
    if (below && below.scale) {
      const img = c.addImage(scaleImage(below.value, below.scale, scaleW, secondH));
      img.imageSize = new Size(scaleW, secondH);
    } else {
      txt(c, below ?? "0", secondFont, below == null ? Color.clear() : C.sub);
    }
  }

  const items = [
    ["P", d.protein, info.protein, today.protein],
    ["F", d.fat, info.fat, today.fat],
    [T.carbs, d.carbs, null, today.carbs],
  ];
  items.forEach(([label, g, p, t], i) => {
    if (i > 0) m.addSpacer();
    const cell = m.addStack();
    cell.bottomAlignContent();
    col(cell, label, Font.mediumSystemFont(big ? 14 : 12), C.sub, null);
    cell.addSpacer(3);
    col(cell, `${fmt(g)} g`, Font.boldRoundedSystemFont(big ? 20 : 17), C.text, hasToday ? `${fmt(t)} g` : null);
    if (p != null) {
      cell.addSpacer(4);
      col(cell, p.text, Font.semiboldRoundedSystemFont(big ? 15 : 13), p.color, p);
    }
  });
}

// ---------- Build widget ----------
const family = config.widgetFamily || "medium";
const big = family === "large";
const w = new ListWidget();
// Tap: open Scriptable and run this script there (downloads the latest file)
w.url = `scriptable:///run/${encodeURIComponent(Script.name())}`;
w.refreshAfterDate = new Date(Date.now() + REFRESH_MIN * 60 * 1000);

if (family === "accessoryRectangular" || family === "accessoryInline") {
  // Lock screen
  if (error) {
    txt(w, T.noData, Font.systemFont(12), Color.white());
  } else if (family === "accessoryInline") {
    txt(w, `🔥 ${isDeficit ? "−" : "+"}${defValue} ${T.perDay}`, Font.systemFont(12), Color.white());
  } else {
    txt(w, `🔥 Ø ${defLabel}`, Font.systemFont(11), Color.white());
    txt(w, `${defValue} kcal`, Font.boldSystemFont(16), Color.white());
    txt(w, `P ${fmt(d.protein)} · F ${fmt(d.fat)} · ${T.carbs} ${fmt(d.carbs)}`, Font.systemFont(11), Color.white());
  }
} else {
  w.backgroundColor = C.bg;
  // a little less vertical padding in the medium widget to fit today's lines
  if (family === "medium" && hasToday) w.setPadding(10, 14, 10, 14);
  else w.setPadding(12, 14, 12, 14);

  if (error) {
    header(w, family === "small", big);
    w.addSpacer();
    txt(w, error, Font.systemFont(13), C.orange, 4);
    w.addSpacer();
  } else if (family === "small") {
    // small: only the big deficit/surplus number
    w.addSpacer();
    txt(w, defValue, Font.boldRoundedSystemFont(44), defColor);
    txt(w, "kcal · " + defLabel, Font.systemFont(12), C.sub);
    w.addSpacer();
  } else {
    // medium & large
    header(w, false, big);
    w.addSpacer();

    const main = w.addStack();
    main.centerAlignContent();

    const left = main.addStack();
    left.layoutVertically();
    txt(left, defValue, Font.boldRoundedSystemFont(big ? 56 : 44), defColor);
    txt(left, "kcal · " + defLabel, Font.systemFont(big ? 14 : 12), C.sub);

    main.addSpacer(18);

    // right column fills the space up to the right edge; the unit "kcal"
    // is shown once, right-aligned above the first number
    const gap = big || !hasToday ? 4 : 2;
    const right = main.addStack();
    right.layoutVertically();
    const unit = right.addStack();
    unit.addSpacer();
    txt(unit, "kcal", Font.systemFont(big ? 13 : 11), C.sub);
    row(right, T.expenditure, fmt(d.expenditure), big);
    right.addSpacer(gap);
    row(right, T.active, fmt(d.active), big);
    right.addSpacer(gap);
    row(right, T.intake, fmt(d.intake), big);
    if (hasToday) {
      // today's intake, right-aligned below the average intake
      right.addSpacer(1);
      const r = right.addStack();
      r.addSpacer();
      txt(r, `${T.today} ${fmt(today.intake)}`, Font.systemFont(big ? 13 : 11), C.sub);
    }

    w.addSpacer();
    macros(w, big);

    if (big) {
      // large widget: also show target ranges
      w.addSpacer(10);
      txt(w, `${T.target}: P ${fmt(target.proteinMin)}–${fmt(target.proteinOpt)}+ g · F ${fmt1(0.8)}–${fmt1(1.2)} g/kg`,
          Font.mediumSystemFont(14), C.sub);
      if (refWeight == null) {
        txt(w, T.noWeight, Font.systemFont(12), C.orange, 2);
      }
      w.addSpacer();
    }
  }
}

if (config.runsInWidget) {
  Script.setWidget(w);
} else {
  if (family === "large") await w.presentLarge();
  else await w.presentMedium();
}
Script.complete();
