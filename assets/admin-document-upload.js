/**
 * Reading a text document the operator chose, into the field the server actually reads
 * (CCB-S5-024).
 *
 * ── WHY THIS IS NOT admin-image-upload.js ────────────────────────────────────
 *
 * That script base64s a file into a HIDDEN field, because an image is binary and the server
 * re-encodes it through sharp. A document is TEXT, and hiding text in a base64 field bought
 * nothing and cost everything: when the script did not load, the hidden field stayed empty,
 * the form submitted happily, and the route reported "No file was read. Choose one and try
 * again." at an operator who had plainly chosen one. Nothing in the browser console said a
 * word, because there was no script there to say it.
 *
 * ── THE FIELD THE SERVER READS IS VISIBLE, AND IT WORKS WITHOUT THIS FILE ────
 *
 * The form posts a `<textarea>`. An operator with no JavaScript pastes into it and submits,
 * and the upload works. This script's ONLY job is to save the paste: it reads the chosen file
 * and puts the text in that same textarea, where the operator can SEE it.
 *
 * That is the whole design change. The upload no longer depends on a script executing, so
 * this file failing to load costs a convenience rather than the feature. It is the same
 * lesson as the disabled Upload button (D-162) and the required field on a hidden step: a
 * control whose correctness depends on script that may not run is a control that will
 * eventually not work, silently.
 *
 * The submit button is deliberately NEVER disabled here. Disabling it was how the avatar
 * panel came to look live and do nothing; there is nothing to guard against now, because an
 * empty textarea is refused by the server with a sentence that says so.
 */

(function () {
  'use strict';

  var MAX_BYTES = 2 * 1024 * 1024;

  function wire(form) {
    var input = form.querySelector('input[type="file"][data-document-file]');
    var target = form.querySelector('textarea[data-document-text]');
    var nameField = form.querySelector('input[data-document-name]');
    var status = form.querySelector('[data-document-status]');
    if (!input || !target) return;

    // The resting line the page rendered server-side, kept so clearing the chooser restores
    // it rather than blanking it.
    var idle = status ? status.textContent : '';

    function say(text) {
      if (status) status.textContent = text;
    }

    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (nameField) nameField.value = '';
      if (!file) {
        say(idle);
        return;
      }
      if (file.size > MAX_BYTES) {
        say(
          'That file is ' +
            Math.round(file.size / 1024) +
            ' kB, over the 2 MB limit. Nothing was read.',
        );
        return;
      }
      say('Reading ' + file.name + '...');

      var reader = new FileReader();
      reader.onerror = function () {
        // TRUTHFUL. The old message told the operator to choose a file again, which is the
        // one thing that would not have helped.
        say('Your browser could not read ' + file.name + '. Nothing was put in the box below.');
      };
      reader.onload = function () {
        var text = String(reader.result == null ? '' : reader.result);
        if (text.indexOf('\u0000') >= 0) {
          say(file.name + ' contains binary data rather than text, so nothing was read.');
          return;
        }
        target.value = text;
        if (nameField) nameField.value = file.name;
        // The strongest feedback there is: the operator can see the text in the box. The
        // count is here for the case where the document is long enough that the top of it
        // looks the same as an empty box.
        say(
          file.name + ' read: ' + text.length + ' characters are in the box below, ready to send.',
        );
      };
      reader.readAsText(file, 'utf-8');
    });
  }

  document.querySelectorAll('form[data-document-upload]').forEach(wire);
})();
