// Countdown and the motion between tabs.
(function () {
  // ---------- page transitions ----------
  // Pages move the way the tab bar runs: up and down beside the sidebar, sideways above the
  // phone tab bar. Opening a festival slides in from the right, and going back reverses it.
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
  const phone = window.matchMedia('(max-width: 720px)');
  const EASE = 'cubic-bezier(.2, .75, .25, 1)';
  const tabs = () => [...document.querySelectorAll('.nav a[data-route]')];

  function heading(from, to) {
    if (from.tab === to.tab) return from.deep && !to.deep ? [-1, 0] : [1, 0];
    const order = tabs().map((a) => a.dataset.route);
    const dir = order.indexOf(to.tab) >= order.indexOf(from.tab) ? 1 : -1;
    return phone.matches ? [dir, 0] : [0, dir];
  }

  // Call before the new page is drawn; returns a function to call once it has been.
  let ghost = null;
  function leave(view, from, to) {
    if (ghost) { ghost.remove(); ghost = null; }
    if (calm.matches || document.hidden || !view.animate) return null;
    const [x, y] = heading(from, to);
    const shift = (n) => `translate(${x * n}px, ${y * n}px)`;

    // A picture of the old page stays put while the new one is drawn underneath.
    const box = view.getBoundingClientRect();
    const old = view.cloneNode(true);
    old.removeAttribute('id');
    old.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    old.querySelectorAll('[name]').forEach((el) => el.removeAttribute('name'));
    old.className += ' view-ghost';
    old.inert = true;
    old.setAttribute('aria-hidden', 'true');
    Object.assign(old.style, { top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px` });

    return () => {
      view.after(old);
      ghost = old;
      const out = old.animate([{ opacity: 1 }, { opacity: 0, transform: shift(-24) }], { duration: 150, easing: 'ease-in', fill: 'forwards' });
      const done = () => { old.remove(); if (ghost === old) ghost = null; };
      out.onfinish = done;
      out.oncancel = done;
      setTimeout(done, 400); // in case the browser pauses animations partway
      // Sections arrive one after another; anything past the fifth is below the fold anyway.
      [...view.children].forEach((el, i) => el.animate(
        [{ opacity: 0, transform: shift(44) }, { opacity: 1, transform: 'none' }],
        { duration: 340, delay: 70 + Math.min(i, 4) * 45, easing: EASE, fill: 'backwards' },
      ));
    };
  }

  // ---------- tab highlight ----------
  const nav = document.querySelector('.nav');
  const pill = document.createElement('span');
  pill.className = 'nav-pill';
  pill.setAttribute('aria-hidden', 'true');
  nav.prepend(pill);
  let placed = null;
  function movePill() {
    const a = nav.querySelector('a.active');
    pill.hidden = !a;
    if (!a) { placed = null; return; }
    // Glide only when the tab changed; the first draw and window resizes jump straight there.
    pill.classList.toggle('glide', !!placed && placed !== a);
    placed = a;
    Object.assign(pill.style, { width: `${a.offsetWidth}px`, height: `${a.offsetHeight}px`, transform: `translate(${a.offsetLeft}px, ${a.offsetTop}px)` });
  }
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => {
      const a = nav.querySelector('a.active');
      const same = a && placed === a && pill.offsetWidth === a.offsetWidth && pill.offsetHeight === a.offsetHeight;
      if (!(same && pill.getAnimations().length)) movePill();
    });
    ro.observe(nav);
    tabs().forEach((a) => ro.observe(a));
  }

  // ---------- countdown ----------
  // Updates twice a minute: no seconds, so nothing ticks in the corner of your eye.
  function tickCountdowns() {
    document.querySelectorAll('.countdown[data-to]').forEach((el) => {
      const ms = new Date(el.dataset.to) - Date.now();
      if (ms <= 0) { el.innerHTML = '<span class="now">Happening now</span>'; el.removeAttribute('data-to'); return; }
      const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60;
      const parts = d ? [[d, d === 1 ? 'day' : 'days'], [h, 'hr']] : [[h, 'hr'], [m, 'min']];
      el.innerHTML = parts.map(([n, unit]) => `<span class="seg-t"><b>${n}</b><i>${unit}</i></span>`).join('');
    });
  }
  setInterval(tickCountdowns, 30000);
  window.FX = { tickCountdowns, leave, movePill };
})();
