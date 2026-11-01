// Kcal Deficit Widget for Scriptable
// https://github.com/DarthQuintus/scriptable-kcal-widget
//
// Shows the 7-day averages of calorie expenditure, calorie intake,
// deficit/surplus and macronutrients from Apple Health.
//
// Scriptable cannot access Apple Health, so an Apple Shortcut reads the data
// and saves it as "kcal.json" in iCloud Drive/Scriptable. This script reads
// that file and draws the widget.
//
// Expected keys in kcal.json (German keys are accepted as well):
//   Expenditure (Bedarf), Active (Aktiv), Intake (Aufnahme),
//   Protein, Fat (Fett), Carbs (Kohlenhydrate), Weight (Gewicht)
//
// Tapping the widget opens Scriptable, runs the shortcut, waits until it has
// finished, reads the new data and requests a widget update.
//
// MIT License – Copyright (c) 2026 Anton Angierski

// ---------- Settings ----------
const LANGUAGE = "en";            // "en" or "de"
const FILE = "kcal.json";         // file name in iCloud Drive/Scriptable
const SHORTCUT = "Kcal Deficit";  // name of the shortcut started on tap
const STALE_HOURS = 26;           // data older than this is marked orange
const REFRESH_MIN = 15;           // requested widget update interval (iOS decides in the end)

// ---------- Body weight ----------
const WEIGHT_KG = null;           // fallback if the shortcut does not provide a weight, e.g. 80
const TARGET_WEIGHT_KG = null;    // optional: base protein on target weight (useful with significant overweight)

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
// Fat in % of calories eaten (reference range 20–35 %)
//   < 15 red · 15–20 orange · 20–30 darkGreen · 30–35 lightGreen
//   35–40 yellow · 40–45 orange · ≥ 45 red
const LEVELS_FAT = [
  [15, "red"], [20, "orange"], [30, "darkGreen"], [35, "lightGreen"],
  [40, "yellow"], [45, "orange"], [Infinity, "red"],
];
// Carbs: not rated (they fill the remaining calories) → gray

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
    intakeShort: "In",
    expenditureShort: "Out",
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
    intakeShort: "Auf.",
    expenditureShort: "Bed.",
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

// ---------- Refresh on tap ----------
// The widget opens scriptable:///run/<script>?refresh=1
const qp = (args && args.queryParameters) || {};
if (!config.runsInWidget && qp.refresh) {
  try {
    const cb = new CallbackURL("shortcuts://x-callback-url/run-shortcut");
    cb.addParameter("name", SHORTCUT);
    await cb.open(); // waits until the shortcut has finished
  } catch (e) {
    console.log("Shortcut error: " + e);
  }
}

// ---------- Load data ----------
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

// ---------- Rate macros ----------
function level(value, levels) {
  for (const [limit, color] of levels) if (value < limit) return C[color];
  return C.sub;
}
const refWeight = TARGET_WEIGHT_KG ?? d.weight;
// Calories from macros (protein/carbs 4 kcal/g, fat 9 kcal/g); fallback: intake
const macroKcal = (d.protein ?? 0) * 4 + (d.fat ?? 0) * 9 + (d.carbs ?? 0) * 4;
const kcalBase = macroKcal > 0 ? macroKcal : d.intake;

// info[k] = { text, color } – shown next to the grams
const info = { protein: null, fat: null, carbs: null };
if (d.protein != null && refWeight) {
  const gkg = Math.round((d.protein / refWeight) * 10) / 10; // color matches the displayed number
  info.protein = {
    text: gkg.toLocaleString(T.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " g/kg",
    color: level(gkg, LEVELS_PROTEIN),
  };
}
if (d.fat != null && kcalBase) {
  const p = Math.round((d.fat * 9 / kcalBase) * 100);
  info.fat = { text: p + " %", color: level(p, LEVELS_FAT) };
}
if (d.carbs != null && kcalBase) {
  const p = Math.round((d.carbs * 4 / kcalBase) * 100);
  info.carbs = { text: p + " %", color: C.sub };
}

// Targets for the large widget
const target = {
  proteinMin: refWeight ? refWeight * 1.6 : null,
  proteinOpt: refWeight ? refWeight * 2.0 : null,
  fatMin: kcalBase ? kcalBase * 0.20 / 9 : null,
  fatMax: kcalBase ? kcalBase * 0.30 / 9 : null,
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

// ---------- Helpers ----------
function txt(stack, s, font, color, lines = 1) {
  const t = stack.addText(s);
  t.font = font;
  t.textColor = color;
  t.lineLimit = lines;
  t.minimumScaleFactor = 0.5;
  return t;
}
function row(stack, label, value, unit, big) {
  const r = stack.addStack();
  r.centerAlignContent();
  txt(r, label, Font.systemFont(big ? 15 : 13), C.sub);
  r.addSpacer(8);
  r.addSpacer();
  txt(r, `${value} ${unit}`, Font.semiboldSystemFont(big ? 16 : 14), C.text);
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
// Macros: protein left, fat center, carbs right – grams plus colored rating
function macros(stack, big) {
  const m = stack.addStack();
  m.bottomAlignContent();
  const items = [
    ["P", d.protein, info.protein],
    ["F", d.fat, info.fat],
    [T.carbs, d.carbs, info.carbs],
  ];
  items.forEach(([label, g, p], i) => {
    if (i > 0) m.addSpacer();
    const cell = m.addStack();
    cell.bottomAlignContent();
    txt(cell, label, Font.mediumSystemFont(big ? 14 : 12), C.sub);
    cell.addSpacer(3);
    txt(cell, `${fmt(g)} g`, Font.boldRoundedSystemFont(big ? 20 : 17), C.text);
    if (p != null) {
      cell.addSpacer(4);
      txt(cell, p.text, Font.semiboldRoundedSystemFont(big ? 15 : 13), p.color);
    }
  });
}

// ---------- Build widget ----------
const family = config.widgetFamily || "medium";
const big = family === "large";
const w = new ListWidget();
w.url = `scriptable:///run/${encodeURIComponent(Script.name())}?refresh=1`;
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
  w.setPadding(12, 14, 12, 14);

  if (error) {
    header(w, family === "small", big);
    w.addSpacer();
    txt(w, error, Font.systemFont(13), C.orange, 4);
    w.addSpacer();
  } else if (family === "small") {
    header(w, true, false);
    w.addSpacer();
    txt(w, defValue, Font.boldRoundedSystemFont(44), defColor);
    txt(w, "kcal " + defLabel, Font.systemFont(12), C.sub);
    w.addSpacer();
    txt(w, `${T.intakeShort} ${fmt(d.intake)} · ${T.expenditureShort} ${fmt(d.expenditure)}`, Font.systemFont(11), C.sub);
    txt(w, updatedText, Font.systemFont(10), isStale ? C.orange : C.sub);
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

    // right column fills the space up to the right edge
    const right = main.addStack();
    right.layoutVertically();
    row(right, T.expenditure, fmt(d.expenditure), "kcal", big);
    right.addSpacer(4);
    row(right, T.active, fmt(d.active), "kcal", big);
    right.addSpacer(4);
    row(right, T.intake, fmt(d.intake), "kcal", big);

    w.addSpacer();
    macros(w, big);

    if (big) {
      // large widget: also show target ranges
      w.addSpacer(10);
      txt(w, `${T.target}: P ${fmt(target.proteinMin)}–${fmt(target.proteinOpt)}+ g · F ${fmt(target.fatMin)}–${fmt(target.fatMax)} g`,
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
