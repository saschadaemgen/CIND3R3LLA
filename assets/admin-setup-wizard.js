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

    dialog.querySelector('[data-setup-next]')?.addEventListener('click', () => {
      const current = Number.parseInt(dialog.dataset.setupCurrentStep ?? '0', 10);
      showStep(dialog, current + 1);
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
