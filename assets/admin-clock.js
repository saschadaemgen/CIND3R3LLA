/**
 * The sidebar clock's tick (CCB-S5-036, D-194).
 *
 * ── WHAT THIS COSTS, AND WHAT IT DELIBERATELY DOES NOT ───────────────────────
 *
 * One `setInterval` at 1000 ms, writing one text node and one attribute when the MINUTE
 * changes. That is the entire runtime cost: no `requestAnimationFrame`, no per-frame work, no
 * layout thrash. The glitch is CSS, so the compositor animates it without waking the main
 * thread - which matters on a machine already spending its cores on inference.
 *
 * The time is server-rendered into the markup, so this file only keeps a correct clock
 * moving. With scripts off the console shows the time the page was served, which is honest
 * for decoration and is why the zone is labelled.
 *
 * It writes only when the displayed value actually changes, so 59 of every 60 ticks touch no
 * DOM at all.
 */
(function () {
  'use strict';

  var face = document.querySelector('[data-clock-face]');
  if (!face) return;

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function tick() {
    var now = new Date();
    var text = pad(now.getUTCHours()) + ':' + pad(now.getUTCMinutes());
    if (face.textContent === text) return;
    face.textContent = text;
    // The glitch layers are `::before` / `::after` reading this attribute, so it has to move
    // with the text or the ghosting would show a stale minute.
    face.setAttribute('data-text', text);
  }

  tick();
  var timer = setInterval(tick, 1000);

  // A hidden tab does not need a running clock. `visibilitychange` is free and this drops the
  // cost to zero whenever the console is not being looked at.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      clearInterval(timer);
      timer = null;
    } else if (!timer) {
      tick();
      timer = setInterval(tick, 1000);
    }
  });
})();
