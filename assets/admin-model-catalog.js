(() => {
  'use strict';

  const search = document.querySelector('[data-model-search]');
  const roleFilter = document.querySelector('[data-model-role-filter]');
  const items = Array.from(document.querySelectorAll('[data-model-item]'));
  const details = Array.from(document.querySelectorAll('[data-model-detail]'));
  const empty = document.querySelector('[data-model-empty]');
  const count = document.querySelector('[data-model-visible-count]');

  function selectModel(targetId) {
    items.forEach((item) => {
      item.setAttribute(
        'aria-current',
        item.getAttribute('data-model-target') === targetId ? 'true' : 'false',
      );
    });

    details.forEach((detail) => {
      detail.hidden = detail.id !== targetId;
    });
  }

  function visibleItems() {
    return items.filter((item) => !item.hidden);
  }

  function applyFilters() {
    const query = search instanceof HTMLInputElement ? search.value.trim().toLowerCase() : '';
    const selectedRole =
      roleFilter instanceof HTMLSelectElement ? roleFilter.value.toLowerCase() : 'all';

    items.forEach((item) => {
      const searchValue = item.getAttribute('data-search-value')?.toLowerCase() ?? '';
      const roleValue = item.getAttribute('data-role-value')?.toLowerCase() ?? 'unassigned';
      const searchMatch = query === '' || searchValue.includes(query);
      const roleMatch =
        selectedRole === 'all' ||
        (selectedRole === 'routed' && roleValue !== 'unassigned') ||
        roleValue.split(' ').includes(selectedRole);

      item.hidden = !(searchMatch && roleMatch);
    });

    const visible = visibleItems();

    if (count) count.textContent = String(visible.length);
    if (empty instanceof HTMLElement) empty.hidden = visible.length !== 0;

    const selected = items.find((item) => item.getAttribute('aria-current') === 'true');

    if (selected?.hidden) {
      const nextTarget = visible[0]?.getAttribute('data-model-target');
      if (nextTarget) selectModel(nextTarget);
    }

    if (visible.length === 0) {
      details.forEach((detail) => {
        detail.hidden = true;
      });
    }
  }

  items.forEach((item) => {
    item.addEventListener('click', () => {
      const targetId = item.getAttribute('data-model-target');
      if (targetId) selectModel(targetId);
    });
  });

  search?.addEventListener('input', applyFilters);
  roleFilter?.addEventListener('change', applyFilters);
})();
