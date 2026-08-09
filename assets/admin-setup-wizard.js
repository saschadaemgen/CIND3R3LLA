(() => {
  'use strict';

  const dialogs = new Map();

  document.querySelectorAll('[data-setup-dialog]').forEach((dialog) => {
    if (dialog instanceof HTMLDialogElement && dialog.id) dialogs.set(dialog.id, dialog);
  });

  function stepData(dialog) {
    const steps = Array.from(dialog.querySelectorAll('[data-setup-step]'));
    const back = dialog.querySelector('[data-setup-back]');
    const next = dialog.querySelector('[data-setup-next]');
    const finish = dialog.querySelector('[data-setup-finish]');
    const label = dialog.querySelector('[data-setup-step-label]');
    const title = dialog.querySelector('[data-setup-step-title]');
    const progress = dialog.querySelector('[data-setup-progress]');

    return { steps, back, next, finish, label, title, progress };
  }

  function updateReview(dialog) {
    const form = dialog.querySelector('[data-setup-form]');
    if (!(form instanceof HTMLFormElement)) return;

    dialog.querySelectorAll('[data-review-value]').forEach((target) => {
      const name = target.getAttribute('data-review-value');
      if (!name) return;

      const field = form.elements.namedItem(name);
      if (field instanceof HTMLSelectElement) {
        target.textContent = field.selectedOptions[0]?.textContent?.split(' | ')[0] ?? field.value;
      } else if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
        target.textContent = field.value || 'Not set';
      }
    });
  }

  function showStep(dialog, requested) {
    const data = stepData(dialog);
    const index = Math.max(0, Math.min(requested, data.steps.length - 1));

    data.steps.forEach((step, stepIndex) => {
      step.hidden = stepIndex !== index;
    });

    dialog.dataset.setupCurrentStep = String(index);

    if (data.back instanceof HTMLButtonElement) data.back.hidden = index === 0;
    if (data.next instanceof HTMLButtonElement) data.next.hidden = index === data.steps.length - 1;
    if (data.finish instanceof HTMLButtonElement) {
      data.finish.hidden = index !== data.steps.length - 1;
    }

    if (data.label) data.label.textContent = `Step ${index + 1} of ${data.steps.length}`;

    const heading = data.steps[index]?.querySelector('h3')?.textContent ?? '';
    if (data.title) data.title.textContent = heading;

    if (data.progress instanceof HTMLElement) {
      data.progress.style.width = `${((index + 1) / data.steps.length) * 100}%`;
    }

    if (index === data.steps.length - 1) updateReview(dialog);

    const firstField = data.steps[index]?.querySelector(
      'input:not([type="hidden"]), select, textarea',
    );
    if (firstField instanceof HTMLElement) {
      window.setTimeout(() => firstField.focus(), 60);
    }
  }

  function openDialog(dialog) {
    showStep(dialog, 0);
    dialog.showModal();
  }

  /**
   * The step a control lives on, or -1 when it is not inside one.
   */
  function stepIndexOf(dialog, control) {
    const steps = Array.from(dialog.querySelectorAll('[data-setup-step]'));
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].contains(control)) return i;
    }
    return -1;
  }

  /**
   * Refuse OUT LOUD, never in silence (CCB-S5-010, D-162).
   *
   * ── THE DEFECT THIS EXISTS FOR ───────────────────────────────────────────
   *
   * Every required field lives on step one, and `showStep` sets `hidden` on the others. So an
   * operator who left step one without filling the internal key and then pressed Finish hit a
   * wall the browser could not describe: native validation blocks the submit, tries to focus
   * the offending control, finds it inside a `hidden` subtree, gives up, and logs "An invalid
   * form control with name='slug' is not focusable" to a console no operator has open. The
   * button did nothing, said nothing, and the bot was never created.
   *
   * That is D-162's shape from the other side: not a control that looks live and is dead, but
   * a control that IS live, is required, and cannot be reached to be complained about.
   *
   * So before the native submit gets its turn: find the first invalid control, put its step on
   * screen, and only then let the browser report. `reportValidity` can focus it now, so the
   * operator gets the browser's own message on the field itself.
   *
   * Returns true when the form may proceed.
   */
  function revealAndReport(dialog, form, scope) {
    var invalid = (scope || form).querySelector(
      'input:invalid, select:invalid, textarea:invalid',
    );
    if (!invalid) return true;

    var step = stepIndexOf(dialog, invalid);
    if (step >= 0 && String(step) !== dialog.dataset.setupCurrentStep) showStep(dialog, step);

    // After the step is visible, so the control can actually take focus. Without the reveal
    // this is the exact call that fails silently.
    if (typeof form.reportValidity === 'function') form.reportValidity();
    if (typeof invalid.focus === 'function') invalid.focus();
    return false;
  }

  document.querySelectorAll('[data-setup-open]').forEach((trigger) => {
    trigger.addEventListener('click', () => {
      const id = trigger.getAttribute('data-setup-open');
      const dialog = id ? dialogs.get(id) : null;
      if (dialog) openDialog(dialog);
    });
  });

  dialogs.forEach((dialog) => {
    dialog.querySelectorAll('[data-setup-close]').forEach((button) => {
      button.addEventListener('click', () => dialog.close());
    });

    const form = dialog.querySelector('[data-setup-form]');

    dialog.querySelector('[data-setup-next]')?.addEventListener('click', () => {
      const current = Number.parseInt(dialog.dataset.setupCurrentStep ?? '0', 10);
      // Checked on the way OUT of a step, so a problem is reported where it lives and on the
      // screen it belongs to. Leaving it until Finish is what made it unreachable.
      const steps = Array.from(dialog.querySelectorAll('[data-setup-step]'));
      if (form && !revealAndReport(dialog, form, steps[current])) return;
      showStep(dialog, current + 1);
    });

    // The last line of defence, for every route to Finish that did not pass a Next: the
    // operator jumping steps, a browser restoring values, a required field added later on a
    // step nobody walks through.
    dialog.querySelector('[data-setup-finish]')?.addEventListener('click', (event) => {
      if (form && !revealAndReport(dialog, form)) event.preventDefault();
    });

    dialog.querySelector('[data-setup-back]')?.addEventListener('click', () => {
      const current = Number.parseInt(dialog.dataset.setupCurrentStep ?? '0', 10);
      showStep(dialog, current - 1);
    });

    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });

    dialog.querySelector('[data-setup-form]')?.addEventListener('input', () => {
      updateReview(dialog);
    });
  });

  /**
   * Identity fields follow the bot name until the operator takes them over (CCB-S5-009,
   * extended to the slug in CCB-S5-010).
   *
   * The wake word used to be derived on the server, invisibly, and an operator finished the
   * wizard without knowing what the bot answered to. The internal key was never derived at
   * all: it has been a required field somebody had to type since the day it was added, and
   * leaving step one without it is what produced a Finish button that did nothing.
   *
   * Both are pre-filled here, from one listener, because two listeners on one input is how
   * they drift. `dirty` is set by the operator EDITING a field, never by this code writing to
   * it, so overtyping the key and then correcting the bot name does not silently undo the
   * correction. The server normalizes and validates whatever arrives regardless; this is
   * convenience, and it is also what stops the empty case from ever being reached.
   */
  var DERIVE = {
    wake: function (name) {
      return name.trim().replace(/\s+/g, ' ').slice(0, 40);
    },
    // Lower case, non-alphanumerics collapsed to single hyphens, trimmed of leading and
    // trailing hyphens so the result always starts with the letter or digit the pattern
    // requires. Capped at the column's 63. A name with nothing usable in it yields '', which
    // leaves the field empty and REQUIRED, so the operator is asked rather than given a key
    // that would be refused by the server a moment later.
    slug: function (name) {
      return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 63)
        .replace(/-+$/, '');
    },
  };

  document.querySelectorAll('[data-setup-form]').forEach((form) => {
    const name = form.querySelector('[data-wake-source]');
    if (!name) return;

    const targets = [];
    const wake = form.querySelector('[data-wake-word]');
    if (wake) targets.push({ el: wake, from: DERIVE.wake });
    const slug = form.querySelector('[data-derive="slug"]');
    if (slug) targets.push({ el: slug, from: DERIVE.slug });

    targets.forEach((t) => {
      t.dirty = t.el.value.trim() !== '';
      t.el.addEventListener('input', () => {
        t.dirty = true;
      });
    });

    name.addEventListener('input', () => {
      targets.forEach((t) => {
        if (t.dirty) return;
        t.el.value = t.from(name.value);
      });
    });
  });

  const search = document.querySelector('[data-setup-search]');
  const items = Array.from(document.querySelectorAll('[data-setup-list-item]'));
  const empty = document.querySelector('[data-setup-list-empty]');

  if (search instanceof HTMLInputElement && items.length > 0) {
    search.addEventListener('input', () => {
      const query = search.value.trim().toLowerCase();
      let visible = 0;

      items.forEach((item) => {
        const haystack = item.getAttribute('data-search-value')?.toLowerCase() ?? '';
        const match = query === '' || haystack.includes(query);
        item.hidden = !match;
        if (match) visible += 1;
      });

      if (empty instanceof HTMLElement) empty.hidden = visible !== 0;
    });
  }
})();
