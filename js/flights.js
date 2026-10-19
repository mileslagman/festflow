// Round-trip economy fare estimator.
// There's no free, keyless live-fare API, so this models price from distance, route type,
// airport size, festival-weekend demand and how far out you're booking. Every estimate
// links to Google Flights / Kayak / Skyscanner for the live fare.
(function () {
  const F = window.FEST;
  const RAD = Math.PI / 180;
  const DAY = 86400000;

  const airport = (code) => F.airports.find((a) => a.code === code);

  function miles(a, b) {
    const dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
    return 3958.8 * 2 * Math.asin(Math.sqrt(x));
  }

  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967295;
  }

  function baseFare(mi, intl) {
    let f;
    if (mi < 500) f = 110 + mi * 0.2;
    else if (mi < 1500) f = 210 + (mi - 500) * 0.11;
    else if (mi < 3000) f = 320 + (mi - 1500) * 0.08;
    else f = 440 + (mi - 3000) * 0.07;
    return intl ? f * 1.35 : f;
  }

  // Booking "sweet spot" in days before departure.
  const sweetSpot = (intl) => (intl ? [60, 180] : [28, 100]);

  function windowFactor(days, intl) {
    const [lo, hi] = sweetSpot(intl);
    if (days < 7) return 1.8;
    if (days < 14) return 1.5;
    if (days < lo) return 1 + 0.35 * (lo - days) / (lo - 14);
    if (days <= hi) return 1;
    return Math.min(1.18, 1 + (days - hi) * 0.0012);
  }

  function toDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function today() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

  function routeInfo(from, to) {
    const a = airport(from), b = airport(to);
    if (!a || !b) return null;
    const mi = miles(a, b);
    const intl = a.region !== b.region;
    const small = (a.small ? 1.1 : 1) * (b.small ? 1.15 : 1);
    return { a, b, mi, intl, small };
  }

  function priceAt(route, daysOut, depart) {
    const noise = 0.93 + hash(route.a.code + route.b.code + depart) * 0.14;
    const demand = 1.15; // festival weekend
    return baseFare(route.mi, route.intl) * route.small * demand * noise * windowFactor(daysOut, route.intl);
  }

  function estimate(from, to, depart) {
    if (from === to) return { local: true, price: 0, low: 0, high: 0, mi: 0 };
    const route = routeInfo(from, to);
    if (!route) return null;
    const dep = toDate(depart);
    const daysOut = Math.round((dep - today()) / DAY);
    const [lo, hi] = sweetSpot(route.intl);
    const price = Math.round(priceAt(route, Math.max(daysOut, 0), depart));
    const best = Math.round(priceAt(route, (lo + hi) / 2, depart));
    let status, tone;
    if (daysOut < 0) { status = 'Departed'; tone = 'muted'; }
    else if (daysOut < 14) { status = 'Last minute — fares at their peak'; tone = 'bad'; }
    else if (daysOut < lo) { status = 'Fares climbing — book soon'; tone = 'warn'; }
    else if (daysOut <= hi) { status = 'Sweet spot — good time to book'; tone = 'good'; }
    else { status = 'Early — fares usually dip closer in'; tone = 'info'; }
    return {
      local: false, price, best, low: Math.round(price * 0.85), high: Math.round(price * 1.25),
      mi: Math.round(route.mi), intl: route.intl, daysOut, status, tone,
      bestFrom: iso(new Date(dep - hi * DAY)), bestTo: iso(new Date(dep - lo * DAY)),
    };
  }

  // Fare curve from ~11 months out to departure day.
  function trend(from, to, depart) {
    const route = routeInfo(from, to);
    if (!route || from === to) return [];
    const pts = [];
    for (let d = 330; d >= 0; d -= 5) pts.push({ days: d, price: Math.round(priceAt(route, d, depart)) });
    return pts;
  }

  const links = (from, to, dep, ret) => ({
    google: `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${from} to ${to} on ${dep} through ${ret}`)}`,
    kayak: `https://www.kayak.com/flights/${from}-${to}/${dep}/${ret}?sort=price_a`,
    skyscanner: `https://www.skyscanner.com/transport/flights/${from.toLowerCase()}/${to.toLowerCase()}/${dep.slice(2).replace(/-/g, '')}/${ret.slice(2).replace(/-/g, '')}/`,
  });

  // Live fares come from server.js (/api/fares), which holds the SerpApi key.
  // When the app is served without it (or with no key), liveStatus() resolves false.
  let status = null;
  function liveStatus() {
    if (!status) {
      status = fetch('api/status')
        .then((r) => (r.ok ? r.json() : { live: false }))
        .then((j) => !!j.live)
        .catch(() => false);
    }
    return status;
  }

  const liveCache = {};
  function getLive(endpoint, params) {
    const k = endpoint + '?' + new URLSearchParams(params);
    if (!liveCache[k]) {
      liveCache[k] = fetch(k)
        .then(async (r) => {
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || 'Live price lookup failed');
          return j;
        })
        .catch((e) => { delete liveCache[k]; throw e; });
    }
    return liveCache[k];
  }
  const live = (from, to, depart, ret) => getLive('api/fares', { from, to, depart, ret });
  const liveStays = (q, checkin, checkout, adults, rentals) =>
    getLive('api/stays', { q, checkin, checkout, adults, rentals: rentals ? 1 : 0 });

  F.flights = { airport, estimate, trend, links, sweetSpot, liveStatus, live, liveStays };
})();
