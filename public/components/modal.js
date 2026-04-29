/**
 * Modul: Shared Modal-System
 * Zweck: Einheitliches Modal mit Focus-Trap, Escape-Handler, Overlay-Click,
 *        Focus-Restore, Scroll-Lock und aria-modal.
 *        Auf Mobile: Bottom Sheet mit Swipe-to-Close und Slide-out-Animation.
 * Abhängigkeiten: CSS-Klassen aus layout.css (.modal-overlay, .modal-panel, etc.)
 *                 i18n.js (t)
 *
 * API:
 *   openModal({ title, content, onSave, onDelete, size }) → void
 *   closeModal() → void
 */

import { t } from '/i18n.js';

let activeOverlay = null;
let previouslyFocused = null;
let focusTrapHandler = null;
let activeOnClose = null;

// Overlay-Dimming: theme-color abdunkeln im Standalone-Modus
const OVERLAY_THEME_COLOR = '#1A1A1A';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

// --------------------------------------------------------
// Focus-Trap (Spec §5.2)
// --------------------------------------------------------

function trapFocus(container) {
  focusTrapHandler = (e) => {
    // Tab-Trap: Fokus innerhalb des Modals halten
    if (e.key === 'Tab') {
      const focusable = container.querySelectorAll(FOCUSABLE);
      if (!focusable.length) return;
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }

    // Enter in einzeiligen Inputs/Selects → zum nächsten Feld springen
    if (e.key === 'Enter') {
      const active = document.activeElement;
      const isInput = active.tagName === 'INPUT' && active.type !== 'submit' && active.type !== 'button';
      const isSelect = active.tagName === 'SELECT';

      if (isInput || isSelect) {
        const focusable = Array.from(container.querySelectorAll(FOCUSABLE));
        const idx = focusable.indexOf(active);
        const next = focusable[idx + 1];

        if (next && next.tagName !== 'BUTTON') {
          e.preventDefault();
          next.focus();
        }
        // Beim letzten Feld oder wenn Next ein Button ist: Submit auslösen
        if (!next || next.tagName === 'BUTTON') {
          const submitBtn = container.querySelector('button[type="submit"], .btn--primary');
          if (submitBtn && !submitBtn.disabled) {
            e.preventDefault();
            submitBtn.click();
          }
        }
      }
    }
  };
  container.addEventListener('keydown', focusTrapHandler);

  // Virtual Keyboard: Focused Input in sichtbaren Bereich scrollen
  function onInputFocus(e) {
    const tag = e.target.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return;
    setTimeout(() => {
      e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
  }
  container.addEventListener('focusin', onInputFocus);
  container._onInputFocus = onInputFocus;

  // Focus first focusable element
  const first = container.querySelector(FOCUSABLE);
  if (first) {
    setTimeout(() => first.focus(), 50);
  }
}

// --------------------------------------------------------
// Escape-Handler
// --------------------------------------------------------

function onEscape(e) {
  if (e.key === 'Escape') closeModal();
}

// --------------------------------------------------------
// Swipe-to-Close (Mobile)
// --------------------------------------------------------

function _wireSheetSwipe(panel) {
  let startY = 0;
  let dragging = false;

  panel.addEventListener('touchstart', (e) => {
    // Only initiate swipe from the handle/header area, not from inside the body
    if (e.target.closest('.modal-panel__body')) return;
    startY = e.touches[0].clientY;
    dragging = true;
  }, { passive: true });

  panel.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const dy = e.touches[0].clientY - startY;
    if (dy < 0) return;
    panel.style.transform = `translateY(${dy * 0.6}px)`;
  }, { passive: true });

  panel.addEventListener('touchend', (e) => {
    if (!dragging) return;
    dragging = false;
    const dy = e.changedTouches[0].clientY - startY;
    panel.style.transform = '';
    if (dy > 80) closeModal();
  });
}

// --------------------------------------------------------
// _doClose - gemeinsame Cleanup-Logik
// --------------------------------------------------------

function _doClose() {
  if (!activeOverlay) return;
  const onClose = activeOnClose;
  activeOnClose = null;
  activeOverlay.remove();
  activeOverlay = null;

  // Scroll-Lock aufheben
  document.body.style.overflow = '';

  // Focus-Restore
  if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
    previouslyFocused.focus();
    previouslyFocused = null;
  }

  // Standalone: Statusbar-Farbe zur aktuellen Route wiederherstellen
  if (window.planium?.restoreThemeColor) {
    window.planium.restoreThemeColor();
  }

  if (typeof onClose === 'function') {
    try {
      onClose();
    } catch (err) {
      console.error('Modal close callback failed:', err);
    }
  }
}

// --------------------------------------------------------
// openModal
// --------------------------------------------------------

