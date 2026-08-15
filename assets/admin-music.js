/*
 * The Music section's behaviour (CCB-S5-044, redesigned under D-225).
 *
 * ONE TO ONE with the design deliverable's prototype: its copy is the copy,
 * its timings are the timings (the two-press disarm is 2800 ms because the
 * prototype's is), its sort and filter semantics are the semantics. Where the
 * prototype faked server work (the tag read from the file name, the 2200 ms
 * encode), the console does the real thing and keeps the honest wording.
 *
 * Data arrives in the #music-data JSON island; mutations go to the existing
 * routes with ajax=1 and the local model mirrors the change, exactly as the
 * prototype's local model did.
 */
(function () {
  'use strict';

  var island = document.getElementById('music-data');
  if (!island) return;
  var D = JSON.parse(island.textContent || '{}');
  var csrf = D.csrf || '';

  // The drawer must paint OVER the sticky header, but any ancestor with its
  // own stacking context traps its z-index below it (the operator watched the
  // panel vanish under the main menu). A portal to <body> frees it.
  document.querySelectorAll('[data-mus="drawer"]').forEach(function (d) {
    document.body.appendChild(d);
  });

  /* ── helpers (the prototype's own rules) ─────────────────────────────── */

  function mmss(s) {
    if (s === null || s === undefined) return 'unknown';
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = Math.floor(s % 60);
    if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
    return m + ':' + String(sec).padStart(2, '0');
  }
  function mb(b) {
    if (!b) return '0 bytes';
    if (b < 1048576) return String(Math.max(1, Math.round(b / 1024))) + ' KB';
    if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';
  }
  function clock() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function todayStamp() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function post(url, fields) {
    var body = new URLSearchParams();
    body.set('_csrf', csrf);
    body.set('ajax', '1');
    Object.keys(fields || {}).forEach(function (k) {
      if (fields[k] !== undefined && fields[k] !== null) body.set(k, String(fields[k]));
    });
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      credentials: 'same-origin',
    }).then(function (r) { return r.json().catch(function () { return { ok: r.ok }; }); });
  }
  function q(name) { return document.querySelector('[data-mus="' + name + '"]'); }
  function trackById(id) {
    for (var i = 0; i < D.tracks.length; i++) if (D.tracks[i].id === id) return D.tracks[i];
    return null;
  }
  function playlistNamesOf(trackId) {
    return D.playlists.filter(function (p) { return p.trackIds.indexOf(trackId) >= 0; })
      .map(function (p) { return p.name; });
  }

  /* ── the two-press pattern: 2800 ms, per the prototype ─────────────────── */

  function twoPress(state, key, onFire, withTimer) {
    if (state[key]) {
      state[key] = null;
      if (state[key + 'T']) { clearTimeout(state[key + 'T']); state[key + 'T'] = null; }
      onFire();
      return true;
    }
    state[key] = true;
    if (withTimer) {
      state[key + 'T'] = setTimeout(function () { state[key] = null; state[key + 'T'] = null; withTimer(); }, 2800);
    }
    return false;
  }

  /* ══ LIBRARY ═══════════════════════════════════════════════════════════ */

  function libraryPage() {
    var S = {
      q: '', fKind: '', fGenre: '', fX: '',
      sort: 'up', dir: 'desc',
      checked: {}, staged: [], sSeq: 0,
      libNote: '', delArmRow: null, delArmT: null,
      drawer: null, // {id, draft, savedAt, cpk, coverState, vidNote, delArm}
    };

    var SORTS = [
      { key: 'title', label: 'Track', first: 'asc' },
      { key: 'artist', label: 'Artist', first: 'asc' },
      { key: 'kind', label: 'Kind', first: 'asc' },
      { key: 'genre', label: 'Genre', first: 'asc' },
      { key: 'dur', label: 'Time', first: 'desc', right: true },
      { key: 'size', label: 'Size', first: 'desc', right: true },
      { key: 'plays', label: 'Plays', first: 'desc', right: true },
    ];

    function genresAll() {
      var seen = [];
      D.tracks.forEach(function (t) {
        var g = t.genre || '(no genre)';
        if (seen.indexOf(g) < 0) seen.push(g);
      });
      seen.sort(function (a, b) {
        if (a === '(no genre)') return 1;
        if (b === '(no genre)') return -1;
        return a.localeCompare(b);
      });
      return seen;
    }

    function filtered() {
      var needle = S.q.trim().toLowerCase();
      return D.tracks.filter(function (t) {
        if (needle) {
          var hay = (t.title + ' ' + (t.artist || '') + ' ' + (t.album || '') + ' ' + t.file + ' ' + (t.genre || '')).toLowerCase();
          if (hay.indexOf(needle) < 0) return false;
        }
        if (S.fKind && t.kind !== S.fKind) return false;
        if (S.fGenre && (t.genre || '(no genre)') !== S.fGenre) return false;
        if (S.fX === 'nocover' && t.cover) return false;
        if (S.fX === 'novideo' && !(t.cover && !t.vid)) return false;
        if (S.fX === 'video' && !(t.vid > 0)) return false;
        if (S.fX === 'nopl' && playlistNamesOf(t.id).length > 0) return false;
        if (S.fX === 'nodur' && t.dur !== null) return false;
        return true;
      }).sort(function (a, b) {
        var x = a[S.sort]; var y = b[S.sort];
        var dir = S.dir === 'asc' ? 1 : -1;
        if (typeof x === 'number' || typeof y === 'number' || x === null || y === null) {
          var nx = x === null || x === undefined ? -1 : typeof x === 'number' ? x : -1;
          var ny = y === null || y === undefined ? -1 : typeof y === 'number' ? y : -1;
          return (nx - ny) * dir;
        }
        return String(x || '').localeCompare(String(y || '')) * dir;
      });
    }

    function sortBy(key) {
      if (S.sort === key) {
        S.dir = S.dir === 'asc' ? 'desc' : 'asc';
      } else {
        S.sort = key;
        var def = SORTS.filter(function (s) { return s.key === key; })[0];
        S.dir = def ? def.first : 'asc';
      }
      render();
    }

    /* ── staging: the REAL tag read (the prototype faked this half) ──────── */

    function synchsafe(b, i) {
      return ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f);
    }
    function decodeText(bytes) {
      if (bytes.length === 0) return '';
      var enc = bytes[0];
      var body = bytes.subarray(1);
      try {
        if (enc === 1) return new TextDecoder('utf-16').decode(body).replace(/\0+$/, '');
        if (enc === 2) return new TextDecoder('utf-16be').decode(body).replace(/\0+$/, '');
        if (enc === 3) return new TextDecoder('utf-8').decode(body).replace(/\0+$/, '');
        return new TextDecoder('latin1').decode(body).replace(/\0+$/, '');
      } catch (e) { return ''; }
    }
    function readId3(buffer) {
      var out = { title: '', artist: '', album: '', genre: '', cover: null };
      var b = new Uint8Array(buffer);
      if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return out;
      var version = b[3];
      var tagEnd = 10 + synchsafe(b, 6);
      var i = 10;
      while (i + 10 <= tagEnd && i + 10 <= b.length) {
        var id = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
        if (!/^[A-Z0-9]{4}$/.test(id)) break;
        var size = version >= 4 ? synchsafe(b, i + 4)
          : (b[i + 4] << 24) | (b[i + 5] << 16) | (b[i + 6] << 8) | b[i + 7];
        if (size <= 0 || i + 10 + size > b.length) break;
        var body = b.subarray(i + 10, i + 10 + size);
        if (id === 'TIT2') out.title = decodeText(body);
        else if (id === 'TPE1') out.artist = decodeText(body);
        else if (id === 'TALB') out.album = decodeText(body);
        else if (id === 'TCON') out.genre = decodeText(body).replace(/^\(\d+\)/, '');
        else if (id === 'APIC' && out.cover === null) {
          var p = 1;
          while (p < body.length && body[p] !== 0) p++;
          p += 2;
          var wide = body[0] === 1 || body[0] === 2;
          if (wide) {
            while (p + 1 < body.length && (body[p] !== 0 || body[p + 1] !== 0)) p += 2;
            p += 2;
          } else {
            while (p < body.length && body[p] !== 0) p++;
            p += 1;
          }
          if (p < body.length) out.cover = body.subarray(p);
        }
        i += 10 + size;
      }
      return out;
    }
    function toBase64(bytes) {
      var chunk = 0x8000;
      var parts = [];
      for (var i = 0; i < bytes.length; i += chunk) {
        parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
      }
      return btoa(parts.join(''));
    }

    function addFiles(list) {
      var files = Array.prototype.slice.call(list || []);
      files.forEach(function (f) {
        S.sSeq += 1;
        var row = {
          key: 'u' + S.sSeq, file: f, name: f.name, size: f.size,
          state: 'reading', title: '', artist: '', album: '', genre: '',
          kind: /(^|[^a-z])(spot|jingle|werbung)/i.test(f.name) ? 'spot' : 'music',
          bytes: null, coverB64: '',
        };
        S.staged.push(row);
        var reader = new FileReader();
        reader.onload = function () {
          var buf = reader.result;
          row.bytes = new Uint8Array(buf);
          var tag = readId3(buf);
          row.title = tag.title || '';
          row.artist = tag.artist || '';
          row.album = tag.album || '';
          row.genre = tag.genre || '';
          if (tag.cover) row.coverB64 = toBase64(tag.cover);
          if (!row.title) {
            var base = row.name.replace(/\.[A-Za-z0-9]{1,5}$/, '');
            var parts = base.split(' - ');
            if (parts.length > 1) {
              if (!row.artist) row.artist = parts[0];
              row.title = parts.slice(1).join(' - ');
            } else {
              row.title = base;
            }
          }
          row.state = 'ready';
          render();
        };
        reader.onerror = function () { row.state = 'ready'; render(); };
        reader.readAsArrayBuffer(f);
      });
      render();
    }

    function stImport(key) {
      var row = null;
      S.staged.forEach(function (s) { if (s.key === key) row = s; });
      if (!row || row.state !== 'ready' || !row.bytes) return;
      row.state = 'importing';
      render();
      post('/music/tracks/upload', {
        imageData: toBase64(row.bytes),
        fileName: row.name,
        kind: row.kind,
        title: row.title.trim(),
        artist: row.artist.trim(),
        album: row.album.trim(),
        genre: row.genre.trim(),
        coverData: row.coverB64,
      }).then(function (resp) {
        S.staged = S.staged.filter(function (s) { return s.key !== key; });
        if (!resp.ok) {
          S.libNote = 'import failed: ' + (resp.error || 'the server refused it');
          render();
          return;
        }
        D.tracks.unshift({
          id: resp.trackId,
          kind: row.kind,
          title: resp.title,
          artist: resp.artist || null,
          album: resp.album || null,
          genre: resp.genre || null,
          dur: resp.duration === undefined ? null : resp.duration,
          size: resp.size || row.size,
          mime: resp.mime || null,
          file: row.name,
          cover: !!resp.hadCover,
          vid: 0, vidAt: '', plays: 0,
          up: todayStamp(), upd: todayStamp(),
        });
        S.sort = 'up'; S.dir = 'desc';
        S.libNote = resp.hadCover
          ? 'imported "' + resp.title + '", the cover is queued for its video'
          : 'imported "' + resp.title + '", no cover yet, so it sends as a voice player';
        render();
      });
    }

    /* ── row + drawer actions ───────────────────────────────────────────── */

    function removeTrack(id) {
      var t = trackById(id);
      if (!t) return;
      post('/music/tracks/' + id + '/delete', { confirm: 'on' }).then(function (resp) {
        if (!resp.ok) { S.libNote = resp.error || 'delete failed'; render(); return; }
        D.tracks = D.tracks.filter(function (x) { return x.id !== id; });
        D.playlists.forEach(function (p) {
          p.trackIds = p.trackIds.filter(function (x) { return x !== id; });
        });
        delete S.checked[id];
        if (S.drawer && S.drawer.id === id) S.drawer = null;
        var ps = window.CinPlayer && window.CinPlayer.state();
        if (ps && ps.tid === id) window.CinPlayer.stop();
        S.libNote = 'track deleted, with its file, its cover, its cached video and its plays';
        render();
      });
    }

    function openDrawer(id) {
      var t = trackById(id);
      if (!t) return;
      S.drawer = {
        id: id,
        draft: { title: t.title, artist: t.artist || '', album: t.album || '', genre: t.genre || '', kind: t.kind },
        savedAt: '', cpk: null, coverState: '', vidNote: '', delArm: false,
      };
      render();
    }

    /* ── rendering ──────────────────────────────────────────────────────── */

    function renderHeader() {
      var head = q('tableHeader');
      head.textContent = '';
      head.appendChild(el('span')).appendChild((function () {
        var c = document.createElement('input');
        c.type = 'checkbox';
        c.setAttribute('aria-label', 'Select every shown track');
        c.title = 'Tick everything shown; tick again to clear';
        var rows = filtered();
        c.checked = rows.length > 0 && rows.every(function (t) { return S.checked[t.id]; });
        c.addEventListener('change', function () {
          var rows2 = filtered();
          if (c.checked) rows2.forEach(function (t) { S.checked[t.id] = true; });
          else rows2.forEach(function (t) { delete S.checked[t.id]; });
          render();
        });
        return c;
      })());
      head.appendChild(el('span'));
      head.appendChild(el('span'));
      SORTS.forEach(function (s) {
        var b = el('button', 'mus-th', s.label);
        b.type = 'button';
        if (s.right) b.style.justifyContent = 'flex-end';
        var active = S.sort === s.key;
        b.style.color = active ? 'var(--accent)' : 'var(--text-faint)';
        var caret = el('span', 'mus-caret');
        caret.style.transform = S.dir === 'asc' ? 'rotate(225deg)' : 'rotate(45deg)';
        caret.style.opacity = active ? '1' : '0';
        b.appendChild(caret);
        b.addEventListener('click', function () { sortBy(s.key); });
        head.appendChild(b);
      });
      var vid = el('span', 'mus-th', 'Video');
      vid.style.cursor = 'default';
      vid.title = 'Cached video';
      head.appendChild(vid);
      var act = el('span', 'mus-th', 'Actions');
      act.style.cursor = 'default';
      act.style.justifyContent = 'flex-end';
      head.appendChild(act);
    }

    function renderRows() {
      var wrap = q('tableRows');
      wrap.textContent = '';
      var rows = filtered();
      var ps = window.CinPlayer ? window.CinPlayer.state() : null;

      rows.forEach(function (t) {
        var r = el('div', 'music-grid music-row');
        r.setAttribute('data-row', '');
        if (S.drawer && S.drawer.id === t.id) r.style.background = 'rgba(69,189,209,.07)';

        var cbBox = el('span');
        cbBox.style.display = 'flex';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!S.checked[t.id];
        cb.setAttribute('aria-label', 'Select ' + t.title);
        cb.addEventListener('change', function () {
          if (cb.checked) S.checked[t.id] = true; else delete S.checked[t.id];
          render();
        });
        cbBox.appendChild(cb);
        r.appendChild(cbBox);

        var playing = ps && ps.tid === t.id && ps.on;
        var pb = el('button', 'mus-play');
        pb.type = 'button';
        if (playing) pb.setAttribute('data-on', '1');
        pb.setAttribute('aria-label', (playing ? 'Pause ' : 'Play ') + t.title);
        pb.innerHTML = playing
          ? '<svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>'
          : '<svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>';
        pb.addEventListener('click', function () {
          if (window.CinPlayer) window.CinPlayer.play({ id: t.id, title: t.title, artist: t.artist });
        });
        r.appendChild(pb);

        var cv = el('span', 'music-cover-cell');
        if (t.cover) {
          var img = document.createElement('img');
          img.src = '/music/tracks/' + t.id + '/cover.jpg';
          img.alt = '';
          img.width = 28; img.height = 28;
          img.className = 'music-cover-img';
          cv.title = 'Cover from the file';
          cv.appendChild(img);
        } else {
          cv.className += ' music-cover-empty';
          cv.title = 'No cover. Sent as title plus voice player.';
        }
        r.appendChild(cv);

        var title = el('span', 'music-cell-title', t.title);
        r.appendChild(title);
        r.appendChild(el('span', 'music-cell-artist', t.artist || 'no artist in the tag'));
        var kind = el('span', 'music-cell-kind', t.kind);
        kind.style.color = t.kind === 'spot' ? 'var(--warning)' : 'var(--text-muted)';
        r.appendChild(kind);

        var g = el('button', 'music-cell-genre', t.genre || 'no genre');
        g.type = 'button';
        g.title = 'Filter by this genre';
        g.style.color = t.genre ? 'var(--text-soft)' : 'var(--text-faint)';
        g.addEventListener('click', function () {
          S.fGenre = t.genre || '(no genre)';
          render();
        });
        r.appendChild(g);

        var time = el('span', 'music-cell-num', mmss(t.dur));
        time.style.color = t.dur === null ? 'var(--warning)' : 'var(--text-soft)';
        r.appendChild(time);
        r.appendChild(el('span', 'music-cell-num', mb(t.size)));
        var plays = el('span', 'music-cell-num', String(t.plays));
        plays.style.color = 'var(--text-faint)';
        r.appendChild(plays);

        var v = el('span', 'music-cell-video');
        if (!t.cover) { v.textContent = 'n/a'; v.style.color = 'var(--text-faint)'; v.title = 'No cover, so there is nothing to encode'; }
        else if (t.vid > 0) { v.textContent = 'cached'; v.style.color = 'var(--success)'; v.title = 'Cached video, ' + mb(t.vid); }
        else { v.textContent = 'not built'; v.style.color = 'var(--text-muted)'; v.title = 'Built on first send, or from the track panel'; }
        r.appendChild(v);

        var acts = el('span', 'music-cell-actions');
        var edit = el('button', 'admin-action-button mus-act', 'Edit');
        edit.type = 'button';
        edit.addEventListener('click', function () { openDrawer(t.id); });
        acts.appendChild(edit);
        var armed = S.delArmRow === t.id;
        var del = el('button', 'admin-action-button admin-action-danger mus-act', armed ? 'Again?' : 'Delete');
        del.type = 'button';
        del.style.color = armed ? '#fff' : 'var(--danger)';
        del.addEventListener('click', function () {
          if (S.delArmRow === t.id) {
            if (S.delArmT) { clearTimeout(S.delArmT); S.delArmT = null; }
            S.delArmRow = null;
            removeTrack(t.id);
          } else {
            if (S.delArmT) clearTimeout(S.delArmT);
            S.delArmRow = t.id;
            S.delArmT = setTimeout(function () { S.delArmRow = null; S.delArmT = null; render(); }, 2800);
            render();
          }
        });
        acts.appendChild(del);
        r.appendChild(acts);

        wrap.appendChild(r);
      });

      var all = D.tracks.length;
      q('countLine').textContent = rows.length === all ? all + ' tracks' : rows.length + ' of ' + all + ' tracks';
      var sumSize = rows.reduce(function (n, t) { return n + t.size; }, 0);
      var sumDur = rows.reduce(function (n, t) { return n + (t.dur || 0); }, 0);
      q('footLine').textContent = rows.length + ' shown · ' + mb(sumSize) + ' · ' + mmss(sumDur) + ' of audio · a click on a genre filters by it';
      q('footRow').hidden = rows.length === 0;
      q('tableWrap').hidden = rows.length === 0;
      var empty = q('emptyBox');
      empty.hidden = rows.length > 0;
      if (rows.length === 0) {
        if (all === 0) {
          q('emptyTitle').textContent = 'The library is empty.';
          q('emptyNote').textContent = 'Drop audio files above to start. An empty library on a fresh install is a normal state, not a fault.';
        } else {
          q('emptyTitle').textContent = 'Nothing matches these filters.';
          q('emptyNote').textContent = 'Reset the filters above, or search for something else. The tracks are still there.';
        }
      }
    }

    function renderChrome() {
      var orig = D.usage.orig; var enc = D.usage.enc;
      q('metaLine').textContent = D.tracks.length + ' tracks · ' + D.playlists.length + ' playlists · ' + mb(orig + enc) + ' on disk';
      var sel = q('fGenre');
      var keep = S.fGenre;
      sel.textContent = '';
      var opt0 = document.createElement('option');
      opt0.value = ''; opt0.textContent = 'All genres';
      sel.appendChild(opt0);
      genresAll().forEach(function (g) {
        var o = document.createElement('option');
        o.value = g; o.textContent = g;
        sel.appendChild(o);
      });
      sel.value = keep;
      var dl = q('genreDatalist');
      dl.textContent = '';
      genresAll().forEach(function (g) {
        if (g === '(no genre)') return;
        var o = document.createElement('option');
        o.value = g;
        dl.appendChild(o);
      });
      q('clearF').hidden = !(S.q || S.fKind || S.fGenre || S.fX);
      var note = q('libNote');
      note.hidden = !S.libNote;
      note.textContent = S.libNote;

      var checkedIds = Object.keys(S.checked);
      var bar = q('bulkBar');
      bar.hidden = checkedIds.length === 0;
      if (checkedIds.length > 0) {
        q('checkedLine').textContent = checkedIds.length === 1 ? '1 track selected' : checkedIds.length + ' tracks selected';
        var bp = q('bulkPl');
        var keepPl = bp.value;
        bp.textContent = '';
        D.playlists.forEach(function (p) {
          var o = document.createElement('option');
          o.value = String(p.id); o.textContent = p.name;
          bp.appendChild(o);
        });
        if (keepPl) bp.value = keepPl;
      }
    }

    function renderStaged() {
      var cardEl = q('stagedCard');
      cardEl.hidden = S.staged.length === 0;
      if (S.staged.length === 0) return;
      var ready = S.staged.filter(function (s) { return s.state === 'ready'; }).length;
      q('stagedLine').textContent = ready + ' of ' + S.staged.length + ' read and ready';
      q('importAll').disabled = ready === 0;
      q('importAll').style.opacity = ready === 0 ? '0.45' : '1';
      var wrap = q('stagedRows');
      wrap.textContent = '';
      S.staged.forEach(function (s) {
        var r = el('div', 'music-staged-grid music-staged-row');
        var busy = s.state !== 'ready';
        var mk = function (val, ph, label, key) {
          var i = document.createElement('input');
          i.value = val;
          i.placeholder = ph;
          i.setAttribute('aria-label', label);
          i.disabled = busy;
          i.addEventListener('input', function () { s[key] = i.value; });
          return i;
        };
        r.appendChild(mk(s.title, s.state === 'reading' ? '' : 'no title in the tag', 'Title', 'title'));
        r.appendChild(mk(s.artist, 'no artist in the tag', 'Artist', 'artist'));
        r.appendChild(mk(s.genre, 'no genre in the tag', 'Genre', 'genre'));
        var ks = document.createElement('select');
        ['music', 'audiobook', 'documentary', 'spot'].forEach(function (k) {
          var o = document.createElement('option');
          o.value = k; o.textContent = k;
          ks.appendChild(o);
        });
        ks.value = s.kind;
        ks.disabled = busy;
        ks.setAttribute('aria-label', 'Kind');
        ks.addEventListener('change', function () { s.kind = ks.value; });
        r.appendChild(ks);
        var st = el('span', 'music-staged-state');
        st.style.color = busy ? 'var(--accent)' : 'var(--text-faint)';
        st.textContent = s.state === 'reading' ? 'reading the tag'
          : s.state === 'importing' ? 'importing'
          : mb(s.size) + ' · ' + (s.dur !== undefined && s.dur !== null ? mmss(s.dur) : 'duration on import');
        r.appendChild(st);
        var imp = el('button', 'admin-action-button admin-action-primary', 'Import');
        imp.type = 'button';
        imp.disabled = busy;
        imp.style.opacity = busy ? '0.45' : '1';
        imp.style.justifySelf = 'end';
        imp.addEventListener('click', function () { stImport(s.key); });
        r.appendChild(imp);
        wrap.appendChild(r);
      });
    }

    function renderDrawer() {
      var aside = q('drawer');
      var body = q('drawerBody');
      var d = S.drawer;
      aside.setAttribute('aria-hidden', d ? 'false' : 'true');
      aside.style.transform = d ? 'translateX(0)' : 'translateX(104%)';
      body.textContent = '';
      if (!d) return;
      var t = trackById(d.id);
      if (!t) { S.drawer = null; return; }

      var dirtyKeys = ['title', 'artist', 'album', 'genre', 'kind'].filter(function (k) {
        return (d.draft[k] || '') !== (t[k] || '');
      });
      var dirty = dirtyKeys.length > 0;

      var head = el('div', 'music-drawer-head');
      head.appendChild(el('span', 'music-kicker', 'Track'));
      if (dirty) {
        head.appendChild(el('span', 'music-dirty-count', dirtyKeys.length === 1 ? '1 unsaved change' : dirtyKeys.length + ' unsaved changes'));
      } else {
        var savedLine = el('span', 'music-saved-line', d.savedAt ? 'saved ' + d.savedAt : 'no pending changes');
        savedLine.setAttribute('aria-live', 'polite');
        head.appendChild(savedLine);
      }
      head.appendChild(el('div', 'music-head-spacer'));
      var close = el('button', 'admin-action-button mus-act', 'Close');
      close.type = 'button';
      close.setAttribute('aria-label', 'Close the track panel');
      close.addEventListener('click', function () { S.drawer = null; render(); });
      head.appendChild(close);
      body.appendChild(head);

      var id2 = el('div', 'music-drawer-id');
      var cov = el('span', 'music-drawer-cover');
      if (t.cover) {
        var img = document.createElement('img');
        img.src = '/music/tracks/' + t.id + '/cover.jpg';
        img.alt = ''; img.width = 64; img.height = 64;
        img.className = 'music-drawer-cover-img';
        cov.appendChild(img);
      } else {
        cov.className += ' music-cover-empty';
      }
      id2.appendChild(cov);
      var idText = el('div', 'music-drawer-idtext');
      idText.appendChild(el('div', 'music-drawer-title', t.title));
      idText.appendChild(el('div', 'music-drawer-meta', t.kind + ' · ' + (t.album || 'no album') + ' · ' + mmss(t.dur)));
      var shape = el('div', 'music-drawer-shape');
      if (t.cover) {
        shape.textContent = 'With a cover she sends one video message: the cover as the picture, the audio as the sound.';
        shape.style.color = 'var(--text-muted)';
      } else {
        shape.textContent = 'Without a cover she sends the title as text plus a bare voice player. Two messages, and a normal state.';
        shape.style.color = 'var(--warning)';
      }
      idText.appendChild(shape);
      id2.appendChild(idText);
      body.appendChild(id2);

      var visible = filtered().some(function (x) { return x.id === t.id; });
      if (!visible) {
        body.appendChild(el('p', 'music-drawer-hiddenline', 'Outside the current filter, still open here.'));
      }

      var form = el('div', 'music-drawer-form');
      var fld = function (label, key, ph, list) {
        var lab = el('label', 'music-field');
        lab.appendChild(el('span', 'music-field-label', label));
        var i = document.createElement('input');
        i.value = d.draft[key];
        if (ph) i.placeholder = ph;
        if (list) i.setAttribute('list', list);
        i.addEventListener('input', function () { d.draft[key] = i.value; render(); });
        lab.appendChild(i);
        return lab;
      };
      form.appendChild(fld('Title', 'title', ''));
      var two = el('div', 'music-field-pair');
      two.appendChild(fld('Artist', 'artist', 'not in the tag'));
      two.appendChild(fld('Album', 'album', 'not in the tag'));
      form.appendChild(two);
      var two2 = el('div', 'music-field-pair');
      two2.appendChild(fld('Genre', 'genre', 'no genre', 'mus-genres'));
      var kindLab = el('label', 'music-field');
      kindLab.appendChild(el('span', 'music-field-label', 'Kind'));
      var kindSel = document.createElement('select');
      ['music', 'audiobook', 'documentary', 'spot'].forEach(function (k) {
        var o = document.createElement('option');
        o.value = k; o.textContent = k;
        kindSel.appendChild(o);
      });
      kindSel.value = d.draft.kind;
      kindSel.addEventListener('change', function () { d.draft.kind = kindSel.value; render(); });
      kindLab.appendChild(kindSel);
      two2.appendChild(kindLab);
      form.appendChild(two2);
      body.appendChild(form);

      var saveRow = el('div', 'music-drawer-saverow');
      var save = el('button', 'admin-action-button admin-action-primary', 'Save changes');
      save.type = 'button';
      save.disabled = !dirty;
      save.style.opacity = dirty ? '1' : '0.45';
      save.addEventListener('click', function () {
        post('/music/tracks/' + t.id + '/meta', {
          title: d.draft.title, artist: d.draft.artist, album: d.draft.album,
          genre: d.draft.genre, kind: d.draft.kind,
        }).then(function (resp) {
          if (!resp.ok) return;
          t.title = d.draft.title.trim() || 'Untitled';
          t.artist = d.draft.artist.trim() || null;
          t.album = d.draft.album.trim() || null;
          t.genre = d.draft.genre.trim() || null;
          t.kind = d.draft.kind;
          t.upd = todayStamp();
          d.draft = { title: t.title, artist: t.artist || '', album: t.album || '', genre: t.genre || '', kind: t.kind };
          d.savedAt = clock();
          render();
        });
      });
      saveRow.appendChild(save);
      if (dirty) {
        var rev = el('button', 'admin-action-button', 'Revert');
        rev.type = 'button';
        rev.addEventListener('click', function () {
          d.draft = { title: t.title, artist: t.artist || '', album: t.album || '', genre: t.genre || '', kind: t.kind };
          render();
        });
        saveRow.appendChild(rev);
      }
      body.appendChild(saveRow);

      /* Cover */
      var covBlock = el('div', 'music-drawer-block');
      covBlock.appendChild(el('span', 'music-kicker', 'Cover'));
      covBlock.appendChild(el('p', 'music-drawer-copy', t.cover
        ? 'Choosing an image does not replace anything yet. The second press uploads it and queues a re-encode.'
        : 'No cover. Choosing an image does not add it yet: the second press uploads it.'));
      var covRow = el('div', 'music-drawer-controls');
      var covLabel = el('label', 'admin-action-button', 'Choose an image');
      covLabel.htmlFor = 'mus-cover';
      covLabel.style.cursor = 'pointer';
      covRow.appendChild(covLabel);
      var covInput = document.createElement('input');
      covInput.type = 'file';
      covInput.accept = 'image/*';
      covInput.id = 'mus-cover';
      covInput.className = 'music-visually-hidden';
      covInput.addEventListener('change', function () {
        var f = covInput.files && covInput.files[0];
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function () {
          d.cpk = { name: f.name, b64: toBase64(new Uint8Array(reader.result)) };
          d.coverState = 'picked';
          render();
        };
        reader.readAsArrayBuffer(f);
      });
      covRow.appendChild(covInput);
      var covApply = el('button', 'admin-action-button admin-action-primary', 'Upload and replace');
      covApply.type = 'button';
      covApply.disabled = !d.cpk;
      covApply.style.opacity = d.cpk ? '1' : '0.45';
      covApply.addEventListener('click', function () {
        if (!d.cpk) return;
        post('/music/tracks/' + t.id + '/cover', { imageData: d.cpk.b64 }).then(function (resp) {
          if (!resp.ok) { d.coverState = 'failed'; d.coverErr = resp.error || 'the server refused it'; render(); return; }
          t.cover = true;
          t.vid = 0; t.vidAt = '';
          d.cpk = null;
          d.coverState = 'applied';
          d.coverAt = clock();
          render();
        });
      });
      covRow.appendChild(covApply);
      covBlock.appendChild(covRow);
      var covState = el('p', 'music-drawer-state');
      covState.setAttribute('aria-live', 'polite');
      if (d.coverState === 'picked' && d.cpk) {
        covState.textContent = 'chosen, not uploaded yet: ' + d.cpk.name;
        covState.style.color = 'var(--warning)';
      } else if (d.coverState === 'applied') {
        covState.textContent = 'replaced at ' + d.coverAt + ', re-encode queued';
        covState.style.color = 'var(--success)';
      } else if (d.coverState === 'failed') {
        covState.textContent = d.coverErr;
        covState.style.color = 'var(--danger)';
        covState.setAttribute('role', 'alert');
      } else {
        covState.textContent = 'nothing chosen';
        covState.style.color = 'var(--text-faint)';
      }
      covBlock.appendChild(covState);
      body.appendChild(covBlock);

      /* Cached video */
      var vidBlock = el('div', 'music-drawer-block');
      var vidHead = el('div', 'music-drawer-blockhead');
      vidHead.appendChild(el('span', 'music-kicker', 'Cached video'));
      if (t.vid > 0) vidHead.appendChild(el('span', 'music-vid-ver', 'recipe v' + D.encodeVersion));
      vidBlock.appendChild(vidHead);
      var vidLine = t.cover === false
        ? 'Nothing to encode: the video is the cover plus the audio, and this track has no cover.'
        : t.vid > 0
          ? 'Cached, ' + mb(t.vid) + ', built ' + t.vidAt + '. A repeat send never re-encodes.'
          : 'Not built. The first send builds it, which is a wait a member can feel, so build it here instead.';
      vidBlock.appendChild(el('p', 'music-drawer-copy', vidLine));
      var vidRow = el('div', 'music-drawer-controls');
      var build = el('button', 'admin-action-button', t.vid > 0 ? 'Rebuild it' : 'Build it now');
      build.type = 'button';
      build.disabled = !t.cover;
      build.style.opacity = t.cover ? '1' : '0.45';
      build.addEventListener('click', function () {
        post('/music/tracks/' + t.id + '/encode', {}).then(function (resp) {
          if (!resp.ok) { d.vidNote = resp.error || 'the build could not be queued'; render(); return; }
          t.vid = 0; t.vidAt = '';
          d.vidNote = 'queued at ' + clock() + ', the encoder runs outside this request';
          render();
        });
      });
      vidRow.appendChild(build);
      if (t.vid > 0) {
        var vdel = el('button', 'admin-action-button admin-action-danger', 'Delete the cache');
        vdel.type = 'button';
        vdel.addEventListener('click', function () {
          post('/music/tracks/' + t.id + '/encode/delete', {}).then(function (resp) {
            if (!resp.ok) { d.vidNote = resp.error || 'delete failed'; render(); return; }
            t.vid = 0; t.vidAt = '';
            d.vidNote = 'cache deleted, the next send rebuilds it';
            render();
          });
        });
        vidRow.appendChild(vdel);
      }
      vidBlock.appendChild(vidRow);
      if (d.vidNote) {
        var vn = el('p', 'music-drawer-state', d.vidNote);
        vn.setAttribute('aria-live', 'polite');
        vn.style.color = 'var(--accent)';
        vidBlock.appendChild(vn);
      }
      body.appendChild(vidBlock);

      /* Facts */
      var facts = el('div', 'music-drawer-facts');
      var fact = function (label, value, colour) {
        facts.appendChild(el('span', 'music-diag-label', label));
        var v = el('span', 'music-mono', value);
        if (colour) v.style.color = colour;
        facts.appendChild(v);
      };
      fact('File', t.file);
      fact('Type', t.mime || 'unknown');
      fact('Size', mb(t.size));
      fact('Duration', mmss(t.dur), t.dur === null ? 'var(--warning)' : 'var(--text-soft)');
      fact('Uploaded', t.up);
      fact('Changed', t.upd);
      fact('Plays', String(t.plays));
      var inNames = playlistNamesOf(t.id);
      facts.appendChild(el('span', 'music-diag-label', 'In playlists'));
      facts.appendChild(el('span', 'music-drawer-in', inNames.length ? inNames.join(', ') : 'in no playlist'));
      body.appendChild(facts);

      /* Delete (no timer: armed until the drawer closes) */
      var delBlock = el('div', 'music-drawer-delrow');
      var delBtn = el('button', 'admin-action-button admin-action-danger', d.delArm ? 'Press again to delete' : 'Delete this track');
      delBtn.type = 'button';
      delBtn.addEventListener('click', function () {
        if (d.delArm) removeTrack(t.id);
        else { d.delArm = true; render(); }
      });
      delBlock.appendChild(delBtn);
      var delNote = el('span', 'music-drawer-delnote', d.delArm
        ? 'The file, the cover, the cached video and its play records go with it.'
        : 'Two presses, because the file and its plays go with it.');
      delNote.style.color = d.delArm ? 'var(--danger)' : 'var(--text-faint)';
      delBlock.appendChild(delNote);
      body.appendChild(delBlock);
    }

    function render() {
      renderChrome();
      renderStaged();
      renderHeader();
      renderRows();
      renderDrawer();
    }

    /* wiring */
    q('q').addEventListener('input', function (e) { S.q = e.target.value; render(); });
    q('fKind').addEventListener('change', function (e) { S.fKind = e.target.value; render(); });
    q('fGenre').addEventListener('change', function (e) { S.fGenre = e.target.value; render(); });
    q('fX').addEventListener('change', function (e) { S.fX = e.target.value; render(); });
    q('clearF').addEventListener('click', function () { S.q = ''; S.fKind = ''; S.fGenre = ''; S.fX = ''; q('q').value = ''; q('fKind').value = ''; q('fX').value = ''; render(); });
    var dz = q('dz');
    dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.setAttribute('data-dz', 'on'); });
    dz.addEventListener('dragleave', function () { dz.setAttribute('data-dz', 'off'); });
    dz.addEventListener('drop', function (e) { e.preventDefault(); dz.setAttribute('data-dz', 'off'); addFiles(e.dataTransfer.files); });
    document.getElementById('mus-files').addEventListener('change', function (e) { addFiles(e.target.files); e.target.value = ''; });
    q('importAll').addEventListener('click', function () {
      S.staged.filter(function (s) { return s.state === 'ready'; }).forEach(function (s) { stImport(s.key); });
    });
    q('discardAll').addEventListener('click', function () { S.staged = []; render(); });
    q('bulkAdd').addEventListener('click', function () {
      var ids = Object.keys(S.checked).map(Number);
      var plId = Number(q('bulkPl').value);
      var pl = null;
      D.playlists.forEach(function (p) { if (p.id === plId) pl = p; });
      if (!pl || ids.length === 0) return;
      var add = ids.filter(function (id) { return pl.trackIds.indexOf(id) < 0 && trackById(id); });
      post('/music/playlists/add-tracks', { playlistId: plId, trackIds: ids.join(',') }).then(function (resp) {
        if (!resp.ok) { S.libNote = resp.error || 'add failed'; render(); return; }
        add.forEach(function (id) { pl.trackIds.push(id); });
        var skipped = ids.length - add.length;
        S.libNote = (add.length === 1 ? '1 track added to "' : add.length + ' tracks added to "') + pl.name + '"'
          + (skipped > 0 ? ', ' + skipped + ' already in it' : '');
        S.checked = {};
        render();
      });
    });
    q('clearChecked').addEventListener('click', function () { S.checked = {}; render(); });
    if (window.CinPlayer) window.CinPlayer.onChange(function () { renderRows(); });
    render();
  }

  /* ══ PLAYLISTS ═════════════════════════════════════════════════════════ */

  function playlistsPage() {
    var S = {
      sel: D.playlists.length ? D.playlists[0].id : null,
      drawerOpen: false,
      plNote: '', plNoteOk: true,
      nameDraft: '',
      pickOpen: false, pickQ: '', ticks: {},
      delArmRow: null, delArmT: null,
      rmArm: null, rmArmT: null, rmGoing: null,
      drawerDelArm: false,
    };

    function plById(id) {
      for (var i = 0; i < D.playlists.length; i++) if (D.playlists[i].id === id) return D.playlists[i];
      return null;
    }
    function heldBy(pl) {
      return D.assignments.filter(function (a) { return a.playlistId === pl.id; })
        .map(function (a) { return a.bot + (a.mode === 'cadence' ? ' (cadence)' : ''); });
    }
    function note(text, ok) { S.plNote = text; S.plNoteOk = ok !== false; }

    function removeFromOrder(pl, trackId) {
      pl.trackIds = pl.trackIds.filter(function (x) { return x !== trackId; });
      post('/music/playlists/' + pl.id + '/order', { trackIds: pl.trackIds.join(',') }).then(function () {
        note('removed from this playlist, the track stays in the library');
        render();
      });
    }

    function render() {
      var wrap = q('plRows');
      wrap.textContent = '';
      var ps = window.CinPlayer ? window.CinPlayer.state() : null;
      D.playlists.forEach(function (p) {
        var r = el('div', 'music-pl-grid music-row');
        r.setAttribute('data-row', '');
        if (S.drawerOpen && S.sel === p.id) r.style.background = 'rgba(69,189,209,.07)';
        r.appendChild(el('span', 'music-pl-name', p.name));
        var n = el('span', 'music-cell-num', String(p.trackIds.length));
        n.style.color = p.trackIds.length > 0 ? 'var(--text)' : 'var(--text-faint)';
        r.appendChild(n);
        var total = p.trackIds.reduce(function (sum, id) {
          var t = trackById(id);
          return sum + (t && t.dur ? t.dur : 0);
        }, 0);
        r.appendChild(el('span', 'music-cell-num', mmss(total)));
        var held = heldBy(p);
        var h = el('span', 'music-pl-held', held.length ? held.join(', ') : 'no bot yet');
        h.style.color = held.length ? 'var(--text-soft)' : 'var(--text-faint)';
        r.appendChild(h);

        var acts = el('span', 'music-cell-actions');
        var play = el('button', 'mus-play');
        play.type = 'button';
        play.setAttribute('aria-label', 'Play "' + p.name + '" from the top');
        if (ps && ps.qName === p.name && ps.on) play.setAttribute('data-on', '1');
        play.innerHTML = '<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>';
        play.addEventListener('click', function () {
          var tracks = p.trackIds.map(trackById).filter(Boolean);
          if (tracks.length === 0) { note('"' + p.name + '" is empty, nothing to play', false); render(); return; }
          if (window.CinPlayer) window.CinPlayer.playQueue(p.name, tracks.map(function (t) { return { id: t.id, title: t.title, artist: t.artist }; }));
        });
        acts.appendChild(play);
        var edit = el('button', 'admin-action-button mus-act', 'Edit');
        edit.type = 'button';
        edit.addEventListener('click', function () {
          S.sel = p.id;
          S.drawerOpen = true;
          S.nameDraft = p.name;
          S.pickOpen = false; S.ticks = {}; S.drawerDelArm = false;
          render();
        });
        acts.appendChild(edit);
        var armed = S.delArmRow === p.id;
        var del = el('button', 'admin-action-button admin-action-danger mus-act', armed ? 'Again?' : 'Delete');
        del.type = 'button';
        del.style.color = armed ? '#fff' : 'var(--danger)';
        del.addEventListener('click', function () {
          if (S.delArmRow === p.id) {
            if (S.delArmT) { clearTimeout(S.delArmT); S.delArmT = null; }
            S.delArmRow = null;
            deletePl(p.id);
          } else {
            if (S.delArmT) clearTimeout(S.delArmT);
            S.delArmRow = p.id;
            S.delArmT = setTimeout(function () { S.delArmRow = null; S.delArmT = null; render(); }, 2800);
            render();
          }
        });
        acts.appendChild(del);
        r.appendChild(acts);
        wrap.appendChild(r);
      });

      var noteLine = q('plNote');
      noteLine.textContent = S.plNote;
      noteLine.style.color = S.plNoteOk ? 'var(--accent)' : 'var(--danger)';

      renderDrawer();
    }

    function deletePl(id) {
      post('/music/playlists/' + id + '/delete', { confirm: 'on' }).then(function (resp) {
        if (!resp.ok) { note(resp.error || 'delete failed', false); render(); return; }
        D.playlists = D.playlists.filter(function (p) { return p.id !== id; });
        D.assignments = D.assignments.filter(function (a) { return a.playlistId !== id; });
        if (S.sel === id) { S.sel = D.playlists.length ? D.playlists[0].id : null; S.drawerOpen = false; }
        note('deleted, the tracks themselves stay');
        render();
      });
    }

    function renderDrawer() {
      var aside = q('drawer');
      var body = q('drawerBody');
      var open = S.drawerOpen && S.sel !== null;
      aside.setAttribute('aria-hidden', open ? 'false' : 'true');
      aside.style.transform = open ? 'translateX(0)' : 'translateX(104%)';
      body.textContent = '';
      if (!open) return;
      var p = plById(S.sel);
      if (!p) { S.drawerOpen = false; return; }
      var total = p.trackIds.reduce(function (sum, id) {
        var t = trackById(id);
        return sum + (t && t.dur ? t.dur : 0);
      }, 0);

      var head = el('div', 'music-drawer-head');
      head.appendChild(el('span', 'music-kicker', 'Playlist'));
      head.appendChild(el('span', 'music-saved-line', p.trackIds.length + ' tracks · ' + mmss(total)));
      head.appendChild(el('div', 'music-head-spacer'));
      var close = el('button', 'admin-action-button mus-act', 'Close');
      close.type = 'button';
      close.setAttribute('aria-label', 'Close the playlist panel');
      close.addEventListener('click', function () { S.drawerOpen = false; render(); });
      head.appendChild(close);
      body.appendChild(head);

      var renameRow = el('div', 'music-drawer-saverow');
      var nameInput = document.createElement('input');
      nameInput.value = S.nameDraft;
      nameInput.setAttribute('aria-label', 'Playlist name');
      nameInput.style.flex = '1';
      nameInput.style.fontWeight = '600';
      nameInput.addEventListener('input', function () { S.nameDraft = nameInput.value; render(); });
      renameRow.appendChild(nameInput);
      var clean = S.nameDraft.trim() === '' || S.nameDraft.trim() === p.name;
      var ren = el('button', 'admin-action-button', 'Rename');
      ren.type = 'button';
      ren.disabled = clean;
      ren.addEventListener('click', function () {
        post('/music/playlists/' + p.id + '/rename', { name: S.nameDraft.trim() }).then(function (resp) {
          if (!resp.ok) { note(resp.error || 'rename failed', false); render(); return; }
          p.name = S.nameDraft.trim();
          note('renamed at ' + clock());
          render();
        });
      });
      renameRow.appendChild(ren);
      body.appendChild(renameRow);

      var held = heldBy(p);
      body.appendChild(el('p', 'music-drawer-copy', held.length
        ? 'Held by ' + held.join(', ') + '. Changing the order changes what those bots play.'
        : 'No bot holds it yet. Assign it under Assignments.'));
      var echo = el('p', 'music-drawer-state', S.plNote);
      echo.setAttribute('aria-live', 'polite');
      echo.style.color = S.plNoteOk ? 'var(--accent)' : 'var(--danger)';
      body.appendChild(echo);

      /* Order */
      var orderBlock = el('div', 'music-drawer-block');
      var oh = el('div', 'music-drawer-blockhead');
      oh.appendChild(el('span', 'music-kicker', 'Order'));
      oh.appendChild(el('span', 'music-order-caption', 'what she plays, top to bottom'));
      orderBlock.appendChild(oh);
      if (p.trackIds.length === 0) {
        orderBlock.appendChild(el('p', 'music-drawer-copy', 'Empty. A normal state: she holds it and plays nothing from it until tracks are added.'));
      }
      p.trackIds.forEach(function (id, idx) {
        var t = trackById(id);
        var r = el('div', 'music-order-row');
        if (S.rmGoing === id) { r.style.transform = 'translateX(52px)'; r.style.opacity = '0'; }
        r.appendChild(el('span', 'music-order-pos', String(idx + 1)));
        r.appendChild(el('span', 'music-order-title', t ? t.title : 'deleted track'));
        r.appendChild(el('span', 'music-order-time', t ? mmss(t.dur) : 'unknown'));
        var ctl = el('span', 'music-order-ctl');
        var mk = function (label, rot, fn) {
          var b = el('button', 'music-order-btn');
          b.type = 'button';
          b.setAttribute('aria-label', label);
          b.title = label;
          var c = el('span', 'mus-caret');
          c.style.transform = rot;
          b.appendChild(c);
          b.addEventListener('click', fn);
          return b;
        };
        ctl.appendChild(mk('Move up', 'rotate(225deg) translate(-1px,-1px)', function () {
          if (idx === 0) return;
          var arr = p.trackIds;
          var tmp = arr[idx - 1]; arr[idx - 1] = arr[idx]; arr[idx] = tmp;
          post('/music/playlists/' + p.id + '/order', { trackIds: arr.join(',') });
          render();
        }));
        ctl.appendChild(mk('Move down', 'rotate(45deg) translate(-1px,-1px)', function () {
          if (idx >= p.trackIds.length - 1) return;
          var arr = p.trackIds;
          var tmp = arr[idx + 1]; arr[idx + 1] = arr[idx]; arr[idx] = tmp;
          post('/music/playlists/' + p.id + '/order', { trackIds: arr.join(',') });
          render();
        }));
        var armed = S.rmArm === id;
        var rmb = el('button', 'music-order-rm', armed ? 'sure?' : 'x');
        rmb.type = 'button';
        rmb.setAttribute('aria-label', armed ? 'Press again to remove' : 'Remove from playlist');
        rmb.title = armed ? 'Press again to remove' : 'Remove from playlist';
        if (armed) rmb.className += ' music-order-rm-armed';
        rmb.addEventListener('click', function () {
          if (S.rmGoing === id) return;
          if (S.rmArm === id) {
            if (S.rmArmT) { clearTimeout(S.rmArmT); S.rmArmT = null; }
            S.rmArm = null;
            S.rmGoing = id;
            render();
            var delay = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250;
            setTimeout(function () { S.rmGoing = null; removeFromOrder(p, id); }, delay);
          } else {
            if (S.rmArmT) clearTimeout(S.rmArmT);
            S.rmArm = id;
            S.rmArmT = setTimeout(function () { S.rmArm = null; S.rmArmT = null; render(); }, 2800);
            render();
          }
        });
        ctl.appendChild(rmb);
        r.appendChild(ctl);
        orderBlock.appendChild(r);
      });
      body.appendChild(orderBlock);

      /* Picker */
      var pickBlock = el('div', 'music-drawer-block');
      var pickRow = el('div', 'music-drawer-controls');
      var pickToggle = el('button', 'admin-action-button admin-action-primary', S.pickOpen ? 'Close the picker' : 'Add tracks');
      pickToggle.type = 'button';
      pickToggle.addEventListener('click', function () {
        S.pickOpen = !S.pickOpen;
        S.ticks = {}; S.pickQ = '';
        render();
      });
      pickRow.appendChild(pickToggle);
      var tickCount = Object.keys(S.ticks).length;
      if (S.pickOpen) {
        var addBtn = el('button', 'admin-action-button', 'Add ' + tickCount + ' ticked');
        addBtn.type = 'button';
        addBtn.disabled = tickCount === 0;
        addBtn.addEventListener('click', function () {
          var ids = Object.keys(S.ticks).map(Number).filter(function (id) { return p.trackIds.indexOf(id) < 0; });
          post('/music/playlists/add-tracks', { playlistId: p.id, trackIds: ids.join(',') }).then(function (resp) {
            if (!resp.ok) { note(resp.error || 'add failed', false); render(); return; }
            ids.forEach(function (id) { p.trackIds.push(id); });
            note(ids.length === 1 ? '1 track added' : ids.length + ' tracks added');
            S.ticks = {}; S.pickOpen = false;
            render();
          });
        });
        pickRow.appendChild(addBtn);
      }
      pickBlock.appendChild(pickRow);
      if (S.pickOpen) {
        var search = document.createElement('input');
        search.value = S.pickQ;
        search.placeholder = 'Search the library';
        search.setAttribute('aria-label', 'Search tracks to add');
        search.style.width = '100%';
        search.style.marginTop = '9px';
        search.addEventListener('input', function () { S.pickQ = search.value; render(); });
        pickBlock.appendChild(search);
        var list = el('div', 'music-pick-list');
        var needle = S.pickQ.trim().toLowerCase();
        var candidates = D.tracks.filter(function (t) {
          if (p.trackIds.indexOf(t.id) >= 0) return false;
          if (!needle) return true;
          return (t.title + ' ' + (t.artist || '')).toLowerCase().indexOf(needle) >= 0;
        });
        candidates.forEach(function (t) {
          var lab = el('label', 'music-pick-row');
          var cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = !!S.ticks[t.id];
          cb.addEventListener('change', function () {
            if (cb.checked) S.ticks[t.id] = true; else delete S.ticks[t.id];
            render();
          });
          lab.appendChild(cb);
          lab.appendChild(el('span', 'music-pick-label', t.artist ? t.title + ' · ' + t.artist : t.title));
          lab.appendChild(el('span', 'music-pick-time', mmss(t.dur)));
          list.appendChild(lab);
        });
        if (candidates.length === 0) {
          list.appendChild(el('p', 'music-pick-empty', 'Nothing matches, or everything is already in this playlist.'));
        }
        pickBlock.appendChild(list);
      }
      pickBlock.appendChild(el('p', 'music-drawer-copy', 'For many tracks at once: tick them in the Library and use "Add to playlist" there.'));
      body.appendChild(pickBlock);

      /* Delete */
      var delBlock = el('div', 'music-drawer-delrow');
      var delBtn = el('button', 'admin-action-button admin-action-danger', S.drawerDelArm ? 'Press again to delete' : 'Delete this playlist');
      delBtn.type = 'button';
      delBtn.addEventListener('click', function () {
        if (S.drawerDelArm) { S.drawerDelArm = false; deletePl(p.id); }
        else { S.drawerDelArm = true; render(); }
      });
      delBlock.appendChild(delBtn);
      var delNote = el('span', 'music-drawer-delnote', S.drawerDelArm
        ? 'Assignments to it go too. The tracks stay in the library.'
        : 'The tracks stay in the library.');
      delNote.style.color = S.drawerDelArm ? 'var(--danger)' : 'var(--text-faint)';
      delBlock.appendChild(delNote);
      body.appendChild(delBlock);
    }

    q('plCreate').addEventListener('click', function () {
      var name = q('newPl').value.trim();
      if (name === '') { note('A playlist needs a name.', false); render(); return; }
      var dup = D.playlists.some(function (p) { return p.name.toLowerCase() === name.toLowerCase(); });
      if (dup) { note('A playlist called "' + name + '" already exists.', false); render(); return; }
      post('/music/playlists/create', { name: name }).then(function (resp) {
        if (!resp.ok) { note(resp.error || 'create failed', false); render(); return; }
        D.playlists.push({ id: resp.id, name: name, trackIds: [] });
        S.sel = resp.id;
        q('newPl').value = '';
        note('created, empty until you add tracks');
        render();
      });
    });
    if (window.CinPlayer) window.CinPlayer.onChange(function () { render(); });
    render();
  }

  /* ══ ASSIGNMENTS ═══════════════════════════════════════════════════════ */

  function assignmentsPage() {
    var S = { note: 'nothing changed yet', noteOk: true, drafts: {} };
    D.assignments.forEach(function (a) {
      S.drafts[a.id] = {
        mode: a.mode, dest: a.dest === null ? '' : String(a.dest),
        mins: a.mins === null ? '' : String(a.mins), msgs: a.msgs === null ? '' : String(a.msgs),
        dirty: false, appliedAt: '',
      };
    });
    function note(text, ok) { S.note = text; S.noteOk = ok !== false; }

    function render() {
      var wrap = q('asgRows');
      wrap.textContent = '';
      q('asgEmpty').hidden = D.assignments.length > 0;
      D.assignments.forEach(function (a) {
        var d = S.drafts[a.id];
        var r = el('div', 'music-asg-grid music-row');
        r.setAttribute('data-row', '');
        r.style.boxShadow = d.dirty ? 'inset 3px 0 0 var(--warning)' : 'none';
        r.appendChild(el('span', 'music-asg-bot', a.bot));
        r.appendChild(el('span', 'music-asg-pl', a.playlist));

        var mode = document.createElement('select');
        mode.setAttribute('aria-label', 'Rhythm');
        [['on-request', 'on request only'], ['cadence', 'on a cadence']].forEach(function (pair) {
          var o = document.createElement('option');
          o.value = pair[0]; o.textContent = pair[1];
          mode.appendChild(o);
        });
        mode.value = d.mode;
        mode.addEventListener('change', function () {
          d.mode = mode.value;
          d.dirty = true;
          if (d.mode === 'on-request') { d.dest = ''; d.mins = ''; d.msgs = ''; }
          render();
        });
        r.appendChild(mode);

        var onReq = d.mode === 'on-request';
        var mkNum = function (key, ph, label, mono) {
          var i = document.createElement('input');
          i.value = d[key];
          i.placeholder = onReq ? (key === 'dest' ? 'not used' : '') : ph;
          i.setAttribute('aria-label', label);
          i.disabled = onReq;
          i.style.opacity = onReq ? '0.4' : '1';
          if (mono) { i.className = 'music-mono'; i.style.textAlign = key === 'dest' ? 'left' : 'right'; }
          i.addEventListener('input', function () { d[key] = i.value; d.dirty = true; render(); });
          return i;
        };
        r.appendChild(mkNum('dest', 'group id', 'Destination group id', true));
        r.appendChild(mkNum('mins', '1 to 10080', 'Every N minutes', true));
        r.appendChild(mkNum('msgs', '1 to 10000', 'Every N member messages', true));

        var stBox = el('span', 'music-asg-state');
        var st, stC;
        if (d.dirty) { st = 'not applied'; stC = 'var(--warning)'; }
        else if (d.mode === 'on-request') { st = 'on request only'; stC = 'var(--text-muted)'; }
        else { st = 'cadence active'; stC = 'var(--success)'; }
        var stLine = el('span', 'music-asg-st', st);
        stLine.style.color = stC;
        stBox.appendChild(stLine);
        var stNote = d.dirty ? 'press Apply to make it real'
          : d.appliedAt ? 'applied ' + d.appliedAt
          : a.last ? 'last sent ' + a.last
          : 'never sent';
        stBox.appendChild(el('span', 'music-asg-stnote', stNote));
        r.appendChild(stBox);

        var acts = el('span', 'music-cell-actions');
        var apply = el('button', 'admin-action-button admin-action-primary mus-act', d.mode === 'cadence' ? 'Set cadence' : 'Apply');
        apply.type = 'button';
        apply.disabled = !d.dirty;
        apply.style.opacity = d.dirty ? '1' : '0.45';
        apply.addEventListener('click', function () {
          if (d.mode === 'cadence') {
            if (d.dest.trim() === '') { note('A cadence needs a destination group.', false); render(); return; }
            if (d.mins.trim() === '' && d.msgs.trim() === '') {
              note('At least one trigger is required: an interval, a message count, or both.', false);
              render();
              return;
            }
            var mins = d.mins.trim() === '' ? null : Number(d.mins);
            var msgs = d.msgs.trim() === '' ? null : Number(d.msgs);
            if (mins !== null && (!Number.isInteger(mins) || mins < 1 || mins > 10080)) {
              note('Minutes run 1 to 10080.', false); render(); return;
            }
            if (msgs !== null && (!Number.isInteger(msgs) || msgs < 1 || msgs > 10000)) {
              note('Messages run 1 to 10000.', false); render(); return;
            }
            post('/music/assignments/' + a.id + '/cadence', {
              destGroupId: d.dest.trim(), intervalMinutes: d.mins.trim(), messageCount: d.msgs.trim(),
            }).then(function (resp) {
              if (!resp.ok) { note(resp.error || 'apply failed', false); render(); return; }
              a.mode = 'cadence';
              a.dest = Number(d.dest); a.mins = mins; a.msgs = msgs;
              d.dirty = false; d.appliedAt = clock();
              note('cadence set for ' + a.bot + ', it speaks unbidden from now on');
              render();
            });
          } else {
            post('/music/assignments/' + a.id + '/onrequest', {}).then(function (resp) {
              if (!resp.ok) { note(resp.error || 'apply failed', false); render(); return; }
              a.mode = 'on-request';
              a.dest = null; a.mins = null; a.msgs = null;
              d.dirty = false; d.appliedAt = clock();
              note('back to on request only for ' + a.bot);
              render();
            });
          }
        });
        acts.appendChild(apply);
        var rm = el('button', 'admin-action-button admin-action-danger mus-act', 'Take away');
        rm.type = 'button';
        rm.addEventListener('click', function () {
          post('/music/assignments/' + a.id + '/delete', {}).then(function (resp) {
            if (!resp.ok) { note(resp.error || 'remove failed', false); render(); return; }
            D.assignments = D.assignments.filter(function (x) { return x.id !== a.id; });
            delete S.drafts[a.id];
            note('the playlist was taken away, the tracks and the playlist stay');
            render();
          });
        });
        acts.appendChild(rm);
        r.appendChild(acts);
        wrap.appendChild(r);
      });

      var bot = q('newBot');
      var keepB = bot.value;
      bot.textContent = '';
      D.bots.forEach(function (b) {
        var o = document.createElement('option');
        o.value = String(b.id); o.textContent = b.name;
        bot.appendChild(o);
      });
      if (keepB) bot.value = keepB;
      var pls = q('newPlaylist');
      var keepP = pls.value;
      pls.textContent = '';
      D.playlists.forEach(function (p) {
        var o = document.createElement('option');
        o.value = String(p.id); o.textContent = p.name;
        pls.appendChild(o);
      });
      if (keepP) pls.value = keepP;

      var noteLine = q('asgNote');
      noteLine.textContent = S.note;
      noteLine.style.color = S.noteOk ? 'var(--accent)' : 'var(--danger)';
    }

    q('asgAdd').addEventListener('click', function () {
      var botId = Number(q('newBot').value);
      var plId = Number(q('newPlaylist').value);
      var botName = '';
      D.bots.forEach(function (b) { if (b.id === botId) botName = b.name; });
      if (!plId) { note('Create a playlist first.', false); render(); return; }
      var already = D.assignments.some(function (a) { return a.botId === botId && a.playlistId === plId; });
      if (already) { note(botName + ' already holds that playlist.', false); render(); return; }
      var plName = '';
      D.playlists.forEach(function (p) { if (p.id === plId) plName = p.name; });
      post('/music/assign', { botProfileId: botId, playlistId: plId }).then(function (resp) {
        if (!resp.ok) { note(resp.error || 'assign failed', false); render(); return; }
        D.assignments.push({ id: resp.id, botId: botId, bot: botName || 'bot ' + botId, playlistId: plId, playlist: plName || 'deleted playlist', mode: 'on-request', dest: null, mins: null, msgs: null, last: '' });
        S.drafts[resp.id] = { mode: 'on-request', dest: '', mins: '', msgs: '', dirty: false, appliedAt: clock() };
        note('assigned to ' + (botName || 'bot ' + botId) + ', on request only');
        render();
      });
    });
    render();
  }

  /* ══ STORAGE ═══════════════════════════════════════════════════════════ */

  function storagePage() {
    var fields = ['musicDailyCap', 'musicGapMinutes', 'spotDailyCap', 'spotGapMinutes', 'memberUploadMb'];
    var saved = {};
    fields.forEach(function (k) {
      var i = document.querySelector('[data-set="' + k + '"]');
      saved[k] = i ? i.value : '';
    });
    var savedAt = '';

    function render() {
      var dirtyKeys = fields.filter(function (k) {
        var i = document.querySelector('[data-set="' + k + '"]');
        return i && i.value !== saved[k];
      });
      var dirty = dirtyKeys.length > 0;
      var count = q('setCount');
      count.hidden = !dirty;
      if (dirty) count.textContent = dirtyKeys.length === 1 ? '1 unsaved change' : dirtyKeys.length + ' unsaved changes';
      q('setRevert').hidden = !dirty;
      q('setSave').hidden = !dirty;
      var line = q('setSavedLine');
      line.hidden = dirty;
      line.textContent = savedAt ? 'saved ' + savedAt : 'no pending changes';
    }

    fields.forEach(function (k) {
      var i = document.querySelector('[data-set="' + k + '"]');
      if (i) i.addEventListener('input', render);
    });
    q('setRevert').addEventListener('click', function () {
      fields.forEach(function (k) {
        var i = document.querySelector('[data-set="' + k + '"]');
        if (i) i.value = saved[k];
      });
      render();
    });
    q('setSave').addEventListener('click', function () {
      var vals = {};
      fields.forEach(function (k) {
        var i = document.querySelector('[data-set="' + k + '"]');
        vals[k] = i ? i.value : '';
      });
      post('/music/settings', {
        musicDailyCap: vals.musicDailyCap,
        musicGapMinutes: vals.musicGapMinutes,
        spotDailyCap: vals.spotDailyCap,
        spotGapMinutes: vals.spotGapMinutes,
        memberUploadMaxBytes: String(Math.round(Number(vals.memberUploadMb || '10') * 1048576)),
      }).then(function (resp) {
        if (!resp.ok) return;
        fields.forEach(function (k) { saved[k] = vals[k]; });
        savedAt = clock();
        render();
      });
    });

    document.querySelectorAll('[data-play-track]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = Number(b.getAttribute('data-play-track'));
        var t = trackById(id);
        if (t && window.CinPlayer) window.CinPlayer.play({ id: t.id, title: t.title, artist: t.artist });
      });
    });
    render();
  }

  if (D.page === 'library') libraryPage();
  else if (D.page === 'playlists') playlistsPage();
  else if (D.page === 'assignments') assignmentsPage();
  else if (D.page === 'storage') storagePage();
})();
