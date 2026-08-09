/**
 * Operator image upload for the console (CCB-S4-047, generalised under CCB-S5-007).
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
 *
 * ── WHY IT IS NOT CALLED admin-recital.js ANY MORE ───────────────────────────
 *
 * It was, and it was written for the one page that had an upload. The bot avatar (CCB-S5-007)
 * is the same problem again: read a file the operator chose, hand the bytes to a server route
 * that re-encodes them. A second copy of this under a second name would be two files to fix
 * the day a browser changes how `FileReader` reports an error. So the hook is
 * `data-image-upload` rather than `data-recital-upload`, and the page decides where the form
 * posts.
 */

(function () {
  'use strict';

  var MAX_BYTES = 8 * 1024 * 1024;

  function wire(form) {
    var input = form.querySelector('input[type="file"]');
    var payload = form.querySelector('input[name="imageData"]');
    var status = form.querySelector('[data-image-upload-status]');
    var submit = form.querySelector('button[type="submit"]');
    if (!input || !payload || !submit) return;

    // The resting line the page rendered, kept so clearing the chooser restores it instead
    // of blanking it (CCB-S5-008). An empty status line beside a disabled button is how the
    // panel came to explain nothing at all about why nothing happened.
    var idle = status ? status.textContent : '';

    submit.disabled = true;

    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      payload.value = '';
      submit.disabled = true;
      if (!file) {
        if (status) status.textContent = idle;
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

  document.querySelectorAll('form[data-image-upload]').forEach(wire);
})();
