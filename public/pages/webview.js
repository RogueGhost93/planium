import { t } from '/i18n.js';
import { loadWebviewConfig, renderWebviewCard, wireWebviewCards, webviewItemLabel } from '/components/webview-manager.js';
import { esc } from '/utils/html.js';

function renderLoading() {
  return `
    <div class="empty-state webview-empty">
      <div class="empty-state__title">${t('webview.loadingTitle')}</div>
      <div class="empty-state__description">${t('webview.loadingDescription')}</div>
    </div>
  `;
}

function renderMissing() {
  return `
    <div class="empty-state webview-empty">
      <div class="empty-state__title">${t('webview.notConfiguredTitle')}</div>
      <div class="empty-state__description">${t('webview.notConfiguredDescription')}</div>
      <div class="webview-empty__hint">${t('webview.emptyHint')}</div>
    </div>
  `;
}

function renderPage(items) {
  const visibleItems = items.filter((item) => item?.show_in_tabs !== false && item?.url);
  const pageTitle = visibleItems.length === 1 ? webviewItemLabel(visibleItems[0]) : t('webview.pageTitle');
  const pageSubtitle = visibleItems.length > 1 ? t('webview.pageSubtitle', { count: visibleItems.length }) : '';

  return `
    <div class="webview-shell">
      <div class="webview-page-header">
        <div class="webview-page-header__meta">
          <h1 class="webview-page-title">${esc(pageTitle)}</h1>
          ${pageSubtitle ? `<div class="webview-page-subtitle">${esc(pageSubtitle)}</div>` : ''}
        </div>
      </div>

      <div class="webview-list">
        ${visibleItems.map((item) => renderWebviewCard(item, { variant: 'page' })).join('')}
      </div>
    </div>
  `;
}

export async function render(container) {
  container.innerHTML = renderLoading();

  let config;
  try {
    config = await loadWebviewConfig();
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state webview-empty">
        <div class="empty-state__title">${t('common.errorOccurred')}</div>
        <div class="empty-state__description">${esc(err?.message || t('common.errorGeneric'))}</div>
      </div>
    `;
    return;
  }

  const items = Array.isArray(config?.data?.items) ? config.data.items : [];
  if (!items.length) {
    container.innerHTML = renderMissing();
    return;
  }

  container.innerHTML = renderPage(items);
  wireWebviewCards(container);
  container.querySelectorAll('[data-webview-frame]').forEach((iframe) => {
    iframe.addEventListener('load', () => {
      iframe.closest('.webview-card, .widget--webview')?.classList.add('webview-card--loaded');
    });
  });

  document.title = `${items.length === 1 ? webviewItemLabel(items[0]) : t('webview.pageTitle')} · Planium`;
  window.lucide?.createIcons();
}
