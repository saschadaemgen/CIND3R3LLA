(() => {
  const header = document.querySelector('[data-admin-header]');
  const navigation = document.querySelector('[data-main-navigation]');
  const indicator = navigation?.querySelector('[data-main-nav-indicator]');
  const shell = header?.querySelector('[data-mega-shell]');

  if (!(header instanceof HTMLElement) || !(navigation instanceof HTMLElement)) return;
  if (!(indicator instanceof HTMLElement) || !(shell instanceof HTMLElement)) return;

  const triggers = Array.from(navigation.querySelectorAll('[data-mega-trigger]')).filter(
    (element) => element instanceof HTMLAnchorElement,
  );
  const panels = Array.from(shell.querySelectorAll('[data-mega-panel]')).filter(
    (element) => element instanceof HTMLElement,
  );
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let openSection = null;
  let resizeFrame = 0;

  function activeTrigger() {
    const active = navigation.querySelector('[data-main-active="true"]');
    return active instanceof HTMLElement ? active : null;
  }

  function positionIndicator(target, immediate = false) {
    if (!(target instanceof HTMLElement)) return;

    const navRect = navigation.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const x = targetRect.left - navRect.left;

    if (immediate || reducedMotion.matches) {
      indicator.style.transition = 'none';
    }

    indicator.style.width = `${targetRect.width}px`;
    indicator.style.transform = `translate3d(${x}px, 0, 0)`;
    indicator.dataset.ready = 'true';

    if (immediate || reducedMotion.matches) {
      requestAnimationFrame(() => {
        indicator.style.removeProperty('transition');
      });
    }
  }

  function panelFor(section) {
    return panels.find((panel) => panel.dataset.megaPanel === section) ?? null;
  }

  function closePanel({ restoreFocus = false } = {}) {
    const previous = openSection;

    for (const trigger of triggers) {
      trigger.setAttribute('aria-expanded', 'false');
    }

    for (const panel of panels) {
      panel.hidden = true;
      panel.setAttribute('aria-hidden', 'true');
    }

    shell.dataset.open = 'false';
    header.dataset.megaOpen = 'false';
    openSection = null;

    if (restoreFocus && previous) {
      const trigger = triggers.find((candidate) => candidate.dataset.megaTrigger === previous);
      trigger?.focus();
    }
  }

  function openPanel(trigger) {
    const section = trigger.dataset.megaTrigger;
    if (!section) return;

    const panel = panelFor(section);
    if (!panel) return;

    for (const candidate of triggers) {
      candidate.setAttribute('aria-expanded', candidate === trigger ? 'true' : 'false');
    }

    for (const candidate of panels) {
      const isCurrent = candidate === panel;
      candidate.hidden = !isCurrent;
      candidate.setAttribute('aria-hidden', isCurrent ? 'false' : 'true');
    }

    shell.dataset.open = 'true';
    header.dataset.megaOpen = 'true';
    openSection = section;
    positionIndicator(trigger);
  }

  for (const trigger of triggers) {
    trigger.addEventListener('click', (event) => {
      event.preventDefault();

      if (openSection === trigger.dataset.megaTrigger) {
        closePanel();
        positionIndicator(activeTrigger() ?? trigger);
        return;
      }

      openPanel(trigger);
    });

    trigger.addEventListener('mouseenter', () => {
      if (openSection && openSection !== trigger.dataset.megaTrigger) {
        openPanel(trigger);
      }
    });

    trigger.addEventListener('focus', () => {
      positionIndicator(trigger);
    });

    trigger.addEventListener('blur', () => {
      if (!openSection) positionIndicator(activeTrigger() ?? trigger);
    });
  }

  for (const panel of panels) {
    panel.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => closePanel());
    });

    panel.querySelectorAll('[data-mega-close]').forEach((button) => {
      button.addEventListener('click', () => closePanel({ restoreFocus: true }));
    });
  }

  document.addEventListener('click', (event) => {
    if (!openSection) return;
    if (!(event.target instanceof Node)) return;
    if (!header.contains(event.target)) closePanel();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && openSection) {
      event.preventDefault();
      closePanel({ restoreFocus: true });
    }
  });

  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      const current =
        triggers.find((trigger) => trigger.dataset.megaTrigger === openSection) ?? activeTrigger();
      if (current) positionIndicator(current, true);
    });
  });

  window.addEventListener('pageshow', () => {
    requestAnimationFrame(() => {
      const active = activeTrigger();
      if (active) positionIndicator(active, true);
    });
  });

  requestAnimationFrame(() => {
    const active = activeTrigger();
    if (active) positionIndicator(active, true);
  });
})();
