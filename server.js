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

async function fetchFares({ from, to, depart, ret }) {
  const url = new URL('https://serpapi.com/search.json');
  url.search = new URLSearchParams({
    engine: 'google_flights', type: '1', departure_id: from, arrival_id: to,
    outbound_date: depart, return_date: ret, currency: 'USD', hl: 'en', gl: 'us', api_key: KEY,
  });
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw httpError(502, j.error || `SerpApi returned ${r.status}`);

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
  const k = [from, to, depart, ret].join('|');
  const hit = cache[k];
  if (hit && Date.now() - hit.fetchedAt < TTL) return { ...hit, cached: true };
  if (!pending.has(k)) {
    pending.set(k, fetchFares({ from, to, depart, ret })
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
  if (u.pathname === '/api/status') return json(res, 200, { live: !!KEY, provider: KEY ? 'Google Flights via SerpApi' : null });
  if (u.pathname === '/api/fares') {
    if (!KEY) return json(res, 503, { error: 'Live fares are off: no SERPAPI_KEY set.' });
    try { return json(res, 200, await fares(Object.fromEntries(u.searchParams))); }
    catch (e) { console.error('[fares]', e.message); return json(res, e.status || 500, { error: e.message }); }
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
