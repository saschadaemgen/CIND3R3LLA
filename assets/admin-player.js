/*
 * The console's preview player (D-225, the operator's decision: the whole
 * console, not one section). One card at the top of the contextual sidebar,
 * a real <audio> element behind it, and its state in sessionStorage so it
 * survives page changes anywhere in the console. It plays the ORIGINAL bytes
 * through /music/tracks/:id/audio, writes no play row, and says so in its own
 * footer: `local preview, not sent to any chat`.
 */
(function () {
  'use strict';

  var KEY = 'cin-player';
  var mount = document.querySelector('[data-player-mount]');
  if (!mount) return;

  var state = null;
  try { state = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { state = null; }

  var audio = document.createElement('audio');
  audio.preload = 'auto';
  var listeners = [];

  function save() {
    if (state) state.pos = audio.currentTime || 0;
    try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* full */ }
  }
  function emit() {
    listeners.forEach(function (fn) { try { fn(); } catch (e) { /* theirs */ } });
  }
  function mmss(s) {
    if (s === null || s === undefined || !isFinite(s)) return 'unknown';
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = Math.floor(s % 60);
    if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
    return m + ':' + String(sec).padStart(2, '0');
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function render() {
    mount.textContent = '';
    if (!state || !state.tid) { save(); emit(); return; }
    var card = el('div', 'music-player-card');

    var top = el('div', 'music-player-top');
    top.appendChild(el('span', 'music-player-kicker', state.qName ? 'Playlist · ' + state.qName : 'Library preview'));
    top.appendChild(el('span', 'music-player-qpos', state.queue && state.queue.length ? (state.qIdx + 1) + ' / ' + state.queue.length : ''));
    card.appendChild(top);

    var idRow = el('div', 'music-player-idrow');
    var icon = el('span', 'music-player-icon');
    icon.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="18" r="3"/><circle cx="18" cy="16" r="3"/><path d="M11 18V6l10-2v12"/></svg>';
    idRow.appendChild(icon);
    var idText = el('span', 'music-player-idtext');
    var title = el('span', 'music-player-title', state.title);
    title.setAttribute('aria-live', 'polite');
    idText.appendChild(title);
    idText.appendChild(el('span', 'music-player-artist', state.artist || 'no artist in the tag'));
    idRow.appendChild(idText);
    card.appendChild(idRow);

    var seek = el('button', 'music-player-seek');
    seek.type = 'button';
    seek.setAttribute('aria-label', 'Seek');
    var track = el('span', 'music-player-track');
    var fill = el('span', 'music-player-fill');
    var dur = audio.duration;
    var pct = isFinite(dur) && dur > 0 ? Math.min(100, Math.round(((audio.currentTime || 0) / dur) * 100)) : 0;
    fill.style.width = pct + '%';
    track.appendChild(fill);
    seek.appendChild(track);
    seek.addEventListener('click', function (e) {
      var rect = track.getBoundingClientRect();
      var frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      if (isFinite(audio.duration)) audio.currentTime = audio.duration * frac;
    });
    card.appendChild(seek);

    var ctl = el('div', 'music-player-ctl');
    var toggle = el('button', 'mus-play');
    toggle.type = 'button';
    toggle.setAttribute('data-on', '1');
    toggle.setAttribute('aria-label', state.on ? 'Pause' : 'Play');
    toggle.innerHTML = state.on
      ? '<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>'
      : '<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>';
    toggle.addEventListener('click', api.toggle);
    ctl.appendChild(toggle);
    if (state.queue && state.queue.length) {
      var next = el('button', 'mus-play');
      next.type = 'button';
      next.setAttribute('aria-label', 'Next track in the playlist');
      next.innerHTML = '<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true"><path d="M5 5l9 7-9 7z"/><path d="M16 5h3v14h-3z"/></svg>';
      next.addEventListener('click', api.next);
      ctl.appendChild(next);
    }
    ctl.appendChild(el('span', 'music-player-pos', mmss(audio.currentTime || 0) + ' / ' + mmss(isFinite(audio.duration) ? audio.duration : null)));
    ctl.appendChild(el('span', 'music-head-spacer'));
    var stop = el('button', 'music-player-stop', 'stop');
    stop.type = 'button';
    stop.addEventListener('click', api.stop);
    ctl.appendChild(stop);
    card.appendChild(ctl);

    card.appendChild(el('p', 'music-player-note', 'local preview, not sent to any chat'));
    mount.appendChild(card);
    save();
    emit();
  }

  function load(tid, andPlay) {
    audio.src = '/music/tracks/' + tid + '/audio';
    if (andPlay) {
      audio.play().then(function () { state.on = true; render(); })
        .catch(function () { state.on = false; render(); });
    }
  }

  var api = {
    play: function (t) {
      if (state && state.tid === t.id) { api.toggle(); return; }
      state = { tid: t.id, title: t.title, artist: t.artist || '', pos: 0, on: true, queue: [], qIdx: 0, qName: '' };
      load(t.id, true);
      render();
    },
    playQueue: function (name, tracks) {
      if (!tracks.length) return;
      state = {
        tid: tracks[0].id, title: tracks[0].title, artist: tracks[0].artist || '',
        pos: 0, on: true,
        queue: tracks.map(function (t) { return { id: t.id, title: t.title, artist: t.artist || '' }; }),
        qIdx: 0, qName: name,
      };
      load(tracks[0].id, true);
      render();
    },
    toggle: function () {
      if (!state || !state.tid) return;
      if (audio.paused) {
        audio.play().then(function () { state.on = true; render(); }).catch(function () { state.on = false; render(); });
      } else {
        audio.pause();
        state.on = false;
        render();
      }
    },
    next: function () {
      if (!state || !state.queue || !state.queue.length) return;
      if (state.qIdx + 1 >= state.queue.length) { api.stop(); return; }
      state.qIdx += 1;
      var t = state.queue[state.qIdx];
      state.tid = t.id; state.title = t.title; state.artist = t.artist; state.pos = 0; state.on = true;
      load(t.id, true);
      render();
    },
    stop: function () {
      audio.pause();
      audio.removeAttribute('src');
      state = null;
      try { sessionStorage.removeItem(KEY); } catch (e) { /* fine */ }
      render();
    },
    state: function () {
      return state ? { tid: state.tid, on: state.on, qName: state.qName } : null;
    },
    onChange: function (fn) { listeners.push(fn); },
  };
  window.CinPlayer = api;

  audio.addEventListener('timeupdate', function () {
    var pos = mount.querySelector('.music-player-pos');
    var fill = mount.querySelector('.music-player-fill');
    if (pos) pos.textContent = mmss(audio.currentTime || 0) + ' / ' + mmss(isFinite(audio.duration) ? audio.duration : null);
    if (fill) {
      var dur = audio.duration;
      var pct = isFinite(dur) && dur > 0 ? Math.min(100, Math.round(((audio.currentTime || 0) / dur) * 100)) : 0;
      fill.style.width = pct + '%';
    }
    if (state) state.pos = audio.currentTime || 0;
  });
  audio.addEventListener('ended', function () {
    if (state && state.queue && state.queue.length && state.qIdx + 1 < state.queue.length) {
      api.next();
    } else if (state) {
      // Parks at the end, and a finished queue is cleared - the prototype's rule.
      state.on = false;
      state.queue = []; state.qIdx = 0; state.qName = '';
      render();
    }
  });
  window.addEventListener('pagehide', save);

  // Resume across a page change (the whole-console decision): the state
  // carries the track and position; the browser may refuse un-gestured sound,
  // in which case the card shows Play and waits for the press.
  if (state && state.tid) {
    audio.src = '/music/tracks/' + state.tid + '/audio';
    var resumeAt = state.pos || 0;
    audio.addEventListener('loadedmetadata', function onMeta() {
      audio.removeEventListener('loadedmetadata', onMeta);
      if (resumeAt > 0 && isFinite(audio.duration)) audio.currentTime = Math.min(resumeAt, audio.duration);
      if (state.on) {
        audio.play().catch(function () { state.on = false; render(); });
      }
      render();
    });
  }
  render();
})();
