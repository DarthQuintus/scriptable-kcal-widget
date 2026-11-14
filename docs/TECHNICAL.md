# Technical details

This page explains how the Kcal Deficit Widget works internally. For installation, see the [README](../README.md).

## Architecture

Scriptable cannot access Apple Health. So an **Apple Shortcut** reads the data
and saves it as `kcal.json`, and the **Scriptable script** reads that file and draws the widget.

```
Apple Health ──▶ Shortcut ──▶ iCloud Drive/Scriptable/kcal.json ──▶ Scriptable widget
```

## What the widget shows

- **Average deficit or surplus per day** (expenditure − intake): green for a deficit, orange for a surplus
- **Expenditure** (resting + active energy), thereof active, and **intake** (all in kcal)
- **Macros**: protein (P), fat (F) and carbs (C) in grams. Protein and fat are rated in g per kg body weight, each with a color scale and a marker for a quick read. Carbs are not rated.
- **Today** (optional): today's intake below the average intake, and today's grams below each macro, in gray and without a rating (a day in progress would almost always look "too low"). After midnight they show 0 until the shortcut runs again.
- **Updated**: time of the last update (orange if older than 26 hours)

The small widget shows only the deficit or surplus. The large widget adds target ranges for protein (in grams) and fat (in g/kg).
Supported sizes: small, medium, large, plus lock screen (rectangular and inline).
The interface is available in English and German (`LANGUAGE` setting).

## Macro rating

Both in g per kg body weight:

| Color | Protein | Fat |
|---|---|---|
| dark green | ≥ 2.0 | 0.8–1.2 |
| light green | 1.6–2.0 | – |
| yellow | 1.2–1.6 | 0.6–0.8 or 1.2–1.4 |
| orange | 0.8–1.2 | 0.5–0.6 or 1.4–1.6 |
| red | < 0.8 | < 0.5 or ≥ 1.6 |

The color scales cover 0.4–2.4 g/kg (protein, red → green) and 0.2–1.8 g/kg (fat, red → green → red). Values outside the range put the marker at the edge.

Carbs are not rated. They fill the remaining calories and have no fixed target.

