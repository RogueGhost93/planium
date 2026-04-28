import { api } from '/api.js';
import { t } from '/i18n.js';
import { esc } from '/utils/html.js';
import { openModal, closeModal, showConfirm } from '/components/modal.js';

function normalizeWebviewItemInput(item = {}, fallbackIndex = 0) {
  const name = String(item.name ?? '').trim() || t('webview.defaultName');
  const url = String(item.url ?? '').trim();
  const showInTabs = item.show_in_tabs !== false && item.showInTabs !== false;
  const id = String(item.id ?? '').trim() || `webview-${fallbackIndex + 1}`;

  return { id, name, url, show_in_tabs: showInTabs };
}

export async function loadWebviewConfig() {
  return api.get('/webview/config');
}

export async function saveWebviewConfig(items) {
  return api.put('/webview/config', { items });
}

export async function clearWebviewConfig() {
  return api.delete('/webview/config');
}

export function webviewItemLabel(item = {}) {
  return String(item.name ?? '').trim() || t('webview.defaultName');
}

export function webviewItemUrl(item = {}) {
  return String(item.url ?? '').trim();
}

export function renderWebviewCard(item, {
  variant = 'page',
  showSubtitle = true,
} = {}) {
  const id = esc(item.id ?? '');
  const name = esc(webviewItemLabel(item));
  const url = esc(webviewItemUrl(item));
  const titleAttr = esc(webviewItemLabel(item));
  const cardClass = variant === 'widget'
    ? 'widget widget--webview'
    : 'webview-card';
  const bodyClass = variant === 'widget'
    ? 'widget__body webview-widget__body'
    : 'webview-card__body';
  const frameClass = variant === 'widget'
    ? 'webview-widget__frame'
    : 'webview-card__frame';
  const headerClass = variant === 'widget'
    ? 'widget__header webview-widget__header'
    : 'webview-card__header';
  const titleClass = variant === 'widget'
    ? 'widget__title webview-widget__title'
    : 'webview-card__title';
  const subtitleClass = variant === 'widget'
    ? 'webview-widget__subtitle'
    : 'webview-card__subtitle';
  const actionsClass = variant === 'widget'
    ? 'widget__header-actions webview-widget__actions'
    : 'webview-card__actions';
  const iconClass = variant === 'widget'
    ? 'widget__title-icon'
    : 'webview-card__icon';

  return `
    <article class="${cardClass}" data-webview-item-id="${id}">
      <div class="${headerClass}">
        <div class="webview-card__meta">
          <div class="${titleClass}">
            <i data-lucide="globe" class="${iconClass}" aria-hidden="true"></i>
            <span>${name}</span>
          </div>
          ${showSubtitle ? `<div class="${subtitleClass}">${url}</div>` : ''}
        </div>
        <div class="${actionsClass}">
          <button class="btn btn--ghost btn--icon" type="button"
                  data-webview-action="open"
                  data-webview-url="${url}"
                  aria-label="${t('webview.openInNewTab')}"
                  title="${t('webview.openInNewTab')}">
            <i data-lucide="external-link" aria-hidden="true"></i>
          </button>
          <button class="btn btn--ghost btn--icon" type="button"
                  data-webview-action="reload"
                  data-webview-item-id="${id}"
                  aria-label="${t('common.reload')}"
                  title="${t('common.reload')}">
            <i data-lucide="refresh-cw" aria-hidden="true"></i>
          </button>
        </div>
      </div>
      <div class="${bodyClass}">
        <iframe
          class="${frameClass}"
          data-webview-frame="${id}"
          src="${url}"
          title="${titleAttr}"
          loading="eager"
          referrerpolicy="no-referrer"
        ></iframe>
      </div>
    </article>
  `;
}

export function wireWebviewCards(container) {
  container.querySelectorAll('[data-webview-action="open"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.webviewUrl?.trim();
      if (!url) return;
      window.open(url, '_blank', 'noopener,noreferrer');
    });
  });

  container.querySelectorAll('[data-webview-action="reload"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const itemId = btn.dataset.webviewItemId?.trim();
      if (!itemId) return;
      const iframe = container.querySelector(`[data-webview-frame="${CSS.escape(itemId)}"]`);
      if (iframe) iframe.src = iframe.src;
    });
  });
}

function editorHtml(item = {}) {
  const name = esc(item.name ?? '');
  const url = esc(item.url ?? '');
  const showInTabs = item.show_in_tabs !== false && item.showInTabs !== false;
  return `
    <form class="webview-editor" data-webview-editor>
      <div class="form-group">
        <label class="form-label" for="webview-name">${t('webview.nameLabel')}</label>
        <input class="form-input" type="text" id="webview-name" value="${name}" required />
      </div>
      <div class="form-group">
        <label class="form-label" for="webview-url">${t('webview.urlLabel')}</label>
        <input class="form-input" type="url" id="webview-url" value="${url}" placeholder="${t('webview.urlPlaceholder')}" required />
      </div>
      <div class="settings-toggle-row webview-editor__toggle">
        <label class="settings-toggle-label" for="webview-show-in-tabs">${t('webview.showInTabsLabel')}</label>
        <label class="toggle-switch">
          <input type="checkbox" id="webview-show-in-tabs" ${showInTabs ? 'checked' : ''} />
          <span class="toggle-switch__slider"></span>
        </label>
      </div>
      <span class="form-hint">${t('webview.showInTabsHelp')}</span>
      <div class="webview-editor__status" hidden></div>
      <div class="modal-panel__footer">
        <button class="btn btn--ghost" type="button" data-webview-editor-cancel>${t('common.cancel')}</button>
        <button class="btn btn--primary" type="submit">${t('common.save')}</button>
      </div>
    </form>
  `;
}

export function openWebviewEditor({ item = {}, title, onSubmit } = {}) {
  openModal({
    title: title ?? (item?.id ? t('webview.editTitle') : t('webview.addTitle')),
    size: 'sm',
    content: editorHtml(item),
    onSave(panel) {
      const form = panel.querySelector('[data-webview-editor]');
      const status = panel.querySelector('.webview-editor__status');
      const cancelBtn = panel.querySelector('[data-webview-editor-cancel]');
      cancelBtn?.addEventListener('click', closeModal);

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (status) {
          status.hidden = false;
          status.textContent = t('common.saving');
        }

        const payload = normalizeWebviewItemInput({
          id: item?.id,
          name: panel.querySelector('#webview-name')?.value,
          url: panel.querySelector('#webview-url')?.value,
          show_in_tabs: panel.querySelector('#webview-show-in-tabs')?.checked,
        }, 0);

        try {
          await onSubmit?.(payload);
          closeModal();
        } catch (err) {
          if (status) {
            status.textContent = err?.message || t('common.errorOccurred');
          }
          return;
        }
      });
    },
  });
}

export async function confirmWebviewDelete(item) {
  return showConfirm(
    t('webview.deleteConfirm', { name: webviewItemLabel(item) }),
    { danger: true, title: t('webview.deleteTitle') }
  );
}
