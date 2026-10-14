# ❄️ Winter Arc

A tracker for your Winter Arc challenge, built as an installable web app (PWA). There's no build step and no server, and your data stays on your device.

- **Today**: a 10-second check-in. Tap pills to tick habits, +/− steppers for water and steps, one-tap workout logging with your usual duration (Undo in the toast), body and food numbers, and notes. Habits linked to health data complete themselves; "Train" ticks when you log a workout.
- **Workouts**: lifts with sets × reps × kg per session, a per-exercise history with estimated 1RM trend and PR detection, "Copy last" to repeat a session, and the full history grouped by week.
- **Review**: a weekly review page: the week's numbers vs the previous week, what worked / what to change, and a plan for next week (one focus habit plus training days). Planned days show on Today.
- **Progress**: switch between Week, 30-day and whole-challenge views. Includes a calendar heatmap, streaks, per-habit completion, and charts for workout minutes, steps, sleep, resting HR, weight and active energy.
- **Insights**: rule-based nudges such as streak at risk, weakest habit, planned-session reminders, PRs and stale lifts, protein/calorie targets, goal-weight pace, sleep debt, resting-HR/HRV drift and best training day.
- **Share**: a one-tap text summary of any week to send to a friend or group chat.
- **Reminders**: a calendar file (.ics) with a daily check-in and an 8 pm alarm, plus in-app notifications.
- **Health sync**: one-tap sync from an iPhone Shortcut via a URL, Apple Health export (`export.zip` / `export.xml`), Google Fit Takeout CSV, and any daily CSV (Health Connect, Health Auto Export, Fitbit, Garmin, MyFitnessPal, spreadsheets).

## Run it

```bash
npx http-server -c-1 .     # or: python3 -m http.server
# open http://localhost:8080
```

Opening `index.html` directly also works, but offline mode and notifications need http(s).

**Put it on your phone:** host the folder on any static host. For GitHub Pages, go to Settings → Pages → deploy from `main` / root. Then open the URL in Safari, tap **Share → Add to Home Screen**, and it runs full-screen and works offline.

## Health data: what's possible and what isn't

Apple HealthKit and Google Health Connect are on-device APIs, and only native apps can use them. **No website can read them directly or sync them in the background.** So this app imports the files those platforms export:

| Source | How |
|---|---|
| iPhone Shortcut (one tap, can be automated daily) | The app accepts `?sync=steps=2026-10-13:12034,…;sleep=…;rhr=…;weight=…;kcal=…;protein=…` on its URL. The Health tab has step-by-step instructions for a Shortcut that builds that URL from the last 7 days of Health data and opens it. |
| Apple Health | Health app → profile picture → *Export All Health Data* → choose `export.zip` on the Health tab. It's streamed and parsed in the browser, so multi-GB exports work. |
| Google Fit | takeout.google.com → *Fit* → `Daily activity metrics.csv` |
| Health Connect, Samsung, Fitbit, Garmin | export daily summaries as CSV. Apps like *Health Sync* (Android) and *Health Auto Export* (iOS) can do this on a schedule. |

Steps from iPhone and Apple Watch are de-duplicated by taking the larger source per day, which approximates Health's own merge. Sleep is credited to the morning you wake up.

## Reminders: what to expect

There's no backend, so nothing can push a notification while the app is closed. The **.ics calendar file** is the reliable option: your phone's calendar fires the alarms. In-app notifications fire only while the app is open or backgrounded.

## Data

Everything is kept in `localStorage` in the browser you use. Use **Settings → Export backup** regularly and to move between devices. Clearing site data or using a different browser starts you fresh.

## Develop

```
index.html            app shell + workout dialog
css/styles.css        light/dark theme, mobile tabs → desktop sidebar
js/store.js           state, persistence, dates, streak/score calculations
js/health-import.js   Apple Health XML/ZIP streaming parser, CSV importer
js/insights.js        insight rules
js/charts.js          dependency-free SVG charts
js/strength.js        lift history, estimated 1RM, PRs, weekly tonnage
js/reminders.js       notifications + .ics generation
js/app.js             router and views
sw.js                 offline cache
```

Run the tests with `node --test tests/*.test.js`.
