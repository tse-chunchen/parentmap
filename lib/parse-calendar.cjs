// lib/parse-calendar.js
// Parser for the full ParentMap calendar (The Events Calendar REST API).
// Unlike the Weekender parser (HTML + Google Maps URL regex), the calendar
// exposes a clean JSON API: /wp-json/tribe/events/v1/events
// Venue records carry street addresses but no coordinates, so venues are
// geocoded via Nominatim with a persistent cache (venues-cache.json).

const API = 'https://www.parentmap.com/wp-json/tribe/events/v1/events';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

// City -> ParentMap region heuristic (region taxonomy isn't exposed by the API)
const REGION_CITIES = {
  'Seattle': ['seattle', 'shoreline', 'lake forest park'],
  'Eastside': ['bellevue', 'kirkland', 'redmond', 'issaquah', 'sammamish',
    'bothell', 'woodinville', 'mercer island', 'newcastle', 'duvall',
    'north bend', 'snoqualmie', 'carnation', 'fall city', 'kenmore',
    'medina', 'clyde hill', 'preston'],
  'North Sound': ['everett', 'lynnwood', 'edmonds', 'mukilteo', 'marysville',
    'snohomish', 'mill creek', 'mountlake terrace', 'arlington', 'monroe',
    'lake stevens', 'stanwood', 'granite falls', 'brier', 'tulalip',
    'mount vernon', 'burlington', 'anacortes', 'bellingham', 'la conner'],
  'South Sound': ['tacoma', 'puyallup', 'federal way', 'kent', 'auburn',
    'renton', 'tukwila', 'seatac', 'burien', 'des moines', 'fife',
    'lakewood', 'olympia', 'lacey', 'tumwater', 'gig harbor', 'bonney lake',
    'sumner', 'maple valley', 'covington', 'enumclaw', 'dupont',
    'university place', 'spanaway', 'graham', 'orting', 'milton', 'edgewood',
    'normandy park', 'black diamond'],
  'Greater Puget Sound': ['bainbridge island', 'bremerton', 'poulsbo',
    'silverdale', 'port orchard', 'langley', 'coupeville', 'oak harbor',
    'clinton', 'freeland', 'port townsend', 'sequim', 'vashon', 'kingston',
    'suquamish', 'shelton'],
};

function regionForCity(city) {
  if (!city) return 'Pacific Northwest';
  const c = city.trim().toLowerCase();
  for (const [region, cities] of Object.entries(REGION_CITIES)) {
    if (cities.includes(c)) return region;
  }
  return 'Pacific Northwest';
}

function decodeEntities(s) {
  if (!s) return '';
  return s
    .replace(/&#8217;|&#039;/g, "’").replace(/&#8216;/g, '‘')
    .replace(/&#8220;/g, '“').replace(/&#8221;/g, '”')
    .replace(/&#8211;/g, '–').replace(/&#8212;/g, '—')
    .replace(/&#038;|&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}

function stripHtml(s) {
  return decodeEntities(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// ---- fetch one date window, all pages -------------------------------------
async function fetchWindow(startDate, endDate, { log = () => {}, fetchImpl = fetch } = {}) {
  const raw = [];
  let page = 1, totalPages = 1;
  do {
    const url = `${API}?per_page=50&page=${page}` +
      `&start_date=${startDate}&end_date=${endDate}&status=publish`;
    const res = await fetchImpl(url, { headers: { 'User-Agent': 'parentmap-family-map/1.0' } });
    if (!res.ok) throw new Error(`API ${res.status} on page ${page}`);
    const data = await res.json();
    raw.push(...(data.events || []));
    totalPages = data.total_pages || 1;
    log(`page ${page}/${totalPages} (${raw.length} occurrences)`);
    page++;
  } while (page <= totalPages);
  return raw;
}

// ---- normalize + group recurring occurrences by slug ----------------------
function normalize(rawEvents) {
  const bySlug = new Map();
  for (const ev of rawEvents) {
    const venue = Array.isArray(ev.venue) ? null : ev.venue; // [] when none
    const ages = ev.custom_fields && ev.custom_fields._ecp_custom_2
      ? String(ev.custom_fields._ecp_custom_2.value).split('|').map(s => s.trim())
      : [];
    const isFree = /free/i.test(ev.cost || '') ||
      (ev.cost_details && (ev.cost_details.values || []).length > 0 &&
       (ev.cost_details.values || []).every(v => v === '0' || v === 'free'));
    const occ = { start: ev.start_date, end: ev.end_date };

    const key = ev.slug;
    if (bySlug.has(key)) {
      bySlug.get(key).occurrences.push(occ);
      continue;
    }
    bySlug.set(key, {
      id: ev.id,
      slug: key,
      title: decodeEntities(ev.title),
      url: ev.url,
      website: ev.website || null,
      description: stripHtml(ev.description).slice(0, 400),
      image: ev.image && ev.image.sizes && ev.image.sizes.medium
        ? ev.image.sizes.medium.url : (ev.image && ev.image.url) || null,
      cost: decodeEntities(ev.cost || ''),
      free: !!isFree,
      categories: (ev.categories || []).map(c => c.name),
      ages,
      virtual: !!ev.is_virtual,
      venue: venue ? {
        id: venue.id,
        name: decodeEntities(venue.venue || ''),
        address: [venue.address, venue.city, venue.stateprovince || venue.state, venue.zip]
          .filter(Boolean).join(', '),
        city: venue.city || '',
      } : null,
      region: venue ? regionForCity(venue.city) : (ev.is_virtual ? 'Virtual' : 'Pacific Northwest'),
      occurrences: [occ],
    });
  }
  const events = [...bySlug.values()];
  for (const e of events) e.occurrences.sort((a, b) => a.start.localeCompare(b.start));
  events.sort((a, b) => a.occurrences[0].start.localeCompare(b.occurrences[0].start));
  return events;
}

// ---- geocode unique venues via Nominatim (cached, 1.1 s throttle) ---------
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function geocodeVenues(events, cache = {}, { log = () => {}, fetchImpl = fetch } = {}) {
  const venues = new Map();
  for (const e of events) if (e.venue) venues.set(String(e.venue.id), e.venue);

  for (const [id, v] of venues) {
    if (cache[id] !== undefined) continue; // hit (null = known failure)
    const tries = [
      v.address,                                   // full street address
      `${v.name}, ${v.city}, WA, USA`,             // venue name + city
      v.city ? `${v.city}, WA, USA` : null,        // city centroid fallback
    ].filter(Boolean);
    let hit = null;
    for (const q of tries) {
      const url = `${NOMINATIM}?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`;
      try {
        const res = await fetchImpl(url, {
          headers: { 'User-Agent': 'parentmap-family-map/1.0 (personal project)' },
        });
        if (res.ok) {
          const js = await res.json();
          if (js[0]) { hit = { lat: +js[0].lat, lng: +js[0].lon, approx: q !== v.address }; }
        }
      } catch (_) { /* keep trying */ }
      await sleep(1100); // Nominatim usage policy: max 1 req/s
      if (hit) break;
    }
    cache[id] = hit; // may be null -> don't retry next run
    log(`geocode ${v.name}: ${hit ? hit.lat.toFixed(4) + ',' + hit.lng.toFixed(4) : 'FAILED'}`);
  }

  for (const e of events) {
    const c = e.venue && cache[String(e.venue.id)];
    e.lat = c ? c.lat : null;
    e.lng = c ? c.lng : null;
    e.geoApprox = c ? !!c.approx : false;
  }
  return { events, cache };
}

module.exports = { fetchWindow, normalize, geocodeVenues, regionForCity, REGION_CITIES };
