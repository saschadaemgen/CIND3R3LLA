(() => {
  'use strict';

  const dialogs = new Map();

  document.querySelectorAll('[data-access-dialog]').forEach((dialog) => {
    if (dialog instanceof HTMLDialogElement && dialog.id) dialogs.set(dialog.id, dialog);
  });

  document.querySelectorAll('[data-access-open]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.getAttribute('data-access-open');
      const dialog = id ? dialogs.get(id) : null;
      if (dialog) dialog.showModal();
    });
  });

  document.querySelectorAll('[data-access-close]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.getAttribute('data-access-close');
      const dialog = id ? dialogs.get(id) : null;
      if (dialog) dialog.close();
    });
  });

  dialogs.forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  });

  const workspace = document.querySelector('[data-access-workspace]');

  if (workspace instanceof HTMLElement) {
    const tabs = Array.from(workspace.querySelectorAll('[data-access-tab]'));
    const panels = Array.from(workspace.querySelectorAll('[data-access-panel]'));

    function selectTab(name) {
      tabs.forEach((tab) => {
        const active = tab.getAttribute('data-access-tab') === name;
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });

      panels.forEach((panel) => {
        panel.hidden = panel.getAttribute('data-access-panel') !== name;
      });
    }

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const name = tab.getAttribute('data-access-tab');
        if (name) selectTab(name);
      });
    });
  }

  const search = document.querySelector('[data-access-search]');
  const items = Array.from(document.querySelectorAll('[data-access-list-item]'));
  const empty = document.querySelector('[data-access-list-empty]');

  if (search instanceof HTMLInputElement) {
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
