// FestFlow dev server: serves the app and proxies live fares from SerpApi's
// Google Flights API so the API key stays on this machine, never in the browser.
//
//   1. Put SERPAPI_KEY=your_key in festflow/.env (see .env.example)
//   2. node server.js  →  http://localhost:5173
//
// Without a key the app still runs and falls back to modeled fare estimates.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
loadEnv();
const KEY = process.env.SERPAPI_KEY || '';
const PORT = Number(process.env.PORT) || 5173;
const TTL = 6 * 3600 * 1000; // reuse a route's fare for 6h to save quota
const CACHE_FILE = path.join(ROOT, '.fare-cache.json');

let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { /* first run */ }
const pending = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

function loadEnv() {
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  } catch { /* no .env */ }
}

function httpError(status, message) { return Object.assign(new Error(message), { status }); }

async function serp(params) {
  const url = new URL('https://serpapi.com/search.json');
  url.search = new URLSearchParams({ ...params, currency: 'USD', hl: 'en', gl: 'us', api_key: KEY });
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  // "Fully empty" results come back as an error string; treat them as no results.
  if (j.error && /hasn't returned any results/i.test(j.error)) return {};
  if (!r.ok || j.error) throw httpError(502, j.error || `SerpApi returned ${r.status}`);
  return j;
}

async function fetchFares({ from, to, depart, ret }) {
  const j = await serp({
    engine: 'google_flights', type: '1', departure_id: from, arrival_id: to, outbound_date: depart, return_date: ret,
  });
  const itineraries = [...(j.best_flights || []), ...(j.other_flights || [])].filter((o) => typeof o.price === 'number');
  const options = itineraries.sort((a, b) => a.price - b.price).slice(0, 5).map((o) => {
    const segs = o.flights || [];
    return {
      price: o.price,
      airlines: [...new Set(segs.map((s) => s.airline).filter(Boolean))].join(', '),
      stops: Math.max(segs.length - 1, 0),
      duration: o.total_duration || null,
      departs: segs[0] && segs[0].departure_airport && segs[0].departure_airport.time,
      arrives: segs.length ? segs[segs.length - 1].arrival_airport && segs[segs.length - 1].arrival_airport.time : null,
    };
  });
  const pi = j.price_insights || {};
  return {
    live: true, from, to, depart, ret,
    lowest: pi.lowest_price ?? (options[0] ? options[0].price : null),
    priceLevel: pi.price_level || null,
    typicalRange: Array.isArray(pi.typical_price_range) && pi.typical_price_range.length === 2 ? pi.typical_price_range : null,
    options,
    fetchedAt: Date.now(),
  };
}

async function fares(q) {
  const from = String(q.from || '').toUpperCase(), to = String(q.to || '').toUpperCase();
  const { depart, ret } = q;
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to) || !date.test(depart) || !date.test(ret)) {
    throw httpError(400, 'Expected from, to (airport codes), depart and ret (YYYY-MM-DD)');
  }
  return cached([from, to, depart, ret].join('|'), () => fetchFares({ from, to, depart, ret }));
}

// Hotels (rooms for 2) or vacation rentals (whole homes sized for the group) from Google Hotels.
async function fetchStays({ q, checkin, checkout, adults, rentals }) {
  const params = { engine: 'google_hotels', q, check_in_date: checkin, check_out_date: checkout, adults: String(adults), sort_by: '3' };
  if (rentals) params.vacation_rentals = 'true';
  const j = await serp(params);
  const props = (j.properties || []).filter((x) => x.rate_per_night && typeof x.rate_per_night.extracted_lowest === 'number');
  const nightly = props.map((x) => x.rate_per_night.extracted_lowest).sort((a, b) => a - b);
  // Cheapest listings are often hostels or far-out places, so "typical" is the median of the 15 cheapest.
  const sample = nightly.slice(0, 15);
  const typical = sample.length ? sample[Math.floor(sample.length / 2)] : null;
  const options = props.sort((a, b) => a.rate_per_night.extracted_lowest - b.rate_per_night.extracted_lowest).slice(0, 5).map((x) => ({
    name: x.name,
    type: x.type || null,
    nightly: x.rate_per_night.extracted_lowest,
    total: x.total_rate && typeof x.total_rate.extracted_lowest === 'number' ? x.total_rate.extracted_lowest : null,
    rating: x.overall_rating || null,
    reviews: x.reviews || null,
    link: typeof x.link === 'string' && x.link.startsWith('http') ? x.link : null,
  }));
  return { live: true, q, checkin, checkout, adults, rentals: !!rentals, lowest: nightly[0] ?? null, typical, count: props.length, options, fetchedAt: Date.now() };
}