Background:
- Protein: above roughly 1.6 g/kg, more protein adds little extra muscle gain during resistance training ([Morton et al. 2018](https://pubmed.ncbi.nlm.nih.gov/28698222/)). In a calorie deficit, higher amounts can help preserve muscle ([ISSN Position Stand 2017](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5477153/)). So there is no penalty at the top end.
- Fat: a minimum of roughly 0.5–0.6 g/kg supports hormone production and the uptake of fat-soluble vitamins. There is no fixed upper limit per kg – too much fat mainly crowds out protein and carbs, so the upper levels are a rule of thumb (with typical intakes, 0.8–1.2 g/kg is in line with the reference range of 20–35 % of energy, [AMDR](https://pressbooks.umn.edu/sleepeatandexercise/?p=279)). Fat is rated per kg instead of as a share of calories, because the share shifts with total intake even when the amount of fat stays the same.

The widget only gives guidance and is not a substitute for professional nutrition advice.

## The "Kcal Deficit" shortcut

Source: [`shortcuts/Kcal Deficit.cherri`](../shortcuts/Kcal%20Deficit.cherri). It needs no AI and runs in a few seconds.

### How it works

You do not need to build it by hand, but these are the steps it performs (useful if you want to change it or build it yourself in the Shortcuts app).

#### a) Fixed day boundaries

These make the values match the weekly averages in the Health app. The current, unfinished day is left out on purpose, because a half day would lower every average.

| # | Action | Setting | Name the result |
|---|---|---|---|
| 1 | `Current Date` | – | |
| 2 | `Adjust Date` | *Get Start of Day* → today at 00:00 | **End** |
| 3 | `Adjust Date` | *Subtract* 7 *days* from **End** | **Start** |

#### b) One Health query per value

Add a `Find Health Samples` action for each of these types:

| Type | Unit | Average used for |
|---|---|---|
| Resting Energy | kcal | `Expenditure` |
| Active Energy | kcal | `Expenditure`, `Active` |
| Dietary Energy | kcal | `Intake` |
| Protein | g | `Protein` |
| Total Fat | g | `Fat` |
| Carbohydrates | g | `Carbs` |

Use the same settings in every query:
- Filter: **Start Date is between** *Start* and *End*
- Group By: **Day**
- **Fill Missing: off**. Otherwise days without entries count as 0. That matters most for intake: a day you did not log would make your deficit look bigger than it is.
- Sort By: *None*, Limit: *off*

After each query:
1. `Calculate Statistics`: **Average** of the samples
2. `Round Number`: to a whole number

Then calculate the expenditure with `Calculate`: average resting energy **+** average active energy.

#### c) Weight

`Find Health Samples` with type *Weight*, Start Date *in the last 99 years*, Unit *kg*, Sort By *Start Date*, Order *Latest First*, Limit *1*.
If you do not track your weight in Health, skip this and set `WEIGHT_KG` in the script instead.

#### d) Today's totals (optional)

Add a `Find Health Samples` action for *Dietary Energy*, *Protein*, *Total Fat* and *Carbohydrates* with the filter **Start Date is today** and **no grouping**.
After each query: `Calculate Statistics` → **Sum**, then `Round Number`.
If you skip this, the widget simply shows no today values.

#### e) Save the result

1. A **Dictionary** with these keys (values as numbers):

   | Key | Content |
   |---|---|
   | `Expenditure` | average resting + active energy (kcal) |
   | `Active` | average active energy (kcal) |
   | `Intake` | average dietary energy (kcal) |
   | `Protein` | average protein (g) |
   | `Fat` | average fat (g) |
   | `Carbs` | average carbohydrates (g) |
   | `Weight` | current weight (kg) |
   | `TodayIntake` | optional: today's dietary energy (kcal) |
   | `TodayProtein`, `TodayFat`, `TodayCarbs` | optional: today's macros (g) |

   The German keys `Bedarf`, `Aktiv`, `Aufnahme`, `Fett`, `Kohlenhydrate`, `Gewicht`, `HeuteAufnahme`, `HeuteProtein`, `HeuteFett` and `HeuteKohlenhydrate` work as well.
2. **Save File**: destination *iCloud Drive/Scriptable*, subpath `kcal.json`, "Ask Where to Save" off, **Overwrite** on.

**Using more than one device (e.g. iPad):** Shortcuts sync via iCloud, but Health data on an iPad can lag behind or be incomplete. If the shortcut runs there, it overwrites `kcal.json` with wrong values. That is why the shortcut starts with `Get Device Details` (*Device Model*) → `If` *Device Model* *is not* *iPhone* → `Stop This Shortcut`. The widget itself works on every device, because it only reads the file.

Example of a resulting `kcal.json`:

```json
{
  "Expenditure": 1828,
  "Active": 323,
  "Intake": 1221,
  "Protein": 58,
  "Fat": 52,
  "Carbs": 126,
  "Weight": 80,
  "TodayIntake": 640,
  "TodayProtein": 35,
  "TodayFat": 22,
  "TodayCarbs": 70
}
```

## Updating


- **Automatically**: run the shortcut at the end of the shortcut you use to log meals (see [Logging meals with AI](#the-nutrition-tracking-shortcut)) (action *Run Shortcut*, "Show When Run" off). If you log food with another app, an automation with the trigger *App › Is Closed* (for that app) runs it. Health data cannot be read while the iPhone is locked, so automations based only on time of day are unreliable.
- **Tapping the widget** opens Scriptable and loads the latest `kcal.json` from iCloud. It does not run the shortcut – the averages only cover completed days and today's totals only change when you log food, which already runs the shortcut.
- The widget asks iOS for an update every 15 minutes. When it is actually redrawn is up to iOS (often less frequently on an iPad). On other devices, the widget also depends on how quickly iCloud Drive syncs the file.

Because only completed days are counted, the averages change once a day (the first time the shortcut runs after midnight), or when you add entries for a past day.

## The "Nutrition Tracking" shortcut

Source: [`shortcuts/Nutrition Tracking.cherri`](../shortcuts/Nutrition%20Tracking.cherri). It needs a device with Apple Intelligence (`Use Model` action).

### How it works

| # | Action | Setting |
|---|---|---|
| 1 | `Choose from Menu` | prompt: *"What did you eat?"*, options **Text**, **Photo** and **Text + Photo** |
| 2 | ↳ **Text**: `Ask for Input` | prompt *"Describe your meal"* → variable **Description** |
| 3 | ↳ **Photo**: `Take Photo` | 1 photo → variable **Photo** |
| 4 | ↳ **Text + Photo** | `Take Photo` and `Ask for Input`, both variables |
| 5 | `Use Model` (Apple Intelligence, Private Cloud Compute) | output type *Dictionary*; prompt below |
| 6 | `Get Dictionary Value` ×4 | keys `calories`, `fat`, `carbs`, `protein` from the model's *Response* |
| 7 | `Choose from Menu` | shows the estimate, *"Log this meal?"* **Yes** / **No** |
| 8 | ↳ **Yes**: `Log Health Sample` ×4 | *Dietary Energy* (kcal), *Total Fat* (g), *Carbohydrates* (g), *Protein* (g), each with the matching value; date left empty = now |
| 9 | ↳ **Yes**: `Run Shortcut` | **Kcal Deficit**, "Show When Run" off |
| 10 | ↳ **No**: `Show Result`, `Stop This Shortcut` | *"Logging cancelled."* |

Prompt for step 5:

```text
Analyze this food input and return ONLY a JSON-formatted answer with the keys
'calories', 'fat', 'carbs' and 'protein'. The values must be plain numbers
(calories in kcal, macros in grams).
Input:
Description: [Description]
Photo: [Photo]
```

Tips:
- The output type *Dictionary* keeps the model from wrapping its answer in a code block or adding text, which would make `Get Dictionary Value` fail.
- AI estimates from a description or photo can be well off, especially for oil, sauces and portion sizes. Weighing food and using nutrition labels is more accurate.
- Remove the confirmation menu (step 7) if you do not want to confirm every entry.

## Building the shortcuts from source

Both shortcuts are written in [Cherri](https://cherrilang.org) and live in [`shortcuts/`](../shortcuts):

| Source | Shortcut |
|---|---|
| [`Kcal Deficit.cherri`](../shortcuts/Kcal%20Deficit.cherri) | [`Kcal Deficit.shortcut`](../shortcuts/Kcal%20Deficit.shortcut) |
| [`Nutrition Tracking.cherri`](../shortcuts/Nutrition%20Tracking.cherri) | [`Nutrition Tracking.shortcut`](../shortcuts/Nutrition%20Tracking.shortcut) |

To change a shortcut, edit the `.cherri` file and compile it:

```sh
cd shortcuts
python3 build.py "Kcal Deficit.cherri"
```

[`build.py`](../shortcuts/build.py) needs Cherri, Python 3 and curl. It compiles the file with Cherri, turns the numbers in the Health filters into whole numbers (Cherri writes them as decimals like `4.0`, and iOS then does not recognize the *Weight* filter), and signs the result. iOS only imports signed shortcuts: on a Mac the script uses the built-in `shortcuts sign` command, on other systems RoutineHub's signing service (HubSign).
Cherri has no built-in Health actions yet, so `Find Health Samples`, `Log Health Sample`, `Calculate Statistics` and the Scriptable target folder of `Save File` are declared as custom actions with their raw Shortcuts parameters at the top of each file.

## Settings in the script

| Constant | Default | Meaning |
|---|---|---|
| `LANGUAGE` | `"en"` | interface language: `"en"` or `"de"` |
| `FILE` | `kcal.json` | file name in iCloud Drive/Scriptable |
| `STALE_HOURS` | `26` | data older than this is marked orange |
| `REFRESH_MIN` | `15` | requested update interval in minutes |
| `WEIGHT_KG` | `null` | fallback weight if the shortcut does not provide one |
| `TARGET_WEIGHT_KG` | `null` | base protein and fat on the target weight (useful with significant overweight) |
| `LEVELS_PROTEIN`, `LEVELS_FAT` | see above | limits of the color levels |
| `SCALE_PROTEIN`, `SCALE_FAT` | see above | range of the color scales |

## Notes and limitations

- Calorie values are estimates. The Apple Watch can be noticeably off on expenditure, and food logs are rarely complete. The most reliable check is your weight trend over several weeks.
- The shortcut cannot detect partially logged days. They lower the average intake.
- If the watch was not worn for part of a day, resting energy for that day is too low as well.

