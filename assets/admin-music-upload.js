/**
 * The music upload client (CCB-S5-044 first-use fixes).
 *
 * ── WHY THE TAG IS READ HERE, IN THE BROWSER ─────────────────────────────────
 *
 * The operator's report from first use: genre and cover could not be entered at
 * upload - they came from the tag or not at all, and correcting them afterwards
 * was a second trip. Pre-filling BEFORE saving means reading the tag before the
 * bytes leave the machine, so this file carries a deliberately small ID3v2
 * reader: the three text frames the form shows (TIT2/TPE1/TCON) and APIC for
 * the cover preview. Everything it reads is EDITABLE and the edited value wins
 * on the server; a file with no readable tag simply leaves the fields empty.
 * The server still reads the tag with the real parser for duration and as the
 * fallback for anything left blank, so this reader being small costs nothing.
 *
 * ── WHY SEVERAL FILES POST ONE AT A TIME ─────────────────────────────────────
 *
 * Multi-upload is a row per chosen file, each with its own editable fields, and
 * the rows post SEQUENTIALLY to the same route a single upload uses: one
 * request per track keeps each under the body limit, gives each its own
 * honest per-row outcome, and means a failure on track seven costs track
 * seven alone. The console has no multipart parser on purpose (see
 * admin-image-upload.js); base64 in an ordinary form body, one file at a time,
 * is the same trade.
 */