async function stays(q) {
  const date = /^\d{4}-\d{2}-\d{2}$/;
  const query = String(q.q || '').trim();
  const adults = Math.min(Math.max(parseInt(q.adults, 10) || 2, 1), 12);
  const rentals = q.rentals === '1';
  if (!query || query.length > 80 || /[<>{}]/.test(query) || !date.test(q.checkin) || !date.test(q.checkout)) {
    throw httpError(400, 'Expected q (place), checkin and checkout (YYYY-MM-DD)');
  }
  const args = { q: query, checkin: q.checkin, checkout: q.checkout, adults, rentals };
  return cached(['stays', query, q.checkin, q.checkout, adults, rentals].join('|'), () => fetchStays(args));
}

// ---------- festival lookup (Google search via SerpApi) ----------
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MON = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

// Finds date ranges like "Sep 3 – 5, 2027", "May 29-31 2027" or "Aug 29 - Sep 1, 2026".
function findDates(text) {
  const out = [];
  const range = new RegExp(`${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|–|—|to|through|thru)\\s*(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\\s*)?(?:${MON}\\s+)?(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d\\d)`, 'gi');
  let m;
  while ((m = range.exec(text))) {
    const m1 = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    const m2 = m[3] ? MONTHS.indexOf(m[3].slice(0, 3).toLowerCase()) : m1;
    const y = Number(m[5]), d1 = Number(m[2]), d2 = Number(m[4]);
    if (m1 < 0 || m2 < 0 || d1 > 31 || d2 > 31) continue;
    const start = isoOf(y, m1, d1), end = isoOf(m2 < m1 ? y + 1 : y, m2, d2);
    const span = (new Date(end) - new Date(start)) / 864e5;
    if (span >= 0 && span <= 10) out.push({ start, end });
  }
  return out;
}

function findPrices(texts) {
  for (const t of texts) {
    if (!/ticket|pass|\bga\b|general admission/i.test(t)) continue;
    for (const m of t.matchAll(/\$\s?(\d{2,4})(?:\.\d{2})?/g)) {
      const v = Number(m[1]);
      if (v >= 60 && v <= 2500) return v;
    }
  }
  return null;
}

const SKIP_SITES = /wikipedia|facebook|instagram|twitter|x\.com|tiktok|youtube|reddit|ticketmaster|stubhub|seatgeek\.com|vividseats|gametime|songkick|bandsintown|eventbrite|axs\.com|jambase|festivalfans|setlist/i;

async function fetchLookup(q) {
  const j = await serp({ engine: 'google', q: `${q} music festival dates tickets`, num: '10' });
  const kg = j.knowledge_graph || {};
  const ev = (j.events_results || [])[0] || null;
  const organic = j.organic_results || [];
  const snippets = organic.slice(0, 8).map((r) => `${r.title || ''}. ${r.snippet || ''} ${(r.rich_snippet && JSON.stringify(r.rich_snippet)) || ''}`);
  const texts = [
    kg.dates, kg.date, kg.start_date, kg.event_dates, ev && ev.date && ev.date.when, ev && ev.date && ev.date.start_date,
    j.answer_box && (j.answer_box.answer || j.answer_box.snippet), kg.description, ...snippets,
  ].filter((x) => typeof x === 'string');
  const dates = texts.flatMap(findDates);
  const official = organic.find((r) => r.link && !SKIP_SITES.test(r.link));
  return {
    query: q,
    name: kg.title || (ev && ev.title) || null,
    description: kg.description || (organic[0] && organic[0].snippet) || '',
    website: kg.website || (official && official.link) || null,
    location: kg.location || kg.address || kg.venue || (ev && Array.isArray(ev.address) ? ev.address.join(', ') : null),
    dates,
    price: findPrices(texts),
    sources: organic.slice(0, 3).map((r) => ({ title: r.title, link: r.link })),
    fetchedAt: Date.now(),
  };
}

async function lookup(q) {
  const query = String(q.q || '').trim();
  if (!query || query.length > 80 || /[<>{}]/.test(query)) throw httpError(400, 'Expected q (festival name)');
  return cached(['lookup', query.toLowerCase()].join('|'), () => fetchLookup(query));
}

