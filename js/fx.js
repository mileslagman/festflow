// Visual effects: night sky with sweeping stage lasers, card tilt, page reveals,
// live countdowns and a celebration burst. Everything respects reduced motion.
(function () {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const COLORS = ['#ff4fd8', '#27e6ff', '#9b6bff', '#ffd27a', '#b8ff5c'];

  // ---------- sky: stars + lasers ----------
  const sky = document.getElementById('sky');
  const ctx = sky.getContext('2d');
  let W = 0, H = 0, dpr = 1, stars = [], mouseX = 0.5, mouseY = 0.5, last = 0, raf = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth; H = window.innerHeight;
    sky.width = W * dpr; sky.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(Math.min(220, (W * H) / 7000));
    stars = Array.from({ length: n }, () => ({
      x: Math.random(), y: Math.random() * 0.85, r: Math.random() * 1.3 + 0.2,
      depth: Math.random() * 0.8 + 0.2, phase: Math.random() * Math.PI * 2, speed: Math.random() * 1.5 + 0.5,
      tint: Math.random() < 0.15 ? COLORS[(Math.random() * COLORS.length) | 0] : '#ffffff',
    }));
    if (reduce.matches) draw(0);
  }

  // Lasers fan out from stage points below the screen and sweep slowly.
  const lasers = [
    { x: 0.18, base: -0.55, amp: 0.35, speed: 0.17, color: 0 },
    { x: 0.35, base: -0.2, amp: 0.45, speed: 0.11, color: 1 },
    { x: 0.5, base: 0.0, amp: 0.55, speed: 0.08, color: 2 },
    { x: 0.65, base: 0.2, amp: 0.45, speed: 0.13, color: 3 },
    { x: 0.82, base: 0.55, amp: 0.35, speed: 0.15, color: 0 },
  ];

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    const px = (mouseX - 0.5) * 18, py = (mouseY - 0.5) * 12;

    for (const s of stars) {
      const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 0.001 * s.speed + s.phase));
      ctx.globalAlpha = a * s.depth;
      ctx.fillStyle = s.tint;
      ctx.beginPath();
      ctx.arc(s.x * W + px * s.depth, s.y * H + py * s.depth, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'lighter';
    const len = Math.hypot(W, H) * 1.1;
    for (const l of lasers) {
      const ang = -Math.PI / 2 + l.base + Math.sin(t * 0.001 * l.speed + l.x * 9) * l.amp;
      const ox = l.x * W, oy = H + 40;
      const ex = ox + Math.cos(ang) * len, ey = oy + Math.sin(ang) * len;
      const spread = 0.012;
      const c = COLORS[(l.color + Math.floor(t / 9000)) % COLORS.length];
      const g = ctx.createLinearGradient(ox, oy, ex, ey);
      g.addColorStop(0, c + '55');
      g.addColorStop(0.45, c + '18');
      g.addColorStop(1, c + '00');
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox + Math.cos(ang - spread) * len, oy + Math.sin(ang - spread) * len);
      ctx.lineTo(ox + Math.cos(ang + spread) * len, oy + Math.sin(ang + spread) * len);
      ctx.closePath();
      ctx.fill();
      // bright core
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ex, ey); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function loop(t) {
    raf = requestAnimationFrame(loop);
    if (t - last < 33) return; // ~30fps is plenty for ambience
    last = t;
    draw(t);
  }
  function start() {
    cancelAnimationFrame(raf);
    if (reduce.matches) { draw(0); return; }
    raf = requestAnimationFrame(loop);
  }

  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', (e) => { mouseX = e.clientX / W; mouseY = e.clientY / H; }, { passive: true });
  document.addEventListener('visibilitychange', () => (document.hidden ? cancelAnimationFrame(raf) : start()));
  reduce.addEventListener('change', start);
  resize();
  start();

  // ---------- card tilt + spotlight ----------
  const canHover = window.matchMedia('(hover: hover)');
  document.addEventListener('pointermove', (e) => {
    if (reduce.matches || !canHover.matches) return;
    const card = e.target.closest && e.target.closest('.fcard');
    if (!card) return;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    card.style.setProperty('--rx', `${(0.5 - y) * 7}deg`);
    card.style.setProperty('--ry', `${(x - 0.5) * 9}deg`);
    card.style.setProperty('--mx', `${x * 100}%`);
    card.style.setProperty('--my', `${y * 100}%`);
  }, { passive: true });
  document.addEventListener('pointerout', (e) => {
    const card = e.target.closest && e.target.closest('.fcard');
    if (card && !card.contains(e.relatedTarget)) { card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg'); }
  });

  // ---------- page reveal ----------
  let revealTimer = 0;
  function pageEnter(view) {
    view.classList.remove('enter');
    void view.offsetWidth; // restart animations
    let i = 0;
    view.querySelectorAll('.page-head, .hero, .onboard, .toolbar, .grid > *, .section, .cal-layout, :scope > .notice')
      .forEach((el) => el.style.setProperty('--i', Math.min(i++, 14)));
    view.classList.add('enter');
    // Stop animating after the entrance so in-page re-renders don't replay it.
    clearTimeout(revealTimer);
    revealTimer = setTimeout(() => view.classList.remove('enter'), 1600);
  }

  // ---------- live countdowns ----------
  const pad = (n) => String(n).padStart(2, '0');
  function tickCountdowns() {
    document.querySelectorAll('.countdown[data-to]').forEach((el) => {
      const ms = new Date(el.dataset.to) - Date.now();
      if (ms <= 0) { el.innerHTML = '<span class="now">Happening now ✦</span>'; el.removeAttribute('data-to'); return; }
      const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1e3) % 60;
      const parts = [['days', d], ['hrs', pad(h)], ['min', pad(m)], ['sec', pad(s)]];
      if (!el.children.length || el.querySelector('.now')) {
        el.innerHTML = parts.map(([k]) => `<span class="seg-t ${k}"><b></b><i>${k}</i></span>`).join('');
      }
      parts.forEach(([k, v]) => {
        const b = el.querySelector(`.${k} b`);
        if (b && b.textContent !== String(v)) {
          b.textContent = v;
          if (!reduce.matches) { b.classList.remove('tick'); void b.offsetWidth; b.classList.add('tick'); }
        }
      });
    });
  }
  setInterval(tickCountdowns, 1000);

  // ---------- celebration burst ----------
  const bc = document.getElementById('burst');
  const bx = bc.getContext('2d');
  let parts = [], bRaf = 0;
  function burst(x, y) {
    if (reduce.matches) return;
    bc.width = W * dpr; bc.height = H * dpr; bx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2, v = 3 + Math.random() * 7;
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3, life: 1, size: 2 + Math.random() * 3,
        color: COLORS[i % COLORS.length], star: Math.random() < 0.35, spin: Math.random() * 6 });
    }
    cancelAnimationFrame(bRaf);
    const step = () => {
      bx.clearRect(0, 0, W, H);
      parts = parts.filter((p) => p.life > 0);
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.18; p.vx *= 0.985; p.life -= 0.016; p.spin += 0.2;
        bx.globalAlpha = Math.max(p.life, 0);
        bx.fillStyle = p.color;
        bx.shadowColor = p.color; bx.shadowBlur = 10;
        if (p.star) {
          bx.save(); bx.translate(p.x, p.y); bx.rotate(p.spin);
          bx.beginPath();
          for (let k = 0; k < 4; k++) { bx.rotate(Math.PI / 2); bx.lineTo(0, -p.size * 2.2); bx.lineTo(p.size * 0.5, -p.size * 0.5); }
          bx.fill(); bx.restore();
        } else {
          bx.beginPath(); bx.arc(p.x, p.y, p.size, 0, Math.PI * 2); bx.fill();
        }
      }
      bx.shadowBlur = 0;
      if (parts.length) bRaf = requestAnimationFrame(step);
      else bx.clearRect(0, 0, W, H);
    };
    bRaf = requestAnimationFrame(step);
  }

  window.FX = { pageEnter, tickCountdowns, burst };
})();
