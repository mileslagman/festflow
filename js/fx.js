// Dashboard countdown. Updates twice a minute: no seconds, so nothing ticks in the corner of your eye.
(function () {
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
  window.FX = { tickCountdowns };
})();
