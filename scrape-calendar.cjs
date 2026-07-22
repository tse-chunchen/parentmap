// scrape-calendar.js
// Fetches the full ParentMap calendar for a date window, geocodes venues,
// and writes calendar-events.json + venues-cache.json.
// Usage: node scrape-calendar.js [days]   (default 30)

const fs = require('fs');
const path = require('path');
const { fetchWindow, normalize, geocodeVenues } = require('./lib/parse-calendar.cjs');

const DAYS = parseInt(process.argv[2] || '30', 10);
const OUT = path.join(__dirname, 'calendar-events.json');
const CACHE = path.join(__dirname, 'venues-cache.json');

(async () => {
  const start = new Date();
  const end = new Date(Date.now() + DAYS * 864e5);
  const fmt = d => d.toISOString().slice(0, 10);

  console.log(`Fetching ParentMap calendar ${fmt(start)} -> ${fmt(end)}`);
  const raw = await fetchWindow(fmt(start), fmt(end), { log: console.log });
  const events = normalize(raw);
  console.log(`${raw.length} occurrences -> ${events.length} unique events`);

  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch (_) {}
  await geocodeVenues(events, cache, { log: console.log });
  fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1));

  const payload = {
    generated: new Date().toISOString(),
    window: { start: fmt(start), end: fmt(end) },
    events,
  };
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 1));
  const mapped = events.filter(e => e.lat != null).length;
  console.log(`Wrote ${OUT}: ${events.length} events (${mapped} mapped, ${events.length - mapped} unmapped/virtual)`);
})().catch(e => { console.error(e); process.exit(1); });
