# ParentMap Family Calendar Map

Interactive map of the full ParentMap events calendar (parentmap.com/calendar):
Leaflet map with numbered pins, synced sidebar, date-range slider, and the
calendar's filters (Region / Ages / Category / Free / search). Defaults to
today · Eastside · Free. Every event has "Add to Google Calendar" links.

**This package is standalone.** It shares no files with the Weekender map app
and works on its own — as a double-click page, a local folder, or its own
GitHub repo. (Optional: you can drop it into the Weekender repo; see the last
section.)

## What's inside
| File | Purpose |
|---|---|
| `index.html` | The whole app (UI + live data fetching) |
| `lib/parse-calendar.cjs` | Parser: ParentMap REST API → normalized events + venue geocoding |
| `scrape-calendar.cjs` | Writes `calendar-events.json` + `venues-cache.json` |
| `.github/workflows/refresh-calendar.yml` | Daily 6 a.m. Pacific data refresh on GitHub |

## Run it locally

**Option A — just open the page (no install).**
Double-click `index.html`. It fetches events straight from the ParentMap API
(needs internet). Pins appear instantly at approximate city locations, then
sharpen in the background; your browser caches the sharpened locations, so
later opens are precise immediately.

**Option B — with pre-scraped data (needs Node 18+, https://nodejs.org).**
```
node scrape-calendar.cjs 30        # 30-day window; writes calendar-events.json
```
First run takes a few minutes (geocodes every venue once; the cache makes
later runs fast). Then serve the folder — browsers won't let a double-clicked
page read local JSON, so use any static server:
```
npx serve .            # or: python -m http.server 8000
```
and open the printed URL. The page auto-detects `calendar-events.json` and
uses its precise, pre-geocoded pins.

## Set up on GitHub (auto-refresh + phone access, ~5 min)

1. Create a new GitHub repo and push **all files, keeping the folder layout**
   (`.github/workflows/` must sit at the repo root).
2. Repo → Settings → Actions → General → Workflow permissions →
   **Read and write permissions** → Save. (Lets the Action commit data.)
3. Actions tab → *Refresh calendar data* → **Run workflow**. First run takes a
   few minutes (geocoding); it commits `calendar-events.json` +
   `venues-cache.json`. It then runs daily at 6 a.m. Pacific automatically.
4. Settings → Pages → Source: *Deploy from a branch* → `main`, `/ (root)` →
   Save. App goes live at `https://<user>.github.io/<repo>/`.
5. iPhone: open that URL in Safari → Share → **Add to Home Screen**.

To change the data window, edit `30` (days) in the workflow's scrape step, or
`DAYS = 21` in `index.html` (live mode).

## Optional: merging into the existing Weekender repo
All filenames are namespaced (`parse-calendar.cjs`, `refresh-calendar.yml`,
`calendar-events.json`), so nothing collides — copy everything in, but rename
`index.html` to `calendar.html` so it doesn't overwrite the Weekender page.
