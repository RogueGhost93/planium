/**
 * Module: News
 * Purpose: FreshRSS headline list with external article links
 * Dependencies: /api.js, /router.js (window.planium)
 */

import { api } from '/api.js';
import { t } from '/i18n.js';
import { esc } from '/utils/html.js';

const LIMIT_KEY = 'planium-news-limit';
const LIMITS = [100, 200];

const FONT_SIZE_KEY = 'planium-news-fontsize';
const FONT_SIZE_MIN = 11;
const FONT_SIZE_MAX = 18;
const FONT_SIZE_DEFAULT = 14;

let state = {
  limit: 100,
  fontSize: FONT_SIZE_DEFAULT,
  headlines: [],
  loading: true,
  connected: true,
};

function getStoredLimit() {
  const raw = Number.parseInt(localStorage.getItem(LIMIT_KEY), 10);
  return LIMITS.includes(raw) ? raw : 100;
}

function getStoredFontSize() {
  const raw = Number.parseInt(localStorage.getItem(FONT_SIZE_KEY), 10);
  return Number.isFinite(raw) && raw >= FONT_SIZE_MIN && raw <= FONT_SIZE_MAX ? raw : FONT_SIZE_DEFAULT;
}

function formatPublishedAt(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function renderToolbar() {
  return `
    <div class="news-toolbar">
      <div class="news-toolbar__title-wrap">
        <h1 class="news-toolbar__title">${t('news.title')}</h1>
        <span class="news-toolbar__count" id="news-count">${state.headlines.length}</span>
      </div>
      <div class="news-toolbar__actions">
        <div class="news-font-toggle" role="group" aria-label="Font size">
          <button class="news-font-toggle__btn" id="news-font-decrease" type="button"
                  aria-label="Decrease font size"${state.fontSize <= FONT_SIZE_MIN ? ' disabled' : ''}>A−</button>
          <button class="news-font-toggle__btn news-font-toggle__btn--large" id="news-font-increase" type="button"
                  aria-label="Increase font size"${state.fontSize >= FONT_SIZE_MAX ? ' disabled' : ''}>A+</button>
        </div>
        <div class="news-limit-toggle" role="group" aria-label="${t('news.limitLabel')}">
          ${LIMITS.map((limit) => `
            <button class="news-limit-toggle__btn ${state.limit === limit ? 'news-limit-toggle__btn--active' : ''}"
                    data-limit="${limit}" type="button">
              ${limit}
            </button>
          `).join('')}
        </div>
        <button class="btn btn--icon news-refresh-btn" id="news-refresh-btn"
                type="button" title="${t('news.refresh')}" aria-label="${t('news.refresh')}">
          <i data-lucide="refresh-cw" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  `;
}

function renderSkeleton() {
  return `
    <div class="news-list news-list--loading" aria-busy="true">
      ${Array.from({ length: 12 }, () => `
        <div class="news-skeleton">
          <div class="news-skeleton__favicon"></div>
          <div class="news-skeleton__body">
            <div class="news-skeleton__title"></div>
            <div class="news-skeleton__meta"></div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderEmpty() {
  const title = state.connected ? t('news.emptyTitle') : t('news.notConnectedTitle');
  const description = state.connected ? t('news.emptyDescription') : t('news.notConnectedDescription');
  const settingsButton = state.connected ? '' : `
    <button class="btn btn--primary" id="news-settings-btn" type="button">
      <i data-lucide="settings" aria-hidden="true"></i>
      ${t('nav.settings')}
    </button>
  `;

  return `
    <div class="empty-state news-empty">
      <div class="empty-state__title">${title}</div>
      <div class="empty-state__description">${description}</div>
      ${settingsButton}
    </div>
  `;
}

function getFaviconUrl(item) {
  const targetUrl = item.sourceUrl || item.url;
  if (!targetUrl) return null;
  try {
    const { hostname } = new URL(targetUrl);
    return `https://${hostname}/favicon.ico`;
  } catch {
    return null;
  }
}

function renderItem(item) {
  const source = item.source || 'FreshRSS';
  const time = formatPublishedAt(item.publishedAt);
  const meta = [source, time].filter(Boolean).join(' · ');
  const href = item.url || '#';
  const disabledAttrs = item.url
    ? 'target="_blank" rel="noopener noreferrer"'
    : 'aria-disabled="true" tabindex="-1"';
  const faviconUrl = getFaviconUrl(item);
  const favicon = faviconUrl
    ? `<img class="news-item__favicon" src="${esc(faviconUrl)}" alt="" width="16" height="16" aria-hidden="true" onerror="this.style.display='none'">`
    : `<span class="news-item__favicon news-item__favicon--placeholder"></span>`;

  return `
    <a class="news-item" href="${esc(href)}" ${disabledAttrs}>
      ${favicon}
      <span class="news-item__body">
        <span class="news-item__title">${esc(item.title)}</span>
        <span class="news-item__meta">${esc(meta)}</span>
      </span>
    </a>
  `;
}

function renderList(container) {
  const list = container.querySelector('#news-content');
  if (!list) return;

  container.querySelector('#news-count').textContent = String(state.headlines.length);
  container.querySelectorAll('.news-limit-toggle__btn').forEach((btn) => {
    btn.classList.toggle('news-limit-toggle__btn--active', Number(btn.dataset.limit) === state.limit);
  });

  if (state.loading) {
    list.innerHTML = renderSkeleton();
  } else if (!state.headlines.length) {
    list.innerHTML = renderEmpty();
  } else {
    list.innerHTML = `
      <div class="news-list">
        ${state.headlines.map(renderItem).join('')}
      </div>
    `;
  }

  if (window.lucide) lucide.createIcons();

  container.querySelector('#news-settings-btn')?.addEventListener('click', () => {
    window.planium?.navigate('/settings');
  });
}

function applyFontSize(container) {
  const content = container.querySelector('#news-content');
  if (content) content.style.fontSize = `${state.fontSize}px`;
  container.querySelector('#news-font-decrease').disabled = state.fontSize <= FONT_SIZE_MIN;
  container.querySelector('#news-font-increase').disabled = state.fontSize >= FONT_SIZE_MAX;
}

async function loadHeadlines(container) {
  const refreshBtn = container.querySelector('#news-refresh-btn');
  state.loading = true;
  renderList(container);
  if (refreshBtn) refreshBtn.disabled = true;

  try {
    const res = await api.get(`/freshrss/headlines?limit=${state.limit}`);
    state.headlines = Array.isArray(res.data) ? res.data : [];
    state.connected = !!res.data;
  } catch (err) {
    state.headlines = [];
    state.connected = false;
    window.planium?.showToast(err.data?.error ?? err.message, 'warning');
  } finally {
    state.loading = false;
    if (refreshBtn) refreshBtn.disabled = false;
    renderList(container);
  }
}

export async function render(container) {
  state = {
    limit: getStoredLimit(),
    fontSize: getStoredFontSize(),
    headlines: [],
    loading: true,
    connected: true,
  };

  container.innerHTML = `
    <div class="news-page">
      ${renderToolbar()}
      <div id="news-content"></div>
    </div>
  `;

  container.querySelector('#news-content').style.fontSize = `${state.fontSize}px`;

  container.querySelector('#news-font-decrease')?.addEventListener('click', () => {
    if (state.fontSize <= FONT_SIZE_MIN) return;
    state.fontSize -= 1;
    localStorage.setItem(FONT_SIZE_KEY, String(state.fontSize));
    applyFontSize(container);
  });

  container.querySelector('#news-font-increase')?.addEventListener('click', () => {
    if (state.fontSize >= FONT_SIZE_MAX) return;
    state.fontSize += 1;
    localStorage.setItem(FONT_SIZE_KEY, String(state.fontSize));
    applyFontSize(container);
  });

  container.querySelector('#news-refresh-btn')?.addEventListener('click', () => {
    loadHeadlines(container);
  });

  container.querySelectorAll('.news-limit-toggle__btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextLimit = Number(btn.dataset.limit);
      if (nextLimit === state.limit) return;
      state.limit = nextLimit;
      localStorage.setItem(LIMIT_KEY, String(nextLimit));
      loadHeadlines(container);
    });
  });

  if (window.lucide) lucide.createIcons();
  await loadHeadlines(container);
}