/**
 * Öffnet ein Modal mit dem Shared-System.
 *
 * @param {Object}   opts
 * @param {string}   opts.title    - Titel im Modal-Header
 * @param {string}   opts.content  - HTML-String für den Modal-Body
 * @param {Function} [opts.onSave]   - Callback, wird nach Einfügen in DOM aufgerufen
 *                                      (zum Binden von Form-Events)
 * @param {Function} [opts.onDelete] - Falls vorhanden, wird ein Löschen-Button eingebaut
 * @param {string}   [opts.size='md'] - 'sm' | 'md' | 'lg'
 * @param {Function} [opts.onClose]   - Optionaler Callback beim Schließen
 */
export function openModal({ title, content, onSave, onDelete, onClose, size = 'md' } = {}) {
  // Vorheriges Modal schließen (kein Stacking)
  if (activeOverlay) closeModal();

  // Focus-Restore vorbereiten
  previouslyFocused = document.activeElement;

  // Scroll-Lock
  document.body.style.overflow = 'hidden';

  const sizeClass = size !== 'md' ? ` modal-panel--${size}` : '';

  const html = `
    <div class="modal-overlay" id="shared-modal-overlay">
      <div class="modal-panel${sizeClass}" role="dialog" aria-modal="true"
           aria-labelledby="shared-modal-title">
        <div class="modal-panel__header">
          <h2 class="modal-panel__title" id="shared-modal-title">${title}</h2>
          <button class="modal-panel__close" data-action="close-modal" aria-label="${t('modal.closeLabel')}">
            <i data-lucide="x" style="width:18px;height:18px" aria-hidden="true"></i>
          </button>
        </div>
        <div class="modal-panel__body">
          ${content}
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  activeOverlay = document.getElementById('shared-modal-overlay');
  activeOnClose = typeof onClose === 'function' ? onClose : null;

  // Lucide-Icons rendern
  if (window.lucide) window.lucide.createIcons();

  // Focus-Trap
  const panel = activeOverlay.querySelector('.modal-panel');
  trapFocus(panel);

  // Swipe-to-Close auf Mobile
  if (window.innerWidth < 768) {
    _wireSheetSwipe(panel);
  }

  // Overlay-Click schließt Modal
  activeOverlay.addEventListener('click', (e) => {
    if (e.target === activeOverlay) closeModal();
  });

  // Close-Button
  activeOverlay.querySelector('[data-action="close-modal"]')
    ?.addEventListener('click', closeModal);

  // Escape
  document.addEventListener('keydown', onEscape);

  // Callback für Aufrufer (Form-Events binden etc.)
  if (typeof onSave === 'function') onSave(panel);

  // Standalone: Statusbar abdunkeln (Overlay-Effekt)
  if (window.planium?.setThemeColor) {
    window.planium.setThemeColor(OVERLAY_THEME_COLOR, OVERLAY_THEME_COLOR);
  }
}

// --------------------------------------------------------
// closeModal
// --------------------------------------------------------

export function closeModal() {
  if (!activeOverlay) return;

  document.removeEventListener('keydown', onEscape);

  const panel = activeOverlay.querySelector('.modal-panel');

  // Focus-Trap-Handler und Virtual-Keyboard-Listener entfernen
  if (focusTrapHandler) {
    if (panel) panel.removeEventListener('keydown', focusTrapHandler);
    focusTrapHandler = null;
  }
  if (panel?._onInputFocus) {
    panel.removeEventListener('focusin', panel._onInputFocus);
  }

  // Sheet-Out-Animation auf Mobile, danach _doClose
  const isMobile = window.innerWidth < 768;
  if (isMobile && panel) {
    panel.classList.add('modal-panel--closing');
    panel.addEventListener('animationend', () => {
      _doClose();
    }, { once: true });
    return;
  }

  _doClose();
}

// --------------------------------------------------------
// showConfirm / showPrompt — iframe-safe replacements for
// native confirm() and prompt()
// --------------------------------------------------------

/**
 * Async replacement for window.confirm().
 * Resolves true (OK) or false (Cancel/Escape/Overlay-Click).
 *
 * @param {string} message - The confirmation message
 * @param {Object} [opts]
 * @param {string} [opts.title]       - Dialog title (default: common.confirm or "Confirm")
 * @param {string} [opts.okLabel]     - OK button label (default: "OK")
 * @param {string} [opts.cancelLabel] - Cancel button label (default: common.cancel)
 * @param {boolean} [opts.danger]     - Use danger button style for OK
 * @returns {Promise<boolean>}
 */
export function showConfirm(message, opts = {}) {
  return new Promise((resolve) => {
    const title       = opts.title       ?? t('common.confirm') ?? 'Confirm';
    const okLabel     = opts.okLabel     ?? 'OK';
    const cancelLabel = opts.cancelLabel ?? t('common.cancel')  ?? 'Cancel';
    const btnClass    = opts.danger ? 'btn btn--danger' : 'btn btn--primary';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'dialog-confirm-overlay';
    overlay.innerHTML = `
      <div class="modal-panel modal-panel--sm" role="alertdialog" aria-modal="true"
           aria-labelledby="dialog-confirm-title" aria-describedby="dialog-confirm-msg">
        <div class="modal-panel__header">
          <h2 class="modal-panel__title" id="dialog-confirm-title">${title}</h2>
        </div>
        <div class="modal-panel__body">
          <p id="dialog-confirm-msg" style="margin:0;font-size:var(--text-sm);color:var(--color-text-secondary)">${message}</p>
        </div>
        <div class="modal-panel__footer">
          <button class="btn btn--ghost" data-role="cancel">${cancelLabel}</button>
          <button class="${btnClass}" data-role="ok">${okLabel}</button>
        </div>
      </div>`;

    let resolved = false;
    const close = (value) => {
      if (resolved) return;
      resolved = true;
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
    };

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });
    overlay.querySelector('[data-role="cancel"]').addEventListener('click', () => close(false));
    overlay.querySelector('[data-role="ok"]').addEventListener('click', () => close(true));
    document.addEventListener('keydown', onKey);

    document.body.appendChild(overlay);
    overlay.querySelector('[data-role="ok"]').focus();
  });
}

/**
 * Async replacement for window.prompt().
 * Resolves to the entered string, or null on Cancel/Escape.
 *
 * @param {string} message  - The prompt message / label
 * @param {string} [defaultValue=''] - Pre-filled input value
 * @param {Object} [opts]
 * @param {string} [opts.title]       - Dialog title (defaults to message)
 * @param {string} [opts.description] - Optional description shown above the input
 * @param {string} [opts.okLabel]     - OK button label
 * @param {string} [opts.cancelLabel] - Cancel button label
 * @returns {Promise<string|null>}
 */
export function showPrompt(message, defaultValue = '', opts = {}) {
  return new Promise((resolve) => {
    const title       = opts.title       ?? message;
    const desc        = opts.description ?? '';
    const okLabel     = opts.okLabel     ?? 'OK';
    const cancelLabel = opts.cancelLabel ?? t('common.cancel') ?? 'Cancel';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'dialog-prompt-overlay';
    overlay.innerHTML = `
      <div class="modal-panel modal-panel--sm" role="dialog" aria-modal="true"
           aria-labelledby="dialog-prompt-title">
        <div class="modal-panel__header">
          <h2 class="modal-panel__title" id="dialog-prompt-title">${title}</h2>
        </div>
        <div class="modal-panel__body">
          ${desc ? `<p style="margin:0;font-size:var(--text-sm);color:var(--color-text-secondary)">${desc}</p>` : ''}
          <input class="input" type="text" id="dialog-prompt-input"
                 value="${defaultValue.replace(/"/g, '&quot;')}"
                 style="width:100%">
        </div>
        <div class="modal-panel__footer">
          <button class="btn btn--ghost" data-role="cancel">${cancelLabel}</button>
          <button class="btn btn--primary" data-role="ok">${okLabel}</button>
        </div>
      </div>`;

    let resolved = false;
    const input = overlay.querySelector('#dialog-prompt-input');

    const close = (value) => {
      if (resolved) return;
      resolved = true;
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
    };

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
    overlay.querySelector('[data-role="cancel"]').addEventListener('click', () => close(null));
    overlay.querySelector('[data-role="ok"]').addEventListener('click', () => close(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') close(input.value);
    });
    document.addEventListener('keydown', onKey);

    document.body.appendChild(overlay);
    input.focus();
    input.select();
  });
}

// --------------------------------------------------------
// Inline Blur-Validierung
// --------------------------------------------------------

/**
 * Aktiviert Blur-Validierung für alle required-Inputs in einem Container.
 * @param {HTMLElement} formContainer
 */
export function wireBlurValidation(formContainer) {
  formContainer.querySelectorAll('input[required], select[required], textarea[required]').forEach((input) => {
    input.addEventListener('blur', () => {
      const group = input.closest('.form-field') ?? input.parentElement;
      const hasValue = input.value.trim().length > 0;
      group?.classList.toggle('form-field--error', !hasValue);
      group?.classList.toggle('form-field--valid', hasValue);
    });
  });
}

// --------------------------------------------------------
// Submit-Feedback (Checkmark + Shake)
// --------------------------------------------------------

/**
 * Zeigt Erfolgs-Feedback auf einem Button (Checkmark für 700ms).
 * @param {HTMLButtonElement} btn
 * @param {string} [originalLabel]
 */
export function btnSuccess(btn, originalLabel) {
  const label = originalLabel ?? btn.textContent;
  btn.classList.add('btn--success');
  btn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2.5" aria-hidden="true">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  `;
  setTimeout(() => {
    btn.classList.remove('btn--success');
    btn.textContent = label;
  }, 700);
}

/**
 * Zeigt Fehler-Feedback auf einem Button (Shake-Animation).
 * @param {HTMLButtonElement} btn
 */
export function btnError(btn) {
  btn.classList.remove('btn--shaking');
  void btn.offsetWidth; // Reflow für Animation-Restart
  btn.classList.add('btn--shaking');
  btn.addEventListener('animationend', () => btn.classList.remove('btn--shaking'), { once: true });
}
