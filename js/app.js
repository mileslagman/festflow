(function () {
  const F = window.FEST, FL = F.flights;
  const view = document.getElementById('view');

  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const pad = (n) => String(n).padStart(2, '0');
  const toDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (s, n) => { const d = toDate(s); d.setDate(d.getDate() + n); return iso(d); };
  const todayISO = () => iso(new Date());
  const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);
  const mon = (d) => d.toLocaleString('en-US', { month: 'short' });
  const fmtDay = (s) => toDate(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const fmtDate = (s) => toDate(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  function fmtRange(a, b, withYear = true) {
    const A = toDate(a), B = toDate(b);
    const s = mon(A) === mon(B) ? `${mon(A)} ${A.getDate()}–${B.getDate()}` : `${mon(A)} ${A.getDate()} – ${mon(B)} ${B.getDate()}`;
    return withYear ? `${s}, ${B.getFullYear()}` : s;
  }
  const fmtWeekends = (f) => f.weekends.map((w) => fmtRange(w[0], w[1], false)).join(' & ') + ', ' + f.weekends[0][0].slice(0, 4);
  function fmtTime(t) {
    if (!t) return '';
    let [h, m] = t.split(':').map(Number);
    const ap = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return `${h}${m ? ':' + pad(m) : ''}${ap}`;
  }
  const fest = (id) => F.festivals.find((f) => f.id === id);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---------- store ----------
  const KEY = 'festflow.v1';
  let S = load();
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.plans && s.events) return s;
    } catch (e) { /* storage unavailable */ }
    return { profile: null, plans: {}, events: [] };
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } }

  const home = () => (S.profile && S.profile.home) || 'ATL';
  const defaultGround = (f) => (f.ground.transit ? 'transit' : 'rental');
  const defaultPlan = (f) => ({
    weekend: 0, tier: 0, lodging: f.lodging.camp != null ? 'camp' : 'hotel', ground: defaultGround(f), group: 1, food: 60, from: home(),
  });
  const isEU = (f) => FL.airport(f.airport).region === 'EU';

  // ---------- stay + ground transport models ----------
  // Hotel rooms hold 2, Airbnb homes hold `sleeps`; costs are split across the group.
  function stayCost(f, p, nights, depart, ret) {
    const group = p.group || 1;
    const L = f.lodging;
    if (p.lodging === 'camp' && L.camp != null) {
      return { kind: 'camp', label: 'Camping', units: group, unitLabel: 'campsite pass', rate: L.camp, total: L.camp * nights * group };
    }
    const kind = p.lodging === 'airbnb' ? 'airbnb' : 'hotel';
    const ls = p.liveStay;
    const live = ls && ls.kind === kind && ls.depart === depart && ls.ret === ret && ls.group === group && ls.nightly != null;
    // A live Airbnb search is sized for the whole group, so it's one home.
    const units = kind === 'hotel' ? Math.ceil(group / 2) : live ? 1 : Math.ceil(group / L.sleeps);
    const rate = live ? ls.nightly : kind === 'hotel' ? L.hotel : L.airbnb;
    return {
      kind, live, rate, units, total: rate * nights * units,
      label: kind === 'hotel' ? 'Hotel' : 'Airbnb / rental',
      unitLabel: kind === 'hotel' ? 'room' : 'home',
    };
  }

  const RIDE = { base: 5.5, perMi: 2.8, minFare: 12, surge: 2 };
  const rideFare = (mi, surge, eu) => Math.max(RIDE.minFare, RIDE.base + RIDE.perMi * mi) * surge * (eu ? 0.8 : 1);

  function groundCost(f, p, days, nights, camping) {
    const g = f.ground, group = p.group || 1, eu = isEU(f);
    let mode = p.ground || defaultGround(f);
    if (mode === 'transit' && !g.transit) mode = 'rental';
    if (mode === 'transit') {
      return { mode, label: g.transit.label, total: g.transit.cost * group, lines: [[`${g.transit.label} × ${group}`, g.transit.cost * group]] };
    }
    if (mode === 'rideshare') {
      const cars = Math.ceil(group / 4);
      const airport = 2 * rideFare(g.airportMi, 1.2, eu) * cars;
      // Getting there is normal pricing; leaving at close usually surges ~2×.
      const daily = camping ? 0 : days * (rideFare(g.dailyMi, 1.2, eu) + rideFare(g.dailyMi, RIDE.surge, eu)) * cars;
      const lines = [[`Airport rides ×2 (${g.airportMi} mi each)`, airport]];
      if (daily) lines.push([`Venue rides ×${days * 2} (incl. ~2× post-show surge)`, daily]);
      if (cars > 1) lines.push([`${cars} cars for ${group} people`, null]);
      return { mode, label: 'Uber / Lyft', total: airport + daily, lines };
    }
    const cars = Math.ceil(group / 5);
    const rent = g.rentalDaily * nights * 1.3 * cars; // ~30% taxes & airport fees
    const miles = 2 * g.airportMi + (camping ? 0 : 2 * g.dailyMi * days);
    const gas = (miles / 28) * (eu ? 7.5 : 3.7) * cars;
    const parking = camping ? 0 : g.parking * days * cars;
    const lines = [[`Rental ${plural(nights, 'day')} × ${money(g.rentalDaily)} + taxes & fees`, rent], [`Gas (~${Math.round(miles)} mi)`, gas]];
    if (parking) lines.push([`Festival parking ×${days} days`, parking]);
    if (cars > 1) lines.push([`${cars} cars for ${group} people`, null]);
    return { mode: 'rental', label: 'Rental car', total: rent + gas + parking, lines };
  }

  function trip(f, p = S.plans[f.id] || defaultPlan(f)) {
    p = { ...defaultPlan(f), ...p };
    const [start, end] = f.weekends[p.weekend] || f.weekends[0];
    const depart = addDays(start, -1), ret = addDays(end, 1);
    const days = daysBetween(start, end) + 1;
    const nights = days + 1;
    const ticket = (f.tickets[p.tier] || f.tickets[0]).price;
    const from = p.from || home();
    let flight = FL.estimate(from, f.airport, depart);
    const lf = p.liveFare;
    if (lf && lf.price != null && lf.from === from && lf.depart === depart && lf.ret === ret && !flight.local) {
      flight = { ...flight, price: lf.price, live: true, liveAt: lf.at };
    }
    const group = p.group;
    const stay = stayCost(f, p, nights, depart, ret);
    const camping = stay.kind === 'camp';
    const ground = groundCost(f, p, days, nights, camping);
    // Everything below is per person, so it lines up with the personal budget.
    const lodging = stay.total / group;
    const transport = ground.total / group;
    const food = p.food * (days + 1);
    const total = ticket + (flight ? flight.price : 0) + lodging + transport + food;
    return { start, end, depart, ret, days, nights, ticket, flight, from, camping, stay, ground, group, lodging, transport, food, total, plan: p };
  }

  // Flight + booking-reminder events generated from a saved plan.
  function syncAutoEvents(f) {
    S.events = S.events.filter((e) => !(e.festId === f.id && e.auto));
    if (S.plans[f.id]) {
      const t = trip(f);
      if (!t.flight.local) {
        S.events.push(
          { id: uid(), auto: true, festId: f.id, type: 'flight', date: t.depart, start: '09:00', end: '', title: `Fly ${t.from} → ${f.airport}`, location: `${f.name} trip` },
          { id: uid(), auto: true, festId: f.id, type: 'flight', date: t.ret, start: '11:00', end: '', title: `Fly ${f.airport} → ${t.from}`, location: `${f.name} trip` },
        );
        if (t.flight.daysOut > 14) {
          const when = t.flight.bestFrom > todayISO() ? t.flight.bestFrom : todayISO();
          S.events.push({ id: uid(), auto: true, festId: f.id, type: 'reminder', date: when, start: '10:00', end: '', title: `Book flights for ${f.name}`, location: `Target ≈ ${money(t.flight.best)} round trip` });
        }
      }
    }
    save();
  }

  // ---------- event + clash helpers ----------
  const TYPE_COLORS = { set: '#ff5fa2', flight: '#5cb8ff', reminder: '#ffb547', custom: '#7c5cff' };
  const evColor = (e) => (e.type === 'set' && fest(e.festId) ? fest(e.festId).color : TYPE_COLORS[e.type] || TYPE_COLORS.custom);
  const byTime = (a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || ''));
  // Festival-day minutes: anything before 8am belongs to the previous night.
  const mins = (t) => { const [h, m] = t.split(':').map(Number); const v = h * 60 + m; return h < 8 ? v + 1440 : v; };
  function clashes(sets) {
    const bad = new Set();
    for (let i = 0; i < sets.length; i++) {
      for (let j = i + 1; j < sets.length; j++) {
        const a = sets[i], b = sets[j];
        const a1 = mins(a.start), a2 = a.end ? Math.max(mins(a.end), a1 + 1) : a1 + 60;
        const b1 = mins(b.start), b2 = b.end ? Math.max(mins(b.end), b1 + 1) : b1 + 60;
        if (a1 < b2 && b1 < a2) { bad.add(a.id); bad.add(b.id); }
      }
    }
    return bad;
  }

  function upcomingAgenda(n) {
    const t = todayISO();
    const items = S.events.filter((e) => e.date >= t).map((e) => ({ ...e, color: evColor(e) }));
    for (const id of Object.keys(S.plans)) {
      const f = fest(id); if (!f) continue;
      const tr = trip(f);
      if (tr.start >= t) items.push({ id: 'f-' + id, date: tr.start, start: f.hours[0], title: `${f.name} begins`, location: f.city, type: 'fest', color: f.color });
    }
    return items.sort(byTime).slice(0, n);
  }

  function recommend(n) {
    const g = (S.profile && S.profile.genres) || [];
    const t = todayISO();
    return F.festivals
      .filter((f) => !S.plans[f.id] && f.weekends[f.weekends.length - 1][1] >= t)
      .map((f) => ({ f, score: f.genres.filter((x) => g.includes(x)).length * 10 - trip(f).total / 1000 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, n)
      .map((x) => x.f);
  }

  // ---------- shared UI pieces ----------
  function festCard(f) {
    const t = trip(f);
    const planned = !!S.plans[f.id];
    const g = (S.profile && S.profile.genres) || [];
    return `<a class="card fcard" style="--c:${f.color}" href="#/festival/${f.id}">
      <div class="top"><div><h3>${esc(f.name)}</h3><div class="muted small">${esc(f.city)} · ${f.airport}</div></div>
        ${planned ? '<span class="badge good">Planned</span>' : ''}</div>
      <div class="when">${fmtWeekends(f)} ${f.dateStatus === 'projected' ? '<span class="badge muted">projected</span>' : ''}</div>
      <div class="tags">${f.genres.map((x) => `<span class="tag ${g.includes(x) ? 'match' : ''}">${x}</span>`).join('')}</div>
      <div class="cost">
        <span>Ticket <b>${money(t.ticket)}</b></span>
        <span>Flight <b>${t.flight.local ? 'local' : money(t.flight.price)}</b></span>
        <span>Stay <b>${t.lodging ? money(t.lodging) : 'incl.'}</b></span>
        <span>Getting around <b>${money(t.transport)}</b></span>
      </div>
      <div class="total"><span class="muted small">Est. trip from ${t.from}</span><span class="big">${money(t.total)}</span></div>
    </a>`;
  }

  function airportOptions(sel) {
    const groups = { NA: 'North America', EU: 'Europe' };
    return Object.entries(groups).map(([r, label]) => `<optgroup label="${label}">${F.airports.filter((a) => a.region === r)
      .map((a) => `<option value="${a.code}" ${a.code === sel ? 'selected' : ''}>${a.code} · ${a.city}</option>`).join('')}</optgroup>`).join('');
  }

  function itemRow(e, { clash = false, showDate = false } = {}) {
    const time = e.start ? fmtTime(e.start) + (e.end ? '–' + fmtTime(e.end) : '') : 'All day';
    return `<div class="item ${clash ? 'clash' : ''}">
      <span class="dot" style="--c:${e.color || evColor(e)}"></span>
      <div class="time">${showDate ? fmtDay(e.date) + '<br>' : ''}${time}</div>
      <div class="grow"><div class="title">${esc(e.title)}${clash ? ' <span class="badge bad">clash</span>' : ''}</div>
        ${e.location ? `<div class="muted small">${esc(e.location)}</div>` : ''}</div>
      ${e.type !== 'fest' ? `<button class="x" data-del="${e.id}" title="Remove">×</button>` : ''}
    </div>`;
  }

  function bindDeletes(root, after) {
    $$('[data-del]', root).forEach((b) => b.addEventListener('click', (ev) => {
      ev.preventDefault();
      S.events = S.events.filter((e) => e.id !== b.dataset.del);
      save(); after();
    }));
  }

  function trendSvg(pts, est) {
    if (!pts.length) return '';
    const W = 540, H = 200, pl = 46, pr = 14, pt = 16, pb = 28, maxD = 330;
    const prices = pts.map((p) => p.price);
    const lo = Math.min(...prices) * 0.9, hi = Math.max(...prices) * 1.05;
    const x = (d) => pl + (maxD - d) / maxD * (W - pl - pr);
    const y = (v) => pt + (hi - v) / (hi - lo) * (H - pt - pb);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.days).toFixed(1)},${y(p.price).toFixed(1)}`).join('');
    const area = `${line}L${x(0)},${H - pb}L${x(maxD)},${H - pb}Z`;
    const [s1, s2] = FL.sweetSpot(est.intl);
    const yt = [lo, (lo + hi) / 2, hi].map((v) => `<text x="${pl - 8}" y="${y(v) + 4}" text-anchor="end">${money(v)}</text><line class="axis" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke-dasharray="2 4"/>`).join('');
    const xt = [300, 240, 180, 120, 60, 0].map((d) => `<text x="${x(d)}" y="${H - 8}" text-anchor="middle">${d ? d + 'd' : 'Fly'}</text>`).join('');
    let now = '';
    if (est.daysOut >= 0 && est.daysOut <= maxD) {
      const cx = x(est.daysOut), cy = y(est.price);
      now = `<line x1="${cx}" x2="${cx}" y1="${pt}" y2="${H - pb}" stroke="#fff" stroke-opacity=".35" stroke-dasharray="3 3"/>
        <circle cx="${cx}" cy="${cy}" r="5" fill="#fff" stroke="#ff5fa2" stroke-width="3"/>
        <text x="${cx}" y="${pt - 3}" text-anchor="middle" style="fill:#fff;font-weight:600">Today</text>`;
    }
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Estimated fare by days before departure">
      <defs><linearGradient id="fareFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#7c5cff" stop-opacity=".45"/><stop offset="1" stop-color="#7c5cff" stop-opacity="0"/></linearGradient></defs>
      <rect x="${x(s2)}" y="${pt}" width="${x(s1) - x(s2)}" height="${H - pt - pb}" fill="#3ddc97" fill-opacity=".09"/>
      <text x="${(x(s1) + x(s2)) / 2}" y="${H - pb - 6}" text-anchor="middle" style="fill:#3ddc97">sweet spot</text>
      ${yt}${xt}
      <path d="${area}" fill="url(#fareFill)"/>
      <path d="${line}" fill="none" stroke="#b9a6ff" stroke-width="2.5" stroke-linejoin="round"/>
      ${now}
    </svg></div>`;
  }

  const fmtDur = (m) => (m ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : '');
  function ago(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)}h ago`;
  }
  function liveCard(r) {
    if (r.lowest == null) return '<div class="live-card"><span class="badge muted">● LIVE</span> <span class="muted small">Google Flights has no itineraries for these dates yet — airlines usually open schedules ~11 months out.</span></div>';
    const tone = { low: 'good', typical: 'info', high: 'bad' }[r.priceLevel] || 'muted';
    return `<div class="live-card">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center">
        <span><span class="badge good">● LIVE</span> <span class="muted small">Google Flights · checked ${ago(r.fetchedAt)}</span></span>
        ${r.priceLevel ? `<span class="badge ${tone}">Prices are ${esc(r.priceLevel)}</span>` : ''}</div>
      <div class="big" style="font-size:34px;margin-top:6px">${money(r.lowest)} <span class="muted small" style="font-family:Inter;font-weight:400">lowest round trip</span></div>
      ${r.typicalRange ? `<div class="muted small">Google's typical range for this route: ${money(r.typicalRange[0])}–${money(r.typicalRange[1])}</div>` : ''}
      ${r.options.length ? `<div style="margin-top:8px">${r.options.map((o) => `<div class="item" style="padding:7px 0">
        <div class="grow"><div class="title small">${esc(o.airlines || 'Multiple airlines')}</div>
          <div class="muted small">${o.stops ? plural(o.stops, 'stop') : 'Nonstop'}${o.duration ? ' · ' + fmtDur(o.duration) : ''}${o.departs ? ' · departs ' + esc(o.departs.slice(-5)) : ''}</div></div>
        <b>${money(o.price)}</b></div>`).join('')}</div>` : ''}
    </div>`;
  }

  function liveStayCard(r, rentals, nights) {
    const what = rentals ? 'vacation rentals' : 'hotels';
    if (r.typical == null) return `<div class="live-card"><span class="badge muted">● LIVE</span> <span class="muted small">Google has no ${what} with prices for these dates yet. Showing the festival-week estimate.</span></div>`;
    return `<div class="live-card">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center">
        <span><span class="badge good">● LIVE</span> <span class="muted small">Google ${rentals ? 'vacation rentals' : 'Hotels'} · ${r.count} with prices · checked ${ago(r.fetchedAt)}</span></span></div>
      <div class="big" style="font-size:30px;margin-top:6px">${money(r.typical)} <span class="muted small" style="font-family:Inter;font-weight:400">typical / night ${rentals ? `for ${plural(r.adults, 'guest')}` : 'per room'}</span></div>
      <div class="muted small">Cheapest ${money(r.lowest)}/night. "Typical" is the middle of the 15 cheapest, used in your total.</div>
      ${r.options.length ? `<div style="margin-top:8px">${r.options.map((o) => `<div class="item" style="padding:7px 0">
        <div class="grow"><div class="title small">${o.link ? `<a href="${esc(o.link)}" target="_blank" rel="noopener">${esc(o.name)} ↗</a>` : esc(o.name)}</div>
          <div class="muted small">${[o.type, o.rating ? `★ ${o.rating}${o.reviews ? ` (${o.reviews.toLocaleString()})` : ''}` : '', o.total ? `${money(o.total)} total for ${plural(nights, 'night')}` : ''].filter(Boolean).map(esc).join(' · ')}</div></div>
        <b>${money(o.nightly)}</b></div>`).join('')}</div>` : ''}
    </div>`;
  }

  function flightLinks(from, to, dep, ret) {
    const l = FL.links(from, to, dep, ret);
    return `<div class="btn-row">
      <a class="btn sm" target="_blank" rel="noopener" href="${l.google}">Google Flights ↗</a>
      <a class="btn sm" target="_blank" rel="noopener" href="${l.kayak}">Kayak ↗</a>
      <a class="btn sm" target="_blank" rel="noopener" href="${l.skyscanner}">Skyscanner ↗</a></div>`;
  }

  // ---------- profile form (onboarding + profile page) ----------
  function profileFields(p) {
    const g = p.genres || [];
    return `<div class="form-grid">
        <label class="field">Your name<input name="name" required value="${esc(p.name || '')}" placeholder="Alex" /></label>
        <label class="field">Home airport<select name="home">${airportOptions(p.home || 'ATL')}</select></label>
        <label class="field">Festival budget (USD)<input name="budget" type="number" min="0" step="50" value="${p.budget || 2500}" /></label>
      </div>
      <div style="margin-top:16px"><div class="muted small" style="margin-bottom:8px">What do you like to hear?</div>
        <div class="chips">${F.genres.map((x) => `<span class="chip ${g.includes(x) ? 'on' : ''}" data-genre="${x}">${x}</span>`).join('')}</div></div>`;
  }
  function bindProfileForm(form, onSave) {
    $$('.chip', form).forEach((c) => c.addEventListener('click', () => c.classList.toggle('on')));
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const fd = new FormData(form);
      const prevHome = S.profile && S.profile.home;
      S.profile = {
        name: fd.get('name').trim() || 'Friend',
        home: fd.get('home'),
        budget: Number(fd.get('budget')) || 0,
        genres: $$('.chip.on', form).map((c) => c.dataset.genre),
      };
      // Plans that were following the old home airport follow the new one.
      for (const [id, p] of Object.entries(S.plans)) {
        if (!p.from || p.from === prevHome) { p.from = S.profile.home; syncAutoEvents(fest(id)); }
      }
      save();
      onSave();
    });
  }

  // ---------- views ----------
  function viewOnboard() {
    view.innerHTML = `<div class="onboard">
      <h1>Every festival, <span class="grad-text">one plan.</span></h1>
      <p class="muted" style="font-size:17px">Dates, ticket prices, flight estimates from your home airport, set-time planning and a calendar — all in one place. Tell us a bit about you to personalize it.</p>
      <form class="card pad-lg" id="pf" style="margin-top:22px">${profileFields({})}
        <div class="btn-row" style="margin-top:20px"><button class="btn primary" type="submit">Build my dashboard →</button></div>
      </form></div>`;
    bindProfileForm($('#pf'), () => { toast('Welcome to FestFlow!'); render(); });
  }

  function viewDashboard() {
    if (!S.profile) return viewOnboard();
    const p = S.profile;
    const t0 = todayISO();
    const trips = Object.keys(S.plans).map((id) => fest(id)).filter(Boolean)
      .map((f) => ({ f, t: trip(f) })).sort((a, b) => a.t.start.localeCompare(b.t.start));
    const next = trips.find((x) => x.t.end >= t0);
    const total = trips.reduce((s, x) => s + x.t.total, 0);
    const pct = p.budget ? Math.min(100, (total / p.budget) * 100) : 0;
    const left = p.budget - total;
    const agenda = upcomingAgenda(7);
    const nextDays = next ? daysBetween(t0, next.t.start) : null;

    view.innerHTML = `
      <div class="page-head"><div><h1>Hey ${esc(p.name)} <span class="grad-text">✦</span></h1>
        <p class="muted">${trips.length ? `${plural(trips.length, 'festival')} planned · flying from ${p.home}` : 'No trips yet — pick a festival to start planning.'}</p></div>
        <a class="btn primary" href="#/festivals">+ Plan a festival</a></div>

      <div class="grid g4">
        <div class="card stat"><div class="label">Next festival</div>
          ${next ? `<div class="countdown" style="margin-top:8px"><span class="n">${Math.max(nextDays, 0)}</span><span class="muted">${nextDays > 0 ? 'days to go' : 'happening now!'}</span></div>
          <div class="sub" style="margin-top:6px"><span class="dot" style="--c:${next.f.color}"></span> ${esc(next.f.name)}</div>` : '<div class="value">—</div><div class="sub">Nothing planned yet</div>'}</div>
        <div class="card stat"><div class="label">Planned spend</div><div class="value">${money(total)}</div>
          <div class="sub">tickets, flights, stay & food</div></div>
        <div class="card stat"><div class="label">Budget ${left >= 0 ? 'left' : 'over'}</div>
          <div class="value" style="color:${left >= 0 ? 'var(--good)' : 'var(--bad)'}">${money(Math.abs(left))}</div>
          <div class="meter ${left < 0 ? 'over' : ''}"><i style="width:${pct}%"></i></div>
          <div class="sub" style="margin-top:6px">${Math.round(pct)}% of ${money(p.budget)}</div></div>
        <div class="card stat"><div class="label">On your calendar</div><div class="value">${S.events.filter((e) => e.date >= t0).length}</div>
          <div class="sub">upcoming sets, flights & reminders</div></div>
      </div>

      <div class="section split">
        <div><h2>Your trips</h2>
          ${trips.length ? `<div class="grid">${trips.map(({ f, t }) => tripCard(f, t)).join('')}</div>`
            : `<div class="empty">Save a festival to see your full trip cost here.<br><br><a class="btn primary sm" href="#/festivals">Browse festivals</a></div>`}
        </div>
        <div><h2>Up next <a class="btn sm ghost" href="#/calendar">Calendar →</a></h2>
          <div class="card" id="agenda">${agenda.length ? agenda.map((e) => itemRow(e, { showDate: true })).join('') : '<div class="muted">Your agenda is clear. Plan a trip or add sets to fill it in.</div>'}</div>
        </div>
      </div>

      <div class="section"><h2>Recommended for you <a class="btn sm ghost" href="#/festivals">See all →</a></h2>
        <div class="grid g3">${recommend(3).map(festCard).join('')}</div></div>`;
    bindDeletes($('#agenda'), render);
  }

  function tripCard(f, t) {
    const fl = t.flight;
    return `<a class="card fcard" style="--c:${f.color}" href="#/festival/${f.id}">
      <div class="top"><div><h3>${esc(f.name)}</h3><div class="muted small">${fmtRange(t.start, t.end)} · ${esc(f.city)}</div></div>
        ${fl.local ? '<span class="badge muted">local</span>' : `<span class="badge ${fl.tone}">${fl.status.split(' — ')[0]}</span>`}</div>
      <div class="cost">
        <span>${esc(f.tickets[t.plan.tier].tier)} <b>${money(t.ticket)}</b></span>
        <span>Flight ${t.from}→${f.airport} <b>${fl.local ? '—' : money(fl.price)}</b>${fl.live ? ' <span class="badge good">live</span>' : ''}</span>
        <span>${t.stay.label} ×${t.nights} <b>${t.lodging ? money(t.lodging) : 'incl.'}</b>${t.stay.live ? ' <span class="badge good">live</span>' : ''}</span>
        <span>${esc(t.ground.label)} <b>${money(t.transport)}</b></span>
        <span>Food <b>${money(t.food)}</b></span>
      </div>
      <div class="total"><span class="muted small">Trip total</span><span class="big">${money(t.total)}</span></div>
    </a>`;
  }

  function viewFestivals() {
    const months = [...new Set(F.festivals.flatMap((f) => f.weekends.map((w) => w[0].slice(0, 7))))].sort();
    view.innerHTML = `
      <div class="page-head"><div><h1>Festivals</h1><p class="muted">Dates, tickets and estimated trip cost from ${home()}.</p></div></div>
      <div class="toolbar">
        <input type="search" id="q" placeholder="Search festivals or cities…" />
        <select id="genre"><option value="">All genres</option>${F.genres.map((g) => `<option>${g}</option>`).join('')}</select>
        <select id="month"><option value="">Any month</option>${months.map((m) => `<option value="${m}">${toDate(m + '-01').toLocaleString('en-US', { month: 'long', year: 'numeric' })}</option>`).join('')}</select>
        <select id="sort">
          <option value="date">Sort: soonest</option><option value="total">Sort: trip cost</option>
          <option value="ticket">Sort: ticket price</option><option value="flight">Sort: flight price</option>
          ${S.profile ? '<option value="match">Sort: best match</option>' : ''}
        </select>
      </div>
      <div id="fgrid" class="grid g3"></div>
      <p class="notice" style="margin-top:20px"><b>About these numbers:</b> 2027 dates are projected from each festival's usual pattern — confirm on the official site before booking. Ticket prices are last edition's face value (≈ USD, before fees). Flight prices are modeled estimates; open a festival for live-fare links.</p>`;
    const draw = () => {
      const q = $('#q').value.toLowerCase(), g = $('#genre').value, m = $('#month').value, sort = $('#sort').value;
      const genres = (S.profile && S.profile.genres) || [];
      let list = F.festivals.filter((f) =>
        (!q || (f.name + f.city).toLowerCase().includes(q)) &&
        (!g || f.genres.includes(g)) &&
        (!m || f.weekends.some((w) => w[0].startsWith(m) || w[1].startsWith(m))));
      const key = {
        date: (f) => f.weekends[0][0], total: (f) => trip(f).total, ticket: (f) => f.tickets[0].price,
        flight: (f) => trip(f).flight.price, match: (f) => -f.genres.filter((x) => genres.includes(x)).length,
      }[sort];
      list = list.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
      $('#fgrid').innerHTML = list.length ? list.map(festCard).join('') : '<div class="empty">No festivals match those filters.</div>';
    };
    $$('.toolbar input, .toolbar select').forEach((el) => el.addEventListener('input', draw));
    draw();
  }

  function viewFestival(id) {
    const f = fest(id);
    if (!f) { view.innerHTML = '<div class="empty">Festival not found. <a href="#/festivals">Back to festivals</a></div>'; return; }
    let p = { ...defaultPlan(f), ...(S.plans[id] || {}) };
    let day = null;
    const planned = () => !!S.plans[id];
    const g = (S.profile && S.profile.genres) || [];

    view.innerHTML = `
      <div class="hero" style="--c:${f.color}">
        <a href="#/festivals" class="muted small" style="text-decoration:none">← All festivals</a>
        <h1 style="margin-top:8px">${esc(f.name)}</h1>
        <div class="meta"><span>📍 ${esc(f.city)}</span><span>✈ ${f.airport}</span><span>📅 ${fmtWeekends(f)}</span>
          <span>🕛 Gates ~${fmtTime(f.hours[0])}–${fmtTime(f.hours[1])}</span></div>
        <p style="max-width:640px;color:#d9d5ee">${esc(f.blurb)}</p>
        <div class="tags">${f.genres.map((x) => `<span class="tag ${g.includes(x) ? 'match' : ''}">${x}</span>`).join('')}</div>
        <div class="btn-row" style="margin-top:18px"><button class="btn primary" id="savePlan"></button>
          <a class="btn ghost" href="${f.url}" target="_blank" rel="noopener">Official site & tickets ↗</a></div>
      </div>
      ${f.dateStatus === 'projected' ? `<p class="notice" style="margin-top:12px"><b>Projected dates.</b> 2027 dates follow ${esc(f.name)}'s usual calendar and haven't been confirmed — check the official site before booking anything non-refundable.</p>` : ''}

      <div class="section split">
        <div class="card pad-lg"><h2 style="margin-bottom:16px">Plan your trip</h2>
          <div class="form-grid">
            ${f.weekends.length > 1 ? `<label class="field">Weekend<div class="seg" id="wk">${f.weekends.map((w, i) => `<button data-v="${i}">W${i + 1} · ${fmtRange(w[0], w[1], false)}</button>`).join('')}</div></label>` : ''}
            <label class="field">Ticket<select id="tier">${f.tickets.map((t, i) => `<option value="${i}">${esc(t.tier)} — ${money(t.price)}</option>`).join('')}</select></label>
            <label class="field">Group size<input id="group" type="number" min="1" max="12" step="1" /></label>
            <label class="field">Stay<select id="lodging">
              ${f.lodging.camp != null ? `<option value="camp">Camping</option>` : ''}
              <option value="hotel">Hotel</option><option value="airbnb">Airbnb / vacation rental</option></select></label>
            <label class="field">Getting around<select id="ground">
              <option value="rideshare">Uber / Lyft</option><option value="rental">Rental car</option>
              ${f.ground.transit ? `<option value="transit">${esc(f.ground.transit.label)}</option>` : ''}</select></label>
            <label class="field">Food & drink per day<input id="food" type="number" min="0" step="5" /></label>
            <label class="field">Flying from<select id="from">${airportOptions(p.from)}</select></label>
          </div>
          <div class="rows" id="breakdown" style="margin-top:18px"></div>
        </div>
        <div class="card pad-lg"><h2 style="margin-bottom:12px">Flights</h2><div id="flightBox"></div></div>
      </div>

      <div class="section split">
        <div class="card pad-lg"><h2 style="margin-bottom:4px">Where to stay</h2><div id="stayBox"></div></div>
        <div class="card pad-lg"><h2 style="margin-bottom:4px">Getting around</h2><div id="groundBox"></div></div>
      </div>

      <div class="section"><h2>Set-time planner</h2>
        <div class="card pad-lg">
          <p class="muted small" style="margin-top:0">Lineups and set times drop a few weeks before the festival. Add the sets you want to catch and FestFlow flags clashes and puts them on your calendar.</p>
          <div class="seg" id="days"></div>
          <form id="setForm" class="form-grid" style="margin-top:14px;align-items:end">
            <label class="field">Artist<input name="artist" required placeholder="Who are you seeing?" /></label>
            <label class="field">Stage<input name="stage" list="stages" placeholder="Stage" /><datalist id="stages">${f.stages.map((s) => `<option value="${esc(s)}">`).join('')}</datalist></label>
            <label class="field">Starts<input name="start" type="time" required value="20:00" /></label>
            <label class="field">Ends<input name="end" type="time" value="21:00" /></label>
            <button class="btn primary" type="submit">+ Add set</button>
          </form>
          <div id="sets" style="margin-top:14px"></div>
        </div>
      </div>`;

    const commit = () => {
      if (planned()) { S.plans[id] = { ...p }; syncAutoEvents(f); }
      draw();
    };

    function draw() {
      const t = trip(f, p);
      $('#savePlan').textContent = planned() ? '✓ Saved to my plan — remove' : '★ Save to my plan';
      $('#savePlan').classList.toggle('primary', !planned());
      $$('#wk button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === p.weekend));
      $('#tier').value = p.tier; $('#lodging').value = t.stay.kind; $('#ground').value = t.ground.mode;
      $('#group').value = p.group; $('#food').value = p.food; $('#from').value = p.from;
      drawBreakdown();
      drawFlights(t);
      drawStay(t);
      drawGround(t);
      drawSets(t);
    }

    // Clickable comparison tiles: per-person cost of each stay / transport option.
    function optionTiles(field, opts) {
      return `<div class="opts">${opts.map((o) => `<button class="opt ${o.on ? 'on' : ''}" data-field="${field}" data-v="${o.v}">
        <span class="muted small">${o.label}</span><b>${money(o.cost)}</b><span class="muted small">${o.sub}</span></button>`).join('')}</div>`;
    }
    function bindTiles(root) {
      $$('.opt', root).forEach((b) => b.addEventListener('click', () => { p[b.dataset.field] = b.dataset.v; commit(); }));
    }

    function drawStay(t) {
      const L = f.lodging, group = p.group;
      const kinds = [...(L.camp != null ? ['camp'] : []), 'hotel', 'airbnb'];
      const opts = kinds.map((k) => {
        const s = trip(f, { ...p, lodging: k });
        const sub = k === 'camp' ? (L.camp ? `${money(L.camp)}/night` : 'included with ticket')
          : `${money(s.stay.rate)}/night${s.stay.live ? ' · live' : ''} · ${plural(s.stay.units, s.stay.unitLabel)}`;
        return { v: k, label: s.stay.label, cost: s.lodging, sub, on: k === t.stay.kind };
      });
      const rooms = Math.ceil(group / 2);
      const q = L.query, dates = `${fmtDate(t.depart)} to ${fmtDate(t.ret)}`;
      $('#stayBox').innerHTML = `
        <p class="muted small" style="margin:0 0 12px">Per person for ${plural(t.nights, 'night')}${group > 1 ? `, split ${group} ways` : ''}. Most people stay in <b style="color:var(--text)">${esc(L.area)}</b>. Rates are festival-week prices.</p>
        ${optionTiles('lodging', opts)}
        <div id="liveStay" style="margin-top:14px"></div>
        <p class="muted small" style="margin:14px 0 8px">Search ${esc(q)} for ${dates}:</p>
        <div class="btn-row">
          <a class="btn sm" target="_blank" rel="noopener" href="https://www.google.com/travel/search?q=${encodeURIComponent(`hotels in ${q} ${dates}`)}">Google Hotels ↗</a>
          <a class="btn sm" target="_blank" rel="noopener" href="https://www.booking.com/searchresults.html?${new URLSearchParams({ ss: q, checkin: t.depart, checkout: t.ret, group_adults: group, no_rooms: rooms })}">Booking.com ↗</a>
          <a class="btn sm" target="_blank" rel="noopener" href="https://www.airbnb.com/s/${encodeURIComponent(q)}/homes?${new URLSearchParams({ checkin: t.depart, checkout: t.ret, adults: group })}">Airbnb ↗</a>
          <a class="btn sm" target="_blank" rel="noopener" href="https://www.vrbo.com/search?${new URLSearchParams({ destination: q, startDate: t.depart, endDate: t.ret, adults: group })}">Vrbo ↗</a>
        </div>`;
      bindTiles($('#stayBox'));
      loadLiveStay(t);
    }

    async function loadLiveStay(t) {
      const box = $('#liveStay');
      const kind = t.stay.kind;
      if (kind === 'camp') { box.innerHTML = ''; return; }
      const rentals = kind === 'airbnb';
      const adults = rentals ? p.group : 2;
      const key = [kind, t.depart, t.ret, p.group].join('|');
      const stale = () => !box.isConnected || [trip(f, p).stay.kind, trip(f, p).depart, trip(f, p).ret, p.group].join('|') !== key;
      if (!(await FL.liveStatus())) return;
      box.innerHTML = `<div class="live-card"><span class="badge info">● LIVE</span> <span class="muted small">Checking Google ${rentals ? 'vacation rentals' : 'Hotels'}…</span></div>`;
      try {
        const r = await FL.liveStays(f.lodging.query, t.depart, t.ret, adults, rentals);
        if (stale()) return;
        box.innerHTML = liveStayCard(r, rentals, t.nights);
        if (r.typical != null) {
          p.liveStay = { kind, nightly: r.typical, depart: t.depart, ret: t.ret, group: p.group, at: r.fetchedAt };
          if (planned()) { S.plans[id] = { ...p }; save(); }
          drawBreakdown();
          // Refresh the tiles so the selected option shows the live rate.
          const opt = $(`#stayBox .opt[data-v="${kind}"]`);
          const s = trip(f, p);
          if (opt) opt.innerHTML = `<span class="muted small">${s.stay.label}</span><b>${money(s.lodging)}</b><span class="muted small">${money(s.stay.rate)}/night · live · ${plural(s.stay.units, s.stay.unitLabel)}</span>`;
        }
      } catch (err) {
        if (!stale()) box.innerHTML = `<div class="notice"><b>Couldn't load live rates:</b> ${esc(err.message)}. Showing festival-week estimates instead.</div>`;
      }
    }

    function drawGround(t) {
      const g = f.ground;
      const modes = ['rideshare', 'rental', ...(g.transit ? ['transit'] : [])];
      const opts = modes.map((m) => {
        const s = trip(f, { ...p, ground: m });
        const sub = m === 'rideshare' ? (t.camping ? 'airport rides only' : `incl. ${t.days * 2} venue rides`)
          : m === 'rental' ? `${money(g.rentalDaily)}/day + gas${g.parking && !t.camping ? ' & parking' : ''}` : 'per person';
        return { v: m, label: s.ground.label, cost: s.transport, sub, on: m === t.ground.mode };
      });
      $('#groundBox').innerHTML = `
        <p class="muted small" style="margin:0 0 12px">Per person, ${f.airport} → ${esc(f.lodging.area.split(/,| & /)[0])} → venue and back${p.group > 1 ? `, split ${p.group} ways` : ''}.</p>
        ${optionTiles('ground', opts)}
        <div class="rows" style="margin-top:14px">
          ${t.ground.lines.map(([label, cost]) => `<div class="row small"><span class="muted">${esc(label)}</span><span>${cost == null ? '' : money(cost)}</span></div>`).join('')}
          <div class="row"><b>${esc(t.ground.label)}${p.group > 1 ? ' · group total' : ''}</b><b>${money(t.ground.total)}</b></div>
        </div>
        ${t.ground.mode === 'rideshare' ? '<p class="muted small">Leaving right at close is when surge hits hardest. Walking 10–15 minutes away from the venue or waiting 30–45 minutes usually helps.</p>' : ''}
        ${t.ground.mode === 'rental' && t.camping ? '<p class="muted small">Car camping: your car stays at the campsite, so no daily parking or driving.</p>' : ''}
        <div class="btn-row" style="margin-top:10px">
          <a class="btn sm" target="_blank" rel="noopener" href="https://www.uber.com/global/en/price-estimate/">Uber estimate ↗</a>
          <a class="btn sm" target="_blank" rel="noopener" href="https://www.lyft.com/rider/fare-estimate">Lyft estimate ↗</a>
          <a class="btn sm" target="_blank" rel="noopener" href="https://www.kayak.com/cars/${f.airport}/${t.depart}/${t.ret}">Rental cars on Kayak ↗</a>
        </div>`;
      bindTiles($('#groundBox'));
    }

    function drawBreakdown() {
      const t = trip(f, p);
      $('#breakdown').innerHTML = `
        <div class="row"><span>${esc(f.tickets[p.tier].tier)} ticket</span><span>${money(t.ticket)}</span></div>
        <div class="row"><span>Round-trip flight ${t.flight.local ? '' : `${t.from} ⇄ ${f.airport}`} ${t.flight.live ? '<span class="badge good">live</span>' : '<span class="muted small">(est.)</span>'}</span><span>${t.flight.local ? 'local' : money(t.flight.price)}</span></div>
        <div class="row"><span>${t.stay.label} · ${plural(t.nights, 'night')}${t.stay.kind !== 'camp' ? ` · ${plural(t.stay.units, t.stay.unitLabel)}` : ''} ${t.stay.live ? '<span class="badge good">live</span>' : '<span class="muted small">(est.)</span>'}</span><span>${t.lodging ? money(t.lodging) : 'included'}</span></div>
        <div class="row"><span>${esc(t.ground.label)} <span class="muted small">(est.)</span></span><span>${money(t.transport)}</span></div>
        <div class="row"><span>Food & drink · ${t.days + 1} days</span><span>${money(t.food)}</span></div>
        <div class="row total"><span>Estimated trip total${t.group > 1 ? ' <span class="muted small" style="font-weight:400">per person</span>' : ''}</span><span class="grad-text">${money(t.total)}</span></div>
        ${t.group > 1 ? `<div class="muted small">Whole group of ${t.group}: ${money(t.total * t.group)}. Stay and transport are split evenly.</div>` : ''}
        ${S.profile && S.profile.budget ? `<div class="muted small" style="margin-top:6px">That's ${Math.round(t.total / S.profile.budget * 100)}% of your ${money(S.profile.budget)} budget.</div>` : ''}`;
    }

    function drawFlights(t) {
      const e = FL.estimate(t.from, f.airport, t.depart);
      if (e.local) { $('#flightBox').innerHTML = `<div class="empty">You're local to ${f.airport} — no flight needed. 🎉</div>`; return; }
      $('#flightBox').innerHTML = `
          <div class="muted small" style="margin-bottom:10px">${t.from} ⇄ ${f.airport} · ${e.mi.toLocaleString()} mi · ${fmtDay(t.depart)} – ${fmtDay(t.ret)}</div>
          <div id="liveBox"></div>
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-top:14px">
            <div><div class="muted small">FestFlow estimate</div>
              <div class="big" style="font-size:26px">${money(e.price)} <span class="muted small" style="font-family:Inter;font-weight:400">round trip</span></div>
              <div class="muted small">Typical range ${money(e.low)}–${money(e.high)}</div></div>
            <span class="badge ${e.tone}">${e.status}</span></div>
          <div class="muted small" style="margin:12px 0 6px">Best booking window: <b style="color:var(--text)">${fmtDate(e.bestFrom)} – ${fmtDate(e.bestTo)}</b> (≈ ${money(e.best)})</div>
          ${trendSvg(FL.trend(t.from, f.airport, t.depart), e)}
          <p class="muted small">Modeled from distance, route, festival-weekend demand and how far out you are. Compare on:</p>
          ${flightLinks(t.from, f.airport, t.depart, t.ret)}`;
      loadLive(t);
    }

    async function loadLive(t) {
      const box = $('#liveBox');
      const key = [t.from, t.depart, t.ret].join('|');
      const stale = () => !box.isConnected || [p.from, trip(f, p).depart, trip(f, p).ret].join('|') !== key;
      if (!(await FL.liveStatus())) {
        if (!stale()) box.innerHTML = '<div class="notice"><b>Live fares are off.</b> Add a free SerpApi key to <code>festflow/.env</code> and run <code>node server.js</code> to see real Google Flights prices here (see README).</div>';
        return;
      }
      box.innerHTML = '<div class="live-card"><span class="badge info">● LIVE</span> <span class="muted small">Checking Google Flights…</span></div>';
      try {
        const r = await FL.live(t.from, f.airport, t.depart, t.ret);
        if (stale()) return;
        box.innerHTML = liveCard(r);
        if (r.lowest != null) {
          p.liveFare = { price: r.lowest, at: r.fetchedAt, from: t.from, depart: t.depart, ret: t.ret };
          if (planned()) { S.plans[id] = { ...p }; save(); }
          drawBreakdown();
        }
      } catch (err) {
        if (!stale()) box.innerHTML = `<div class="notice"><b>Couldn't load live fares:</b> ${esc(err.message)}. Showing the estimate instead.</div>`;
      }
    }

    function drawSets(t) {
      const days = [];
      for (let d = t.start; d <= t.end; d = addDays(d, 1)) days.push(d);
      if (!days.includes(day)) day = days[0];
      $('#days').innerHTML = days.map((d, i) => `<button data-d="${d}" class="${d === day ? 'on' : ''}">Day ${i + 1} · ${fmtDay(d)}</button>`).join('');
      $$('#days button').forEach((b) => b.addEventListener('click', () => { day = b.dataset.d; drawSets(t); }));
      const sets = S.events.filter((e) => e.type === 'set' && e.festId === id && e.date === day)
        .sort((a, b) => mins(a.start) - mins(b.start));
      const bad = clashes(sets);
      $('#sets').innerHTML = sets.length
        ? sets.map((e) => itemRow(e, { clash: bad.has(e.id) })).join('') + (bad.size ? '<p class="small" style="color:var(--bad)">Overlapping sets — time to make some tough choices.</p>' : '')
        : `<div class="empty">No sets for ${fmtDay(day)} yet.</div>`;
      bindDeletes($('#sets'), () => drawSets(t));
    }

    $$('#wk button').forEach((b) => b.addEventListener('click', () => { p.weekend = Number(b.dataset.v); commit(); }));
    $('#tier').addEventListener('change', (e) => { p.tier = Number(e.target.value); commit(); });
    $('#lodging').addEventListener('change', (e) => { p.lodging = e.target.value; commit(); });
    $('#ground').addEventListener('change', (e) => { p.ground = e.target.value; commit(); });
    $('#group').addEventListener('change', (e) => { p.group = Math.min(12, Math.max(1, Math.round(Number(e.target.value)) || 1)); commit(); });
    $('#food').addEventListener('change', (e) => { p.food = Math.max(0, Number(e.target.value) || 0); commit(); });
    $('#from').addEventListener('change', (e) => { p.from = e.target.value; commit(); });

    $('#savePlan').addEventListener('click', () => {
      if (planned()) {
        const sets = S.events.filter((e) => e.festId === id && !e.auto).length;
        if (!confirm(`Remove ${f.name} from your plan?${sets ? ` Your ${plural(sets, 'saved set')} will be removed too.` : ''}`)) return;
        delete S.plans[id];
        S.events = S.events.filter((e) => e.festId !== id);
        save(); toast(`Removed ${f.name}`);
      } else {
        S.plans[id] = { ...p };
        syncAutoEvents(f);
        toast(`${f.name} saved — flights & booking reminder added to your calendar`);
      }
      draw();
    });

    $('#setForm').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      S.events.push({ id: uid(), type: 'set', festId: id, date: day, start: fd.get('start'), end: fd.get('end'),
        title: fd.get('artist').trim(), location: [fd.get('stage').trim(), f.name].filter(Boolean).join(' · ') });
      if (!planned()) { S.plans[id] = { ...p }; syncAutoEvents(f); toast(`Added — ${f.name} saved to your plan too`); }
      else { save(); toast('Set added to your calendar'); }
      ev.target.artist.value = ''; ev.target.stage.value = '';
      ev.target.artist.focus();
      draw();
    });

    draw();
  }

  function viewFlights() {
    let from = home();
    view.innerHTML = `
      <div class="page-head"><div><h1>Flights</h1><p class="muted">Estimated round-trip fares to every festival, priced for booking today.</p></div>
        <label class="field" style="min-width:220px">Flying from<select id="from">${airportOptions(from)}</select></label></div>
      <div class="grid g4" id="fstats"></div>
      <div class="card section" style="padding:0"><div class="table-wrap"><table>
        <thead><tr><th>Festival</th><th>Route</th><th>Travel dates</th><th>Est. round trip</th><th>Booking status</th><th>Best window</th><th>Live fares</th></tr></thead>
        <tbody id="ftable"></tbody></table></div></div>
      <p class="notice" style="margin-top:16px"><b>How estimates work:</b> fares are modeled from distance, domestic vs. international routing, regional-airport premiums, festival-weekend demand and the typical booking curve (domestic sweet spot ~1–3 months out, international ~2–6 months). They're a planning guide. For real prices, use "Live price" (needs a SerpApi key, see README) or the Google/Kayak links.</p>`;
    const draw = () => {
      const rows = F.festivals.flatMap((f) => f.weekends.map((w, i) => {
        const depart = addDays(w[0], -1), ret = addDays(w[1], 1);
        return { f, i, w, depart, ret, e: FL.estimate(from, f.airport, depart) };
      })).filter((r) => r.e.local || r.e.daysOut >= 0).sort((a, b) => a.e.price - b.e.price);
      const priced = rows.filter((r) => !r.e.local);
      const cheapest = priced[0];
      const sweet = priced.filter((r) => r.e.tone === 'good').length;
      const avg = priced.length ? priced.reduce((s, r) => s + r.e.price, 0) / priced.length : 0;
      $('#fstats').innerHTML = `
        <div class="card stat"><div class="label">Cheapest trip</div><div class="value">${cheapest ? money(cheapest.e.price) : '—'}</div><div class="sub">${cheapest ? esc(cheapest.f.name) : ''}</div></div>
        <div class="card stat"><div class="label">Average fare</div><div class="value">${money(avg)}</div><div class="sub">from ${from}</div></div>
        <div class="card stat"><div class="label">In sweet spot now</div><div class="value">${sweet}</div><div class="sub">good time to book</div></div>
        <div class="card stat"><div class="label">Routes</div><div class="value">${rows.length}</div><div class="sub">festival weekends</div></div>`;
      $('#ftable').innerHTML = rows.map(({ f, i, depart, ret, e }) => `<tr>
        <td><a href="#/festival/${f.id}" style="text-decoration:none"><span class="dot" style="--c:${f.color}"></span> <b>${esc(f.name)}</b>${f.weekends.length > 1 ? ` <span class="muted small">W${i + 1}</span>` : ''}</a><div class="muted small">${esc(f.city)}</div></td>
        <td>${from} ⇄ ${f.airport}<div class="muted small">${e.local ? 'local' : e.mi.toLocaleString() + ' mi' + (e.intl ? ' · intl' : '')}</div></td>
        <td>${fmtRange(depart, ret)}</td>
        <td>${e.local ? '<span class="muted">No flight</span>' : `<span class="price">${money(e.price)}</span><div class="muted small">${money(e.low)}–${money(e.high)}</div>`}</td>
        <td>${e.local ? '' : `<span class="badge ${e.tone}">${e.status.split(' — ')[0]}</span>`}</td>
        <td class="small">${e.local ? '' : `${fmtRange(e.bestFrom, e.bestTo)}<div class="muted">≈ ${money(e.best)}</div>`}</td>
        <td>${e.local ? '' : `<div class="btn-row">${liveOn ? `<button class="btn sm primary" data-live="${f.airport}|${depart}|${ret}">Live price</button>` : ''}<a class="btn sm" target="_blank" rel="noopener" href="${FL.links(from, f.airport, depart, ret).google}">Google ↗</a><a class="btn sm" target="_blank" rel="noopener" href="${FL.links(from, f.airport, depart, ret).kayak}">Kayak ↗</a></div>`}</td>
      </tr>`).join('');
      // Each lookup uses one SerpApi search, so live prices here are on demand.
      $$('[data-live]').forEach((b) => b.addEventListener('click', async () => {
        const [to, depart, ret] = b.dataset.live.split('|');
        b.disabled = true; b.textContent = 'Checking…';
        try {
          const r = await FL.live(from, to, depart, ret);
          b.outerHTML = r.lowest == null ? '<span class="muted small">No fares yet</span>'
            : `<span class="price" style="color:var(--good)">${money(r.lowest)}</span> <span class="badge good">live</span>`;
        } catch (err) {
          b.disabled = false; b.textContent = 'Retry'; toast(err.message);
        }
      }));
    };
    let liveOn = false;
    $('#from').addEventListener('change', (e) => { from = e.target.value; draw(); });
    draw();
    FL.liveStatus().then((on) => {
      liveOn = on;
      if (on) { $('h1 + p', view).textContent = 'Estimated round-trip fares to every festival. Tap "Live price" for the real Google Flights fare.'; draw(); }
    });
  }

  // ---------- calendar ----------
  const cal = { month: null, sel: null, showAll: true };

  function calItems(d) {
    const out = [];
    for (const f of F.festivals) {
      const plan = S.plans[f.id];
      f.weekends.forEach((w, i) => {
        if (d < w[0] || d > w[1]) return;
        if (plan && plan.weekend === i) out.push({ kind: 'fest', f });
        else if (cal.showAll) out.push({ kind: 'ghost', f });
      });
    }
    S.events.filter((e) => e.date === d).sort(byTime).forEach((e) => out.push({ kind: 'ev', e }));
    return out;
  }

  function viewCalendar() {
    if (!cal.month) { const n = new Date(); cal.month = new Date(n.getFullYear(), n.getMonth(), 1); }
    if (!cal.sel) cal.sel = todayISO();
    const m = cal.month;
    const first = new Date(m.getFullYear(), m.getMonth(), 1);
    const start = new Date(first); start.setDate(1 - first.getDay());
    const t0 = todayISO();
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const s = iso(d);
      const items = calItems(s);
      const chips = items.slice(0, 3).map((it) => it.kind === 'ev'
        ? `<div class="ev" style="--c:${evColor(it.e)}">${it.e.start ? fmtTime(it.e.start) + ' ' : ''}${esc(it.e.title)}</div>`
        : `<div class="ev ${it.kind}" style="--c:${it.f.color}">${esc(it.f.name)}</div>`).join('');
      cells.push(`<div class="day ${d.getMonth() !== m.getMonth() ? 'other' : ''} ${s === t0 ? 'today' : ''} ${s === cal.sel ? 'sel' : ''}" data-d="${s}">
        <span class="num">${d.getDate()}</span>${chips}${items.length > 3 ? `<div class="ev more">+${items.length - 3} more</div>` : ''}</div>`);
    }

    const selItems = calItems(cal.sel);
    view.innerHTML = `
      <div class="page-head"><div><h1>Calendar</h1><p class="muted">Your festivals, flights, sets and reminders in one view.</p></div>
        <div class="btn-row"><button class="btn" id="ics">↓ Export .ics</button></div></div>
      <div class="cal-layout">
        <div>
          <div class="cal-head">
            <button class="btn sm" id="prev">‹</button>
            <h2>${m.toLocaleString('en-US', { month: 'long', year: 'numeric' })}</h2>
            <button class="btn sm" id="next">›</button>
            <button class="btn sm ghost" id="today">Today</button>
            <button class="btn sm ghost" id="nextFest">Next festival →</button>
            <label class="small muted" style="margin-left:auto;display:flex;gap:6px;align-items:center;cursor:pointer">
              <input type="checkbox" id="showAll" style="width:auto" ${cal.showAll ? 'checked' : ''}/> Show all festivals</label>
          </div>
          <div class="cal">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div class="dow">${d}</div>`).join('')}${cells.join('')}</div>
          <div class="legend">
            <span><span class="ev fest" style="--c:#ff7a45;width:22px;height:10px;padding:0"></span>Your festival</span>
            <span><span class="ev ghost" style="--c:#a58bff;width:22px;height:10px;padding:0"></span>Other festivals</span>
            ${Object.entries(TYPE_COLORS).map(([k, c]) => `<span><span class="dot" style="--c:${c}"></span>${k}</span>`).join('')}
          </div>
        </div>
        <div class="card pad-lg">
          <h2>${fmtDay(cal.sel)}</h2>
          <div id="dayList" style="margin:10px 0 16px">
            ${selItems.length ? selItems.map((it) => it.kind === 'ev' ? itemRow(it.e) : `
              <a class="item" href="#/festival/${it.f.id}" style="text-decoration:none"><span class="dot" style="--c:${it.f.color}"></span>
                <div class="time">${fmtTime(it.f.hours[0])}–${fmtTime(it.f.hours[1])}</div>
                <div class="grow"><div class="title">${esc(it.f.name)}</div><div class="muted small">${it.kind === 'fest' ? 'In your plan' : 'Not planned · tap to view'} · ${esc(it.f.city)}</div></div></a>`).join('')
              : '<div class="muted small">Nothing on this day.</div>'}
          </div>
          <h3>Add to ${fmtDay(cal.sel)}</h3>
          <form id="evForm" style="display:flex;flex-direction:column;gap:10px">
            <input name="title" required placeholder="e.g. Pick up wristbands" />
            <div class="form-grid" style="grid-template-columns:1fr 1fr">
              <label class="field">Type<select name="type"><option value="custom">Custom</option><option value="reminder">Reminder</option><option value="flight">Flight</option></select></label>
              <label class="field">Related festival<select name="festId"><option value="">None</option>${F.festivals.map((f) => `<option value="${f.id}" ${selItems.some((i) => i.f && i.f.id === f.id) ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
              <label class="field">Start<input name="start" type="time" /></label>
              <label class="field">End<input name="end" type="time" /></label>
            </div>
            <input name="location" placeholder="Location or note (optional)" />
            <button class="btn primary" type="submit">+ Add event</button>
          </form>
        </div>
      </div>`;

    const shift = (n) => { cal.month = new Date(m.getFullYear(), m.getMonth() + n, 1); viewCalendar(); };
    $('#prev').addEventListener('click', () => shift(-1));
    $('#next').addEventListener('click', () => shift(1));
    $('#today').addEventListener('click', () => { cal.month = null; cal.sel = todayISO(); viewCalendar(); });
    $('#nextFest').addEventListener('click', () => {
      const after = cal.sel >= t0 ? cal.sel : t0;
      const starts = F.festivals.filter((f) => cal.showAll || S.plans[f.id])
        .flatMap((f) => f.weekends.map((w) => w[0])).filter((d) => d > after).sort();
      if (!starts.length) return toast('No more festivals ahead');
      cal.sel = starts[0]; const d = toDate(starts[0]);
      cal.month = new Date(d.getFullYear(), d.getMonth(), 1); viewCalendar();
    });
    $('#showAll').addEventListener('change', (e) => { cal.showAll = e.target.checked; viewCalendar(); });
    $$('.cal .day').forEach((c) => c.addEventListener('click', () => {
      cal.sel = c.dataset.d;
      const d = toDate(cal.sel);
      if (d.getMonth() !== m.getMonth()) cal.month = new Date(d.getFullYear(), d.getMonth(), 1);
      viewCalendar();
    }));
    bindDeletes($('#dayList'), viewCalendar);
    $('#evForm').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      S.events.push({ id: uid(), date: cal.sel, title: fd.get('title').trim(), type: fd.get('type'), festId: fd.get('festId') || null,
        start: fd.get('start'), end: fd.get('end'), location: fd.get('location').trim() });
      save(); toast('Event added'); viewCalendar();
    });
    $('#ics').addEventListener('click', exportIcs);
  }

  function exportIcs() {
    const txt = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
    const d8 = (s) => s.replace(/-/g, '');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FestFlow//Festival Planner//EN', 'CALSCALE:GREGORIAN'];
    const push = (uidv, props) => lines.push('BEGIN:VEVENT', `UID:${uidv}@festflow`, `DTSTAMP:${stamp}`, ...props, 'END:VEVENT');
    for (const id of Object.keys(S.plans)) {
      const f = fest(id); if (!f) continue;
      const t = trip(f);
      push('fest-' + id, [`DTSTART;VALUE=DATE:${d8(t.start)}`, `DTEND;VALUE=DATE:${d8(addDays(t.end, 1))}`,
        `SUMMARY:${txt(f.name)}`, `LOCATION:${txt(f.city)}`, `DESCRIPTION:${txt(`Est. trip ${money(t.total)} · ${f.url}`)}`]);
    }
    for (const e of S.events) {
      let props;
      if (e.start) {
        const endTime = e.end || e.start;
        const endDate = e.end && e.end <= e.start ? addDays(e.date, 1) : e.date;
        props = [`DTSTART:${d8(e.date)}T${e.start.replace(':', '')}00`, `DTEND:${d8(endDate)}T${endTime.replace(':', '')}00`];
      } else {
        props = [`DTSTART;VALUE=DATE:${d8(e.date)}`, `DTEND;VALUE=DATE:${d8(addDays(e.date, 1))}`];
      }
      push(e.id, [...props, `SUMMARY:${txt(e.title)}`, ...(e.location ? [`LOCATION:${txt(e.location)}`] : [])]);
    }
    lines.push('END:VCALENDAR');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
    a.download = 'festflow.ics';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Calendar exported — import it into Google, Apple or Outlook');
  }

  function viewProfile() {
    const p = S.profile || {};
    view.innerHTML = `
      <div class="page-head"><div><h1>Profile</h1><p class="muted">Personalizes recommendations, flight estimates and your budget.</p></div></div>
      <form class="card pad-lg" id="pf">${profileFields(p)}
        <div class="btn-row" style="margin-top:20px"><button class="btn primary" type="submit">Save profile</button></div></form>
      <div class="card pad-lg section"><h2>Your data</h2>
        <p class="muted small">Everything is stored in this browser only. ${plural(Object.keys(S.plans).length, 'plan')} · ${plural(S.events.length, 'calendar event')}.</p>
        <div class="btn-row"><button class="btn" id="ics">↓ Export calendar (.ics)</button><button class="btn danger" id="reset">Reset all data</button></div></div>`;
    bindProfileForm($('#pf'), () => { toast('Profile saved'); viewProfile(); });
    $('#ics').addEventListener('click', exportIcs);
    $('#reset').addEventListener('click', () => {
      if (!confirm('Delete your profile, plans and calendar from this browser?')) return;
      S = { profile: null, plans: {}, events: [] }; save();
      location.hash = '#/';
      render();
    });
  }

  // ---------- router ----------
  const routes = { '': viewDashboard, festivals: viewFestivals, festival: viewFestival, flights: viewFlights, calendar: viewCalendar, profile: viewProfile };
  function render() {
    const [, name = '', arg] = location.hash.split('/');
    const fn = routes[name] || viewDashboard;
    const navKey = name === '' ? 'dashboard' : name === 'festival' ? 'festivals' : name;
    $$('.nav a[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === navKey));
    fn(arg && decodeURIComponent(arg));
  }
  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
  render();
})();