(function () {
  'use strict';

  // ── Select-all for the bulk checkboxes (independent of the upload form) ──
  //
  // "Assign forty tracks in one press" still cost forty presses to get there
  // without this. One box at the top of the column: tick it, everything ticks;
  // tick again, everything clears; and half-ticking by hand un-syncs it
  // honestly rather than fighting the operator.
  document.querySelectorAll('[data-select-all]').forEach(function (master) {
    var name = master.getAttribute('data-select-all');
    var boxes = function () {
      return Array.prototype.slice.call(
        document.querySelectorAll('input[type=checkbox][name="' + name + '"]'),
      );
    };
    master.addEventListener('change', function () {
      boxes().forEach(function (b) { b.checked = master.checked; });
    });
    document.addEventListener('change', function (ev) {
      if (ev.target === master) return;
      if (!(ev.target instanceof HTMLInputElement) || ev.target.name !== name) return;
      var all = boxes();
      master.checked = all.length > 0 && all.every(function (b) { return b.checked; });
    });
  });

  var root = document.querySelector('[data-music-upload]');
  if (!root) return;

  var fileInput = root.querySelector('input[type=file]');
  var rowsHost = root.querySelector('[data-music-rows]');
  var submit = root.querySelector('[data-music-submit]');
  var statusLine = root.querySelector('[data-music-status]');
  var csrf = root.querySelector('input[name=_csrf]');
  var action = root.getAttribute('data-action') || '/music/tracks/upload';
  var maxBytes = parseInt(root.getAttribute('data-max-bytes') || '0', 10) || 100 * 1024 * 1024;
  if (!fileInput || !rowsHost || !submit || !csrf) return;

  var rows = [];

  function say(text) {
    if (statusLine) statusLine.textContent = text;
  }

  /* ── the small ID3v2 reader ─────────────────────────────────────────────── */

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
    } catch (e) {
      return '';
    }
  }

  /** TIT2/TPE1/TCON + APIC out of an ID3v2.3/2.4 header; nulls when absent. */
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
        // enc byte, NUL-terminated mime, picture type, NUL-terminated description, bytes.
        var p = 1;
        var mimeStart = p;
        while (p < body.length && body[p] !== 0) p++;
        var mime = String.fromCharCode.apply(null, body.subarray(mimeStart, p)) || 'image/jpeg';
        p += 2; // NUL + picture type
        // Description: single-byte NUL for latin1/utf8, double for utf16.
        var wide = body[0] === 1 || body[0] === 2;
        if (wide) {
          while (p + 1 < body.length && (body[p] !== 0 || body[p + 1] !== 0)) p += 2;
          p += 2;
        } else {
          while (p < body.length && body[p] !== 0) p++;
          p += 1;
        }
        if (p < body.length) out.cover = { mime: mime, bytes: body.subarray(p) };
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

  /* ── the rows ───────────────────────────────────────────────────────────── */

  function field(labelText, input) {
    var label = document.createElement('label');
    label.className = 'block';
    var span = document.createElement('span');
    span.className = 'mb-1 block text-sm font-medium text-slate-700';
    span.textContent = labelText;
    label.appendChild(span);
    label.appendChild(input);
    return label;
  }

  function textInput(value, placeholder) {
    var input = document.createElement('input');
    input.type = 'text';
    input.value = value || '';
    input.placeholder = placeholder;
    input.className = 'w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm';
    return input;
  }

  function renderRow(file, tag, audioB64) {
    var row = {
      file: file,
      audioB64: audioB64,
      coverB64: tag.cover ? toBase64(tag.cover.bytes) : '',
      state: 'ready',
    };
    var card = document.createElement('div');
    card.className = 'rounded-lg border border-slate-200 p-3 flex flex-col gap-3';

    var head = document.createElement('div');
    head.className = 'flex items-center gap-2 text-sm text-slate-600';
    var cover = document.createElement('img');
    cover.alt = '';
    cover.className = 'h-12 w-12 rounded object-cover border border-slate-200';
    if (tag.cover) {
      cover.src = 'data:' + tag.cover.mime + ';base64,' + row.coverB64;
    } else {
      cover.style.display = 'none';
    }
    var name = document.createElement('span');
    name.textContent = file.name + ' (' + Math.max(1, Math.round(file.size / 1024)) + ' KB)';
    var state = document.createElement('span');
    state.className = 'ml-auto text-xs text-slate-500';
    state.textContent = tag.cover ? 'cover from the tag' : 'no cover in the tag';
    head.appendChild(cover);
    head.appendChild(name);
    head.appendChild(state);

    var title = textInput(tag.title, 'Title (the file name if left empty)');
    var artist = textInput(tag.artist, 'Artist');
    var album = textInput(tag.album, 'Album');
    var genre = textInput(tag.genre, 'Genre (commas make several)');
    var kind = document.createElement('select');
    kind.className = 'w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm';
    ['music', 'audiobook', 'documentary', 'spot'].forEach(function (k) {
      var o = document.createElement('option');
      o.value = k;
      o.textContent = k;
      kind.appendChild(o);
    });
    var coverPick = document.createElement('input');
    coverPick.type = 'file';
    coverPick.accept = 'image/*';
    coverPick.className = 'text-sm';
    coverPick.addEventListener('change', function () {
      var f = coverPick.files && coverPick.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        var res = String(r.result || '');
        var comma = res.indexOf(',');
        if (comma < 0) return;
        row.coverB64 = res.slice(comma + 1);
        cover.src = res;
        cover.style.display = '';
        state.textContent = 'cover replaced';
      };
      r.readAsDataURL(f);
    });

    card.appendChild(head);
    card.appendChild(field('Title', title));
    card.appendChild(field('Artist', artist));
    card.appendChild(field('Album', album));
    card.appendChild(field('Genre', genre));
    card.appendChild(field('Kind', kind));
    card.appendChild(field('Cover (from the tag when it has one; choose a file to replace it)', coverPick));

    row.el = card;
    row.stateEl = state;
    row.fields = { title: title, artist: artist, album: album, genre: genre, kind: kind };
    return row;
  }

  fileInput.addEventListener('change', function () {
    rows = [];
    rowsHost.textContent = '';
    var files = Array.prototype.slice.call(fileInput.files || []);
    if (files.length === 0) {
      submit.disabled = true;
      say('Choose one or more audio files.');
      return;
    }
    say('Reading tags...');
    var pending = files.length;
    files.forEach(function (file) {
      if (file.size > maxBytes) {
        pending--;
        say(file.name + ' is over the ' + Math.round(maxBytes / (1024 * 1024)) + ' MB limit and was left out.');
        return;
      }
      var reader = new FileReader();
      reader.onerror = function () {
        pending--;
        say(file.name + ' could not be read.');
      };
      reader.onload = function () {
        var buffer = reader.result;
        var tag = readId3(buffer);
        var row = renderRow(file, tag, toBase64(new Uint8Array(buffer)));
        rows.push(row);
        rowsHost.appendChild(row.el);
        pending--;
        if (pending === 0) {
          submit.disabled = rows.length === 0;
          say(rows.length + ' file(s) ready. Correct anything the tags got wrong, then upload.');
        }
      };
      reader.readAsArrayBuffer(file);
    });
  });

  submit.addEventListener('click', function (ev) {
    ev.preventDefault();
    if (rows.length === 0) return;
    submit.disabled = true;
    var done = 0;
    var failed = 0;

    function next(i) {
      if (i >= rows.length) {
        say(done + ' uploaded' + (failed ? ', ' + failed + ' failed (each row says which)' : '') + '. Reloading...');
        window.location.href = '/music?notice=' + encodeURIComponent(
          done + ' track(s) uploaded; encodes run in the background.');
        return;
      }
      var row = rows[i];
      row.stateEl.textContent = 'uploading...';
      var body = new URLSearchParams();
      body.set('_csrf', csrf.value);
      body.set('ajax', '1');
      body.set('imageData', row.audioB64);
      body.set('fileName', row.file.name);
      body.set('title', row.fields.title.value.trim());
      body.set('artist', row.fields.artist.value.trim());
      body.set('album', row.fields.album.value.trim());
      body.set('genre', row.fields.genre.value.trim());
      body.set('kind', row.fields.kind.value);
      body.set('coverData', row.coverB64);
      fetch(action, { method: 'POST', body: body, credentials: 'same-origin' })
        .then(function (res) { return res.json().catch(function () { return { ok: false, error: 'HTTP ' + res.status }; }); })
        .then(function (json) {
          if (json && json.ok) {
            done++;
            row.stateEl.textContent = 'uploaded as "' + json.title + '"' + (json.hadCover ? ', encode queued' : '');
          } else {
            failed++;
            row.stateEl.textContent = 'failed: ' + ((json && json.error) || 'unknown');
          }
          say('Uploading ' + (i + 2) + ' of ' + rows.length + '...');
          next(i + 1);
        })
        .catch(function (err) {
          failed++;
          row.stateEl.textContent = 'failed: ' + err;
          next(i + 1);
        });
    }
    say('Uploading 1 of ' + rows.length + '...');
    next(0);
  });

  submit.disabled = true;
  say('Choose one or more audio files.');
})();
