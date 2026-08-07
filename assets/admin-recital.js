/**
 * Chapter image upload for the Book of Elii's recital page (CCB-S4-047).
 *
 * ── WHY THE BYTES ARE BASE64 IN AN ORDINARY FORM FIELD ───────────────────────
 *
 * The console has no multipart parser and this is not the place to add one. A multipart
 * decoder is a new dependency parsing attacker-shaped input on the most hostile surface in
 * the product, bought to move a handful of operator images that the server re-encodes anyway.
 *
 * So the file is read here, base64'd, and posted as a normal field that `@fastify/formbody`
 * already handles. Nothing about the server's treatment changes: the bytes are decoded and
 * re-encoded by sharp, which is what actually makes them safe, and a file sharp cannot read
 * is refused.
 *
 * The size check here is a courtesy, not a control. The server enforces the real one.
 */

(function () {
  'use strict';

  var MAX_BYTES = 8 * 1024 * 1024;

  function wire(form) {
    var input = form.querySelector('input[type="file"]');
    var payload = form.querySelector('input[name="imageData"]');
    var status = form.querySelector('[data-recital-status]');
    var submit = form.querySelector('button[type="submit"]');
    if (!input || !payload || !submit) return;

    submit.disabled = true;

    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      payload.value = '';
      submit.disabled = true;
      if (!file) {
        if (status) status.textContent = '';
        return;
      }
      if (file.size > MAX_BYTES) {
        if (status) {
          status.textContent =
            'That file is ' + Math.round(file.size / 1024) + ' kB, over the 8 MB limit.';
        }
        return;
      }
      if (status) status.textContent = 'Reading ' + file.name + '...';

      var reader = new FileReader();
      reader.onerror = function () {
        if (status) status.textContent = 'That file could not be read.';
      };
      reader.onload = function () {
        var result = String(reader.result || '');
        var comma = result.indexOf(',');
        if (comma < 0) {
          if (status) status.textContent = 'That file could not be read.';
          return;
        }
        payload.value = result.slice(comma + 1);
        submit.disabled = false;
        if (status) {
          status.textContent = file.name + ' is ready. It is re-encoded on the server.';
        }
      };
      reader.readAsDataURL(file);
    });
  }

  document.querySelectorAll('form[data-recital-upload]').forEach(wire);
})();