// ---------- geocoding (OpenStreetMap Nominatim, no key) ----------
async function geocode(q) {
  const query = String(q.q || '').trim();
  if (!query || query.length > 120) throw httpError(400, 'Expected q (place)');
  return cached(['geo', query.toLowerCase()].join('|'), async () => {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.search = new URLSearchParams({ q: query, format: 'jsonv2', limit: '1', addressdetails: '1' });
    const r = await fetch(url, { headers: { 'User-Agent': 'FestFlow/1.0 (personal festival planner)', 'Accept-Language': 'en' } });
    if (!r.ok) throw httpError(502, `Geocoder returned ${r.status}`);
    const [hit] = await r.json();
    if (!hit) return { found: false, fetchedAt: Date.now() };
    const a = hit.address || {};
    const town = a.city || a.town || a.village || a.hamlet || a.county || '';
    const region = a.country_code === 'us' ? (a['ISO3166-2-lvl4'] || '').replace('US-', '') : a.country || '';
    return { found: true, lat: Number(hit.lat), lon: Number(hit.lon), city: [town, region].filter(Boolean).join(', '), fetchedAt: Date.now() };
  });
}

// ---------- driving routes (OpenStreetMap OSRM, no key) ----------
function parseLatLon(s) {
  const m = String(s || '').match(/^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null;
}

async function route(q) {
  const a = parseLatLon(q.from), b = parseLatLon(q.to);
  if (!a || !b) throw httpError(400, 'Expected from and to as lat,lon');
  const key = ['route', ...a, ...b].map((x) => (typeof x === 'number' ? x.toFixed(3) : x)).join('|');
  return cached(key, async () => {
    const url = `https://router.project-osrm.org/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=false`;
    const r = await fetch(url, { headers: { 'User-Agent': 'FestFlow/1.0 (personal festival planner)' } });
    if (!r.ok) throw httpError(502, `Router returned ${r.status}`);
    const j = await r.json();
    if (j.code !== 'Ok' || !j.routes || !j.routes.length) return { found: false, fetchedAt: Date.now() };
    return { found: true, miles: j.routes[0].distance / 1609.34, hours: j.routes[0].duration / 3600, fetchedAt: Date.now() };
  });
}

function cached(k, load) {
  const hit = cache[k];
  if (hit && Date.now() - hit.fetchedAt < TTL) return Promise.resolve({ ...hit, cached: true });
  if (!pending.has(k)) {
    pending.set(k, load()
      .then((out) => { cache[k] = out; fs.writeFile(CACHE_FILE, JSON.stringify(cache), () => {}); return out; })
      .finally(() => pending.delete(k)));
  }
  return pending.get(k);
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/api/status') return json(res, 200, { live: !!KEY, provider: KEY ? 'Google Flights & Hotels via SerpApi' : null });
  // Map lookups and driving routes are free and don't need the SerpApi key.
  const free = { '/api/geocode': geocode, '/api/route': route }[u.pathname];
  if (free) {
    try { return json(res, 200, await free(Object.fromEntries(u.searchParams))); }
    catch (e) { console.error(`[${u.pathname}]`, e.message); return json(res, e.status || 500, { error: e.message }); }
  }
  const handler = { '/api/fares': fares, '/api/stays': stays, '/api/lookup': lookup }[u.pathname];
  if (handler) {
    if (!KEY) return json(res, 503, { error: 'Live prices are off: no SERPAPI_KEY set.' });
    try { return json(res, 200, await handler(Object.fromEntries(u.searchParams))); }
    catch (e) { console.error(`[${u.pathname}]`, e.message); return json(res, e.status || 500, { error: e.message }); }
  }

  let p = decodeURIComponent(u.pathname);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, path.normalize(p));
  // Never serve files outside the app folder or dotfiles like .env.
  if (!file.startsWith(ROOT + path.sep) || path.relative(ROOT, file).split(path.sep).some((part) => part.startsWith('.'))) {
    res.writeHead(404); return res.end('Not found');
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`FestFlow running at http://localhost:${PORT}`);
  console.log(KEY ? 'Live fares: ON (Google Flights via SerpApi)' : 'Live fares: OFF — add SERPAPI_KEY to festflow/.env to enable');
});
