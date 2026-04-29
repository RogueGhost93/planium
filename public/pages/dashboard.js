/**
 * Modul: Dashboard
 * Zweck: Startseite mit Begrüßung, Terminen, Aufgaben, Essen, Notizen und FAB
 * Abhängigkeiten: /api.js
 */

import { api } from '/api.js';
import { t, formatDate, formatTime, getLocale } from '/i18n.js';
import { esc, linkify } from '/utils/html.js';
import { openItemEditDialog } from '/pages/tasks.js';
import { openNoteModal, openNotePreviewModal } from '/pages/notes.js';
import { renderPriceTickers, wirePriceTickers } from '/components/price-tickers.js';
import { showConfirm, openModal } from '/components/modal.js';
import { openDashboardWidgetPicker } from '/components/dashboard-widget-picker.js';
import {
  dashboardWidgetHeightClass,
  dashboardWidgetHeightLabel,
  nextDashboardWidgetHeight,
  normalizeDashboardLayoutForDevice,
  stripDashboardLayoutVisibility,
} from '/lib/dashboard-layout.js';
import {
  renderWebviewCard,
  wireWebviewCards,
} from '/components/webview-manager.js';
import { broadcastPersonalItemChange, subscribePersonalItemChange } from '/lib/personal-item-sync.js';

document.addEventListener('click', (event) => {
  const button = event.target.closest?.('#fab-settings');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  openDashboardWidgetPicker();
}, true);

function deleteBtnHtml(action, dataAttrs = '', label = 'Delete') {
  return `<button class="widget-delete-btn" data-action="${action}" ${dataAttrs}
            aria-label="${label}" title="${label}">
    <i data-lucide="x" style="width:14px;height:14px;pointer-events:none" aria-hidden="true"></i>
  </button>`;
}

const PERSONAL_ITEM_SYNC_SOURCE = 'dashboard';
let currentDashboardData = null;
let currentRefreshTasksWidget = null;

subscribePersonalItemChange((change) => {
  if (!change || change.source === PERSONAL_ITEM_SYNC_SOURCE) return;
  if (!currentDashboardData || !currentRefreshTasksWidget) return;

  const itemId = Number(change.itemId);
  if (!Number.isFinite(itemId)) return;

  const items = currentDashboardData.personalItems ?? [];
  const idx = items.findIndex((i) => i.id === itemId);
  if (idx >= 0 && change.item) {
    items[idx] = { ...items[idx], ...change.item };
    currentRefreshTasksWidget();
  }
});

// Hält den AbortController des aktuellen FAB-Listeners - wird bei jedem render() erneuert.
let _fabController = null;

function isDashboardTestVariant() {
  return window.location.pathname === '/dashboard-test';
}

function dashboardApiPath(path = '') {
  return `${isDashboardTestVariant() ? '/dashboard-test' : '/dashboard'}${path}`;
}

function dashboardStorageKey(base) {
  return isDashboardTestVariant() ? `${base}:test` : base;
}

function dashboardTestTemplateKey() {
  return dashboardStorageKey('planium-dashboard-test-template-v3');
}

const DASHBOARD_TEST_BOARD_KEY = 'planium-dashboard-test-board-v2';
const DASHBOARD_TEST_BOARD_COLUMNS = 12;
const DASHBOARD_TEST_BOARD_ROW_HEIGHT = 88;
const DASHBOARD_TEST_BOARD_GAP = 16;
const DASHBOARD_TEST_BOARD_MIN_COLS = 2;
const DASHBOARD_TEST_BOARD_MIN_ROWS = 1;
const DASHBOARD_TEST_BOARD_DEFAULTS = {
  'quote-widget': { x: 0, y: 0, w: 12, h: 2 },
  'tasks-widget': { x: 0, y: 2, w: 8, h: 4 },
  'events-widget': { x: 8, y: 2, w: 4, h: 2 },
  'shopping-widget': { x: 8, y: 4, w: 4, h: 2 },
  'quick-notes-widget': { x: 8, y: 6, w: 4, h: 3 },
};

function applyDashboardTestBoardTemplate(layoutState) {
  if (!isDashboardTestVariant()) return false;
  if (localStorage.getItem(dashboardTestTemplateKey()) === 'true') return false;

  layoutState.order = [
    'quote-widget',
    'events-widget',
    'shopping-widget',
    'quick-notes-widget',
    'tasks-widget',
  ];
  layoutState.spans['quote-widget'] = 'full';
  layoutState.heights['quote-widget'] = 'short';
  layoutState.spans['tasks-widget'] = '2';
  layoutState.heights['tasks-widget'] = 'xlarge';
  layoutState.spans['events-widget'] = '1';
  layoutState.heights['events-widget'] = 'short';
  layoutState.spans['shopping-widget'] = '1';
  layoutState.heights['shopping-widget'] = 'short';
  layoutState.spans['quick-notes-widget'] = '1';
  layoutState.heights['quick-notes-widget'] = 'short';

  localStorage.setItem(dashboardTestTemplateKey(), 'true');
  return true;
}

function normalizeDashboardTestBoardRect(value, fallback = { x: 0, y: 0, w: 4, h: 3 }) {
  const rect = value && typeof value === 'object' ? value : fallback;
  const x = Number.isFinite(Number(rect.x)) ? Math.max(0, Math.floor(Number(rect.x))) : fallback.x;
  const y = Number.isFinite(Number(rect.y)) ? Math.max(0, Math.floor(Number(rect.y))) : fallback.y;
  const w = Number.isFinite(Number(rect.w)) ? Math.floor(Number(rect.w)) : fallback.w;
  const h = Number.isFinite(Number(rect.h)) ? Math.floor(Number(rect.h)) : fallback.h;
  const safeW = Math.max(DASHBOARD_TEST_BOARD_MIN_COLS, Math.min(DASHBOARD_TEST_BOARD_COLUMNS, w));
  return {
    x: Math.max(0, Math.min(Math.max(0, DASHBOARD_TEST_BOARD_COLUMNS - safeW), x)),
    y: Math.max(0, y),
    w: safeW,
    h: Math.max(DASHBOARD_TEST_BOARD_MIN_ROWS, h),
  };
}

function loadDashboardTestBoardState(widgetIds = []) {
  const defaults = {};
  let yCursor = 0;
  for (const id of widgetIds) {
    const fallback = DASHBOARD_TEST_BOARD_DEFAULTS[id] ?? { x: 0, y: yCursor, w: 4, h: 3 };
    defaults[id] = normalizeDashboardTestBoardRect(fallback, fallback);
    yCursor = Math.max(yCursor, defaults[id].y + defaults[id].h);
  }

  try {
    const raw = localStorage.getItem(DASHBOARD_TEST_BOARD_KEY);
    if (!raw) {
      return { rects: defaults };
    }
    const parsed = JSON.parse(raw);
    const rects = {};
    for (const id of widgetIds) {
      rects[id] = normalizeDashboardTestBoardRect(parsed?.rects?.[id], defaults[id]);
    }
    const order = Array.isArray(parsed?.order)
      ? parsed.order.filter((id) => widgetIds.includes(id)).concat(widgetIds.filter((id) => !parsed.order.includes(id)))
      : widgetIds.slice();
    return { rects, order };
  } catch {
    return { rects: defaults, order: widgetIds.slice() };
  }
}

function saveDashboardTestBoardState(state) {
  try {
    localStorage.setItem(DASHBOARD_TEST_BOARD_KEY, JSON.stringify({
      rects: state.rects,
      order: Array.isArray(state.order) ? state.order : [],
    }));
  } catch {
    // ignore write failures; test board remains usable in-memory
  }
}

function sortDashboardTestBoardOrder(rects, widgetIds) {
  return widgetIds.slice().sort((a, b) => {
    const rectA = rects[a] || { x: 0, y: 0, w: 0, h: 0 };
    const rectB = rects[b] || { x: 0, y: 0, w: 0, h: 0 };
    if (rectA.y !== rectB.y) return rectA.y - rectB.y;
    if (rectA.x !== rectB.x) return rectA.x - rectB.x;
    if (rectA.h !== rectB.h) return rectB.h - rectA.h;
    if (rectA.w !== rectB.w) return rectB.w - rectA.w;
    return a.localeCompare(b);
  });
}

function dashboardTestBoardCellSize(board) {
  const styles = window.getComputedStyle(board);
  const rowHeight = parseFloat(styles.getPropertyValue('--test-board-row-height')) || DASHBOARD_TEST_BOARD_ROW_HEIGHT;
  const columnGap = parseFloat(styles.getPropertyValue('--test-board-gap')) || DASHBOARD_TEST_BOARD_GAP;
  const rowGap = parseFloat(styles.getPropertyValue('--test-board-gap')) || DASHBOARD_TEST_BOARD_GAP;
  const width = board.getBoundingClientRect().width || 0;
  const colWidth = Math.max(1, (width - (columnGap * (DASHBOARD_TEST_BOARD_COLUMNS - 1))) / DASHBOARD_TEST_BOARD_COLUMNS);
  return { colWidth, rowHeight, columnGap, rowGap };
}

function dashboardTestBoardRectToPixels(rect, metrics) {
  const left = rect.x * (metrics.colWidth + metrics.columnGap);
  const top = rect.y * (metrics.rowHeight + metrics.rowGap);
  const width = (rect.w * metrics.colWidth) + ((rect.w - 1) * metrics.columnGap);
  const height = (rect.h * metrics.rowHeight) + ((rect.h - 1) * metrics.rowGap);
  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
  };
}

function dashboardTestBoardOccupied(rows, x, y, w, h) {
  for (let r = y; r < y + h; r += 1) {
    if (!rows[r]) rows[r] = Array(DASHBOARD_TEST_BOARD_COLUMNS).fill(false);
    for (let c = x; c < x + w; c += 1) {
      if (rows[r][c]) return true;
    }
  }
  return false;
}

function dashboardTestBoardMark(rows, x, y, w, h) {
  for (let r = y; r < y + h; r += 1) {
    if (!rows[r]) rows[r] = Array(DASHBOARD_TEST_BOARD_COLUMNS).fill(false);
    for (let c = x; c < x + w; c += 1) {
      rows[r][c] = true;
    }
  }
}

function dashboardTestBoardFindSpot(rows, rect) {
  const maxWidth = DASHBOARD_TEST_BOARD_COLUMNS - rect.w;
  for (let y = rect.y; y < rect.y + 800; y += 1) {
    for (let x = 0; x <= maxWidth; x += 1) {
      if (!dashboardTestBoardOccupied(rows, x, y, rect.w, rect.h)) {
        return { x, y, w: rect.w, h: rect.h };
      }
    }
  }
  return { ...rect };
}

function packDashboardTestBoardRects(rects, order, activeId = null) {
  const rows = [];
  const packed = {};
  const ids = activeId ? [activeId, ...order.filter((id) => id !== activeId)] : order.slice();
  for (const id of ids) {
    const rect = normalizeDashboardTestBoardRect(rects[id], DASHBOARD_TEST_BOARD_DEFAULTS[id] ?? { x: 0, y: 0, w: 4, h: 3 });
    const placed = dashboardTestBoardFindSpot(rows, rect);
    packed[id] = placed;
    dashboardTestBoardMark(rows, placed.x, placed.y, placed.w, placed.h);
  }
  return packed;
}

function renderDashboardTestBoardSlot(widgetId, widgetHtml, rect) {
  return `
    <div class="dashboard-test-board__slot" data-board-widget-id="${widgetId}"
         data-board-x="${rect.x}" data-board-y="${rect.y}" data-board-w="${rect.w}" data-board-h="${rect.h}">
      ${widgetHtml}
      <div class="dashboard-test-board__resize-handle dashboard-test-board__resize-handle--nw" data-action="test-resize" data-dir="nw"></div>
      <div class="dashboard-test-board__resize-handle dashboard-test-board__resize-handle--n" data-action="test-resize" data-dir="n"></div>
      <div class="dashboard-test-board__resize-handle dashboard-test-board__resize-handle--ne" data-action="test-resize" data-dir="ne"></div>
      <div class="dashboard-test-board__resize-handle dashboard-test-board__resize-handle--e" data-action="test-resize" data-dir="e"></div>
      <div class="dashboard-test-board__resize-handle dashboard-test-board__resize-handle--se" data-action="test-resize" data-dir="se"></div>
      <div class="dashboard-test-board__resize-handle dashboard-test-board__resize-handle--s" data-action="test-resize" data-dir="s"></div>
      <div class="dashboard-test-board__resize-handle dashboard-test-board__resize-handle--sw" data-action="test-resize" data-dir="sw"></div>
      <div class="dashboard-test-board__resize-handle dashboard-test-board__resize-handle--w" data-action="test-resize" data-dir="w"></div>
    </div>
  `;
}

function isDashboardEditModeEnabled() {
  return localStorage.getItem(dashboardStorageKey('planium-dashboard-edit-mode')) === 'true';
}

function setDashboardEditMode(container, enabled) {
  localStorage.setItem(dashboardStorageKey('planium-dashboard-edit-mode'), enabled ? 'true' : 'false');
  container.querySelector('.dashboard')?.classList.toggle('dashboard--edit-mode', enabled);
  container.querySelector('#dashboard-test-board')?.classList.toggle('dashboard__test-board--edit-mode', enabled);
  const btn = container.querySelector('#fab-edit-mode');
  if (btn) {
    btn.classList.toggle('fab-settings--active', enabled);
    btn.setAttribute('aria-pressed', String(enabled));
  }
  const testBoardBtn = container.querySelector('#dashboard-test-board-edit-toggle');
  if (testBoardBtn) {
    testBoardBtn.setAttribute('aria-pressed', String(enabled));
  }
  if (enabled && isDashboardTestVariant()) {
    window.planium?.showToast?.('Edit mode on. Drag widget edges to resize.', 'success');
  }
}

// --------------------------------------------------------
// Hilfsfunktionen
// --------------------------------------------------------

function renderMarkdownLight(text) {
  if (!text) return '';
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/^- (.+)$/gm,     '• $1')
    .replace(/\n/g,            '<br>');
}

function greeting(displayName) {
  const h = new Date().getHours();
  if (h < 12) return t('dashboard.greetingMorning', { name: esc(displayName) });
  if (h < 18) return t('dashboard.greetingDay',     { name: esc(displayName) });
  return t('dashboard.greetingEvening', { name: esc(displayName) });
}

function greetingWidgetAccentFillEnabled(user) {
  if (user?.appearance_greeting_widget_accent_fill != null) {
    return user.appearance_greeting_widget_accent_fill === true
      || user.appearance_greeting_widget_accent_fill === 1
      || user.appearance_greeting_widget_accent_fill === '1';
  }
  return localStorage.getItem('planium-greeting-accent-fill') === 'true';
}

function formatDateTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const dateStr = d.toDateString() === today.toDateString()
    ? t('common.today')
    : d.toDateString() === tomorrow.toDateString()
    ? t('common.tomorrow')
    : formatDate(d);

  const timeStr = formatTime(d);
  const suffix = t('calendar.timeSuffix');
  return `${dateStr}, ${timeStr}${suffix ? ' ' + suffix : ''}`.trim();
}

function diffCalendarDays(dateStr) {
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const targetMidnight = dateStr.length === 10
    ? new Date(dateStr + 'T00:00:00')
    : new Date(dateStr);
  targetMidnight.setHours(0, 0, 0, 0);
  return Math.round((targetMidnight - todayMidnight) / (1000 * 60 * 60 * 24));
}

/** Returns true if the date string falls within next calendar week (Mon–Sun). */
function isNextCalendarWeek(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dow = today.getDay(); // 0=Sun … 6=Sat
  const daysToNextMon = dow === 0 ? 1 : 8 - dow;
  const nextMon = new Date(today);
  nextMon.setDate(today.getDate() + daysToNextMon);
  const nextSun = new Date(nextMon);
  nextSun.setDate(nextMon.getDate() + 6);
  const target = dateStr.length === 10 ? new Date(dateStr + 'T00:00:00') : new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return target >= nextMon && target <= nextSun;
}

function formatDueDate(dateStr) {
  if (!dateStr) return null;
  const diff = diffCalendarDays(dateStr);
  const dateLabel = formatDate(
    dateStr.length === 10 ? new Date(dateStr + 'T00:00:00') : new Date(dateStr)
  );

  if (diff < 0)   return { html: `<span class="task-rel-label task-rel-label--overdue">${t('dashboard.overdue')}</span>`, overdue: true };
  if (diff === 0) return { html: `<span class="task-rel-label task-rel-label--today">${t('dashboard.dueSoon')}</span>`, overdue: false };
  if (diff === 1) return { html: `<span class="task-rel-label task-rel-label--soon">${t('dashboard.dueTomorrow')}</span>`, overdue: false };
  if (diff <= 14) return { html: `${dateLabel} · <span class="task-rel-label">${t('dashboard.inDays', { count: diff })}</span>`, overdue: false };
  if (isNextCalendarWeek(dateStr)) return { html: `${dateLabel} · <span class="task-rel-label">${t('dashboard.nextWeek')}</span>`, overdue: false };
  return { html: dateLabel, overdue: false };
}

/** Returns a short relative label for calendar events (null = show nothing extra) */
function eventRelativeLabel(dateStr) {
  if (!dateStr) return null;
  const short = dateStr.length === 10 ? dateStr : dateStr.slice(0, 10);
  const diff = diffCalendarDays(short);
  if (diff <= 0)  return null; // today already shown via badge
  if (diff === 1) return t('common.tomorrow').toLowerCase();
  if (diff <= 7)  return t('dashboard.inDays', { count: diff });
  if (diff <= 14) return t('dashboard.inTwoWeeks');
  return null;
}

const PRIORITY_LABELS = () => ({
  urgent: t('tasks.priorityUrgent'),
  high:   t('tasks.priorityHigh'),
  medium: t('tasks.priorityMedium'),
  low:    t('tasks.priorityLow'),
});

const MEAL_LABELS = () => ({
  breakfast: t('meals.typeBreakfast'),
  lunch:     t('meals.typeLunch'),
  dinner:    t('meals.typeDinner'),
  snack:     t('meals.typeSnack'),
});

const MEAL_ICONS = {
  breakfast: 'sunrise',
  lunch:     'sun',
  dinner:    'moon',
  snack:     'apple',
};

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function widgetSpanClass(span = '1') {
  return `widget-layout--span-${span}`;
}

function widgetHeightClass(height = 'normal') {
  return dashboardWidgetHeightClass(height);
}

function dashboardLayoutItemId(type, id) {
  return `${type}:${String(id).trim()}`;
}

function nextWidgetSpan(span = '1') {
  if (span === '1') return '2';
  if (span === '2') return 'full';
  return '1';
}

function widgetHeightButton(widgetId, height = 'normal') {
  const nextHeight = nextDashboardWidgetHeight(height);
  const nextLabel = dashboardWidgetHeightLabel(nextHeight);
  return `
    <button class="widget__height-btn" type="button"
            data-action="cycle-widget-height" data-widget-id="${widgetId}"
            data-next-height="${nextHeight}"
            aria-label="Resize widget height to ${nextLabel}"
            title="Resize widget height">
      <span class="widget__height-btn-label">${dashboardWidgetHeightLabel(height)}</span>
    </button>
  `;
}

function widgetSizeButton(widgetId, span = '1') {
  const nextSpan = nextWidgetSpan(span);
  const label = span === 'full' ? 'Full' : `${span}`;
  const nextLabel = nextSpan === 'full' ? 'Full width' : `${nextSpan} column${nextSpan === '1' ? '' : 's'}`;
  return `
    <button class="widget__size-btn" type="button"
            data-action="cycle-widget-span" data-widget-id="${widgetId}"
            data-next-span="${nextSpan}"
            aria-label="Resize widget to ${nextLabel}"
            title="Resize widget">
      <span class="widget__size-btn-label">${label}</span>
    </button>
  `;
}

function widgetDragHandle(widgetId) {
  return `
    <button class="widget__drag-handle" type="button"
            data-action="drag-widget" data-widget-id="${widgetId}"
            aria-label="Reorder widget" title="Drag to reorder">
      <i data-lucide="grip-vertical" aria-hidden="true"></i>
    </button>
  `;
}

function widgetHeader(icon, title, count, linkHref, linkLabel, addRoute, addFlag, { widgetId = null, span = '1', height = 'normal' } = {}) {
  linkLabel = linkHref ? (linkLabel ?? t('dashboard.allLink')) : null;
  const addBtn = addRoute
    ? `<button class="widget__add-btn" data-route="${addRoute}"${addFlag ? ` data-create-flag="${addFlag}"` : ''}
               aria-label="${t('common.add')}">
         <i data-lucide="plus" style="width:14px;height:14px;pointer-events:none" aria-hidden="true"></i>
       </button>`
    : '';
  const linkBtn = linkHref
    ? `<button data-route="${linkHref}" class="widget__link">
         ${linkLabel}
       </button>`
    : '';
  const dragHandle = widgetId ? widgetDragHandle(widgetId) : '';
  const sizeBtn = widgetId ? widgetSizeButton(widgetId, span) : '';
  const heightBtn = widgetId ? widgetHeightButton(widgetId, height) : '';
  const iconHtml = icon
    ? `<i data-lucide="${icon}" class="widget__title-icon" aria-hidden="true"></i>`
    : '';
  return `
    <div class="widget__header">
      <span class="widget__title">
        ${dragHandle}
        ${iconHtml}
        ${title}
      </span>
      <div class="widget__header-actions">
        ${sizeBtn}
        ${heightBtn}
        ${addBtn}
        ${linkBtn}
      </div>
    </div>
  `;
}

// --------------------------------------------------------
// Skeleton
// --------------------------------------------------------

function skeletonWidget(lines = 3) {
  const lineHtml = Array.from({ length: lines }, (_, i) => `
    <div class="skeleton skeleton-line ${i % 2 === 0 ? 'skeleton-line--full' : 'skeleton-line--medium'}"></div>
  `).join('');
  return `
    <div class="widget-skeleton">
      <div class="skeleton skeleton-line skeleton-line--short"></div>
      ${lineHtml}
    </div>
  `;
}

// --------------------------------------------------------
// Widget-Renderer
// --------------------------------------------------------

function renderGreeting(user, stats = {}, headlines = null, weather = null) {
  const { urgentTasks = [] } = stats;
  const quickLink = user?.quick_link || '';
  const accentFill = greetingWidgetAccentFillEnabled(user);

  const now = new Date();
  const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()];

  const weatherChip = weather
    ? `<span class="widget-greeting__sep" aria-hidden="true">·</span>
       <span class="greeting-weather" data-action="open-weather" role="button" tabindex="0"
             aria-label="${t('dashboard.weatherDetailsLabel') || 'Show weather forecast'}">
         <img class="greeting-weather__icon" src="${WEATHER_ICON_BASE}${weather.current.icon}"
              alt="${esc(weather.current.desc)}" width="16" height="16" loading="lazy">
         <span class="greeting-weather__temp">${esc(String(weather.current.temp))}°</span>
       </span>`
    : '';

  let urgentChip = '';
  if (urgentTasks.length > 0) {
    const top = urgentTasks[0];
    const rest = urgentTasks.length - 1;
    const moreTag = rest > 0
      ? `<span class="greeting-chip__more">+${rest}</span>`
      : '';
    const targetAttrs = top.kind === 'personal'
      ? `data-personal-list-id="${top.list_id}"`
      : `data-task-id="${top.id}"`;
    urgentChip = `
      <span class="greeting-chip greeting-chip--warn" data-route="/tasks" ${targetAttrs} role="button" tabindex="0">
        <i data-lucide="alert-circle" style="width:12px;height:12px;flex-shrink:0;" aria-hidden="true"></i>
        <span class="greeting-chip__title">${esc(top.title)}</span>
        ${moreTag}
      </span>`
    ;
  }

  const homeBtn = quickLink
    ? `<button class="greeting-home-btn" data-quick-link="${esc(quickLink)}" aria-label="Home">
        <i data-lucide="home" style="width:14px;height:14px;flex-shrink:0;" aria-hidden="true"></i>
        <span>Home</span>
       </button>`
    : '';

  const showNews = isNewsEnabled() && headlines && headlines.length > 0;
  const newsRow = showNews
    ? `<div class="widget-greeting__news" id="greeting-news" aria-live="polite" aria-atomic="true">
        <i data-lucide="rss" style="width:11px;height:11px;flex-shrink:0;opacity:0.7" aria-hidden="true"></i>
        <span class="greeting-news__source" id="greeting-news-source">${esc(headlines[0].source)}</span>
        <span class="greeting-news__sep" aria-hidden="true">·</span>
        <a class="greeting-news__title" id="greeting-news-title"
           href="${esc(headlines[0].url || '')}" target="_blank" rel="noopener noreferrer"
           ${!headlines[0].url ? 'tabindex="-1" aria-hidden="true"' : ''}
        >${esc(headlines[0].title)}</a>
       </div>`
    : '';

  return `
    <div class="widget-greeting${accentFill ? ' widget-greeting--accent-fill' : ''}">

      <div class="widget-greeting__content">
        <div class="widget-greeting__date-row">
          <span class="widget-greeting__day">${dayName}</span>
          <span class="widget-greeting__sep" aria-hidden="true">·</span>
          <span>${formatDate(now)}</span>
          ${weatherChip}
        </div>
        ${isTickersEnabled() ? renderPriceTickers() : ''}
        <div class="widget-greeting__chips">
          ${urgentChip}
          ${homeBtn}
        </div>
      </div>
      ${newsRow}
    </div>
  `;
}

// --------------------------------------------------------
// Tasks Widget — Tab-Switcher (Household + Personal Lists)
// --------------------------------------------------------

function readWidgetActiveTab(personalLists) {
  const stored = localStorage.getItem(dashboardStorageKey('dashboard-tasks-tab'));
  if (stored != null && stored !== 'household') {
    const id = Number(stored);
    if (personalLists.some((l) => l.id === id)) return id;
  }
  return personalLists.length > 0 ? personalLists[0].id : null;
}


function personalDueLabel(iso) {
  if (!iso) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const target = new Date(iso + 'T00:00:00'); target.setHours(0,0,0,0);
  const diff = Math.round((target - today) / 86400000);
  if (diff < 0)        return { cls: 'personal-widget-item__due--overdue', label: t('dashboard.overdue') };
  if (diff === 0)      return { cls: 'personal-widget-item__due--today',   label: t('dashboard.dueSoon') };
  if (diff === 1)      return { cls: '', label: t('dashboard.dueTomorrow') };
  if (diff <= 14)      return { cls: '', label: t('dashboard.inDays', { count: diff }) };
  return { cls: '', label: formatDate(target) };
}

function getPersonalWidgetItemStatus(item) {
  return item?.status ?? (item?.done ? 'done' : 'open');
}

function setPersonalWidgetItemStatus(item, status) {
  item.status = status;
  item.done = status === 'done' ? 1 : 0;
}

const PERSONAL_WIDGET_STATUS_CYCLE = { open: 'in_progress', in_progress: 'done', done: 'open' };
const PERSONAL_WIDGET_STATUS_ICON = { open: 'circle', in_progress: 'circle-dot', done: 'check-circle' };

function filterWidgetItems(items) {
  return items.filter((i) => {
    if (getPersonalWidgetItemStatus(i) === 'done') return false;
    if (!i.due_date) return true;
    const diff = diffCalendarDays(i.due_date);
    if (diff < 0) return true;
    if (i.is_recurring) {
      const rrule = (i.recurrence_rule || '').toUpperCase();
      if (rrule.includes('FREQ=YEARLY'))  return diff <= 30;
      if (rrule.includes('FREQ=MONTHLY')) return diff <= 7;
      if (rrule.includes('FREQ=WEEKLY'))  return diff <= 1;
      if (rrule.includes('FREQ=DAILY'))   return diff <= 1;
    }
    return true;
  });
}

const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

function currentPriorityAppearance() {
  const value = localStorage.getItem('planium-priority-appearance');
  return value === 'flags' || value === 'both' ? value : 'accent';
}

function showPriorityFlags() {
  return currentPriorityAppearance() !== 'accent';
}

function showPriorityAccent() {
  return currentPriorityAppearance() !== 'flags';
}

function sortWidgetItems(items) {
  return items.slice().sort((a, b) => {
    const aUrgent = a.priority === 'urgent';
    const bUrgent = b.priority === 'urgent';
    if (aUrgent !== bUrgent) return aUrgent ? -1 : 1;
    const ad = a.due_date ? new Date(a.due_date).setHours(0, 0, 0, 0) : Infinity;
    const bd = b.due_date ? new Date(b.due_date).setHours(0, 0, 0, 0) : Infinity;
    if (ad !== bd) return ad - bd;
    const ap = PRIORITY_RANK[a.priority] ?? 4;
    const bp = PRIORITY_RANK[b.priority] ?? 4;
    if (ap !== bp) return ap - bp;
    return a.id - b.id;
  });
}

function selectionIsInsideElement(element) {
  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) {
    return false;
  }

  return [selection.anchorNode, selection.focusNode].some((node) => {
    const container = node.nodeType === 1 ? node : node.parentElement;
    return container ? element.contains(container) : false;
  });
}

function isPhoneViewport() {
  return window.matchMedia('(max-width: 767px)').matches;
}

function renderPersonalListBody(list, items) {
  const pending = sortWidgetItems(filterWidgetItems(items));
  const accentEnabled = showPriorityAccent();
  const flagEnabled = showPriorityFlags();
  const showItemActions = !isPhoneViewport();
  const itemsHtml = pending.length
    ? pending.map((it) => {
        const status = getPersonalWidgetItemStatus(it);
        const nextStatus = PERSONAL_WIDGET_STATUS_CYCLE[status] ?? 'open';
        const statusIcon = PERSONAL_WIDGET_STATUS_ICON[status] ?? 'circle';
        const priority = it.priority && it.priority !== 'none' ? it.priority : null;
        const priorityLabel = priority ? (t(`tasks.priority${priority.charAt(0).toUpperCase()}${priority.slice(1)}`) ?? priority) : '';
        const due = personalDueLabel(it.due_date);
        const hasNote = !!it.description;
        const priorityBadge = priority && flagEnabled
          ? `<span class="priority-badge priority-badge--${priority}"><span class="priority-dot priority-dot--${priority}"></span>${esc(priorityLabel)}</span>`
          : '';
        const meta = (priorityBadge || hasNote || due) ? `
          <div class="personal-widget-item__meta">
            ${priorityBadge}
            ${due ? `<span class="personal-widget-item__due ${due.cls}">${esc(due.label)}</span>` : ''}
            ${hasNote ? `<button class="personal-widget-item__note"
                data-action="view-personal-widget-item-note"
                data-item-id="${it.id}"
                aria-label="View note">
              <i data-lucide="sticky-note" style="width:12px;height:12px;pointer-events:none" aria-hidden="true"></i>
            </button>` : ''}
            </div>` : '';
        return `
        <div class="personal-widget-item ${priority && accentEnabled ? `personal-widget-item--priority personal-widget-item--priority-${priority}` : ''}" data-item-id="${it.id}" data-action="open-personal-widget-item" data-list-id="${list.id}">
          <button class="personal-widget-item__check personal-widget-item__check--${status}"
                  data-action="toggle-personal-widget-item"
                  data-list-id="${list.id}" data-item-id="${it.id}"
                  data-next-status="${nextStatus}"
                  aria-label="${t('tasks.cycleStatus')}"
                  title="${t('tasks.cycleStatus')}">
            <i data-lucide="${statusIcon}" style="width:10px;height:10px;pointer-events:none" aria-hidden="true"></i>
          </button>
          <div class="personal-widget-item__body">
            <span class="personal-widget-item__title">${linkify(it.title)}</span>
            ${meta}
          </div>
          ${showItemActions ? `
          <button class="personal-widget-item__edit"
                  data-action="edit-personal-widget-item"
                  data-list-id="${list.id}" data-item-id="${it.id}"
                  aria-label="${t('tasks.editPersonalItemTitle') ?? 'Edit'}"
                  title="${t('tasks.editPersonalItemTitle') ?? 'Edit'}">
            <i data-lucide="pencil" style="width:14px;height:14px;pointer-events:none" aria-hidden="true"></i>
          </button>
          ${deleteBtnHtml('delete-personal-widget-item', `data-list-id="${list.id}" data-item-id="${it.id}"`, t('common.delete'))}
          ` : ''}
        </div>`;
      }).join('')
    : `<div class="widget__empty" style="padding:var(--space-4)">
         <div style="color:var(--color-text-secondary);font-size:var(--text-sm)">
           ${t('dashboard.personalListEmpty')}
         </div>
       </div>`;

  return `
    <form class="personal-widget-add" data-action="add-personal-widget-item" data-list-id="${list.id}" novalidate autocomplete="off">
      <input class="personal-widget-add__input" type="text" name="title"
             placeholder="${t('dashboard.personalListAddPlaceholder')}"
             maxlength="600" autocomplete="off">
      <button class="personal-widget-add__btn" type="submit" aria-label="${t('tasks.personalListAdd')}">
        <i data-lucide="plus" style="width:16px;height:16px;pointer-events:none" aria-hidden="true"></i>
      </button>
    </form>
    <div class="personal-widget-items">${itemsHtml}</div>
  `;
}

function renderTasksWidgetBody(activeTab, personalLists, personalItems) {
  const list = personalLists.find((l) => l.id === activeTab);
  const items = personalItems.filter((i) => i.list_id === activeTab);
  if (!list) return `<div class="widget__empty"><div>${t('dashboard.personalListEmpty')}</div></div>`;
  return renderPersonalListBody(list, items);
}

function renderTasksWidget(personalLists, personalItems, span = '2', height = 'normal') {
  const activeTab = readWidgetActiveTab(personalLists);

  const personalTabs = personalLists.map((l) => {
    const isActive = activeTab === l.id;
    const isShared = !l.is_owner || l.has_shares;
    const pending = filterWidgetItems(personalItems.filter((i) => i.list_id === l.id)).length;
    const indicator = isShared
      ? `<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
             style="flex-shrink:0;pointer-events:none;color:var(--tab-color)">
           <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
           <circle cx="9" cy="7" r="4"/>
           <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
           <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
         </svg>`
      : '<span class="tasks-widget__tab-dot" aria-hidden="true"></span>';
    return `
      <button class="tasks-widget__tab ${isActive ? 'tasks-widget__tab--active' : ''}"
              data-action="switch-widget-tab" data-tab="${l.id}"
              style="--tab-color:${esc(l.color)}">
        ${indicator}
        <span>${esc(l.name)}</span>
        ${pending > 0 ? `<span class="tasks-widget__tab-count">${pending}</span>` : ''}
      </button>`;
  }).join('');

  const body = renderTasksWidgetBody(activeTab, personalLists, personalItems);
  const headerCount = filterWidgetItems(personalItems.filter((i) => i.list_id === activeTab)).length;

  return `<div class="widget ${widgetSpanClass(span)} ${widgetHeightClass(height)}" id="tasks-widget" data-widget-id="tasks-widget" data-widget-span="${span}" data-widget-height="${height}" data-active-tab="${activeTab}">
    ${widgetHeader('check-square', t('nav.tasks'), headerCount, '/tasks', undefined, '/tasks', 'tasks-create-new', { widgetId: 'tasks-widget', span, height })}
    <div class="tasks-widget__tabs-wrap">
      <button class="tasks-widget__tabs-arrow" data-action="tasks-tabs-scroll" data-dir="-1" aria-label="Scroll left" hidden>
        <i data-lucide="chevron-left" style="width:14px;height:14px" aria-hidden="true"></i>
      </button>
      <div class="tasks-widget__tabs" id="tasks-widget-tabs">
        ${personalTabs}
      </div>
      <button class="tasks-widget__tabs-arrow" data-action="tasks-tabs-scroll" data-dir="1" aria-label="Scroll right" hidden>
        <i data-lucide="chevron-right" style="width:14px;height:14px" aria-hidden="true"></i>
      </button>
    </div>
    <div class="widget__body" id="tasks-widget-body">${body}</div>
  </div>`;
}

function renderUpcomingEvents(events, span = '1', height = 'normal') {
  if (!events.length) {
    return `<div class="widget ${widgetSpanClass(span)} ${widgetHeightClass(height)}" id="events-widget" data-widget-id="events-widget" data-widget-span="${span}" data-widget-height="${height}">
      ${widgetHeader('calendar', t('nav.calendar'), 0, '/calendar', undefined, '/calendar', 'calendar-create-new', { widgetId: 'events-widget', span, height })}
      <div class="widget__empty">
        <i data-lucide="calendar-check" class="empty-state__icon" aria-hidden="true"></i>
        <div>${t('dashboard.noEvents')}</div>
      </div>
    </div>`;
  }

  const today = new Date().toDateString();
  const items = events.map((e) => {
    const d = new Date(e.start_datetime);
    const isToday = d.toDateString() === today;
    const _suffix = t('calendar.timeSuffix');
    const timeStr = e.all_day ? t('dashboard.allDay') : `${formatTime(d)}${_suffix ? ' ' + _suffix : ''}`.trim();
    const relLabel = eventRelativeLabel(e.start_datetime);
    return `
      <div class="event-item" data-route="/calendar" data-event-id="${e.id}" data-event-date="${e.start_datetime.slice(0, 10)}" role="button" tabindex="0">
        <div class="event-item__bar" style="background-color:${esc(e.color) || 'var(--color-accent)'}"></div>
        <div class="event-item__content">
          <div class="event-item__title">${esc(e.title)}</div>
          <div class="event-item__time">
            <span class="event-time-badge ${isToday ? 'event-time-badge--today' : ''}">${isToday ? t('common.today') : formatDateTime(e.start_datetime).split(',')[0]}</span>
            ${timeStr}
            ${relLabel ? ` · <span class="event-rel-label">${relLabel}</span>` : ''}
            ${e.location ? ` · ${esc(e.location)}` : ''}
          </div>
        </div>
        ${deleteBtnHtml('delete-event', `data-id="${e.id}" data-title="${esc(e.title)}"`, t('common.delete'))}
      </div>
    `;
  }).join('');

  return `<div class="widget ${widgetSpanClass(span)} ${widgetHeightClass(height)}" id="events-widget" data-widget-id="events-widget" data-widget-span="${span}" data-widget-height="${height}">
    ${widgetHeader('calendar', t('nav.calendar'), events.length, '/calendar', undefined, '/calendar', 'calendar-create-new', { widgetId: 'events-widget', span, height })}
    <div class="widget__body">${items}</div>
  </div>`;
}

function renderTodayMeals(meals) {
  const MEAL_ORDER = ['breakfast', 'lunch', 'dinner', 'snack'];

  const mealLabels = MEAL_LABELS();
  const slots = MEAL_ORDER.map((type) => {
    const meal = meals.find((m) => m.meal_type === type);
    return `
      <div class="meal-slot ${meal ? 'meal-slot--filled' : ''}" data-route="/meals" role="button" tabindex="0">
        <i data-lucide="${MEAL_ICONS[type]}" class="meal-slot__icon" aria-hidden="true"></i>
        <div class="meal-slot__type">${mealLabels[type]}</div>
        <div class="meal-slot__title">${meal ? esc(meal.title) : '-'}</div>
      </div>
    `;
  }).join('');

  return `<div class="widget widget--meals">
    ${widgetHeader('utensils', t('dashboard.todayMeals'), null, '/meals', t('dashboard.weekLink'), '/meals', 'meals-create-new')}
    <div class="meal-slots">${slots}</div>
  </div>`;
}

function renderBoardNote(note) {
  const title = note.title ? esc(note.title) : t('dashboard.pinnedNote');

  return `
    <article class="note-item dashboard-board-notes__card"
             data-action="open-board-note" data-note-id="${esc(note.id)}"
             role="button" tabindex="0" aria-label="${title}"
             style="--note-color:${esc(note.color)};">
      ${note.title ? `<div class="note-item__title">${esc(note.title)}</div>` : ''}
      <div class="note-item__content">${renderMarkdownLight(note.content)}</div>
    </article>
  `;
}

function renderBoardNotes(notes, span = 'full') {
  if (!notes.length) return '';
  return `
    <section class="dashboard__board-notes dashboard__board-notes--legacy" aria-label="Pinned notes">
      <div class="dashboard__board-notes-stack">
        ${notes.map((n) => renderBoardNote(n)).join('')}
      </div>
    </section>
  `;
}

function renderLegacyBoardNotes(notes) {
  if (!notes.length) return '';
  return `
    <section class="dashboard__board-notes dashboard__board-notes--legacy" aria-label="Pinned notes">
      <div class="dashboard__board-notes-stack">
        ${notes.map((n) => renderBoardNote(n)).join('')}
      </div>
    </section>
  `;
}

function updateBoardNotesSection(container, notes) {
  const existing = container.querySelector('.dashboard__board-notes--legacy');
  const html = renderLegacyBoardNotes(notes);
  if (!existing) {
    if (html) container.querySelector('.dashboard')?.insertAdjacentHTML('beforeend', html);
    return;
  }
  if (!html) {
    existing.remove();
    return;
  }
  existing.outerHTML = html;
}

const SHOPPING_COLLAPSE_AT = 6;

let _widgetActiveHeadId = null;

function renderShoppingWidget(heads, sublists, allItems, span = '2', height = 'normal') {
  const items = allItems.filter((i) => !i.is_checked);
  const totalUnchecked = heads.reduce((s, h) => s + (h.unchecked_count || 0), 0);

  if (!heads.length) {
    return `<div class="widget ${widgetSpanClass(span)} ${widgetHeightClass(height)}" id="shopping-widget" data-widget-id="shopping-widget" data-widget-span="${span}" data-widget-height="${height}">
      ${widgetHeader('list-checks', t('nav.lists'), 0, '/lists', undefined, '/lists', 'lists-create-new', { widgetId: 'shopping-widget', span, height })}
      <div class="widget__empty">
        <i data-lucide="list-checks" class="empty-state__icon" aria-hidden="true"></i>
        <div>${t('dashboard.noShoppingItems')}</div>
      </div>
    </div>`;
  }

  if (!heads.find((h) => h.id === _widgetActiveHeadId)) _widgetActiveHeadId = heads[0].id;
  const activeSubs = sublists.filter((s) => s.head_list_id === _widgetActiveHeadId && items.some((i) => i.list_id === s.id));

  const tabsHtml = `
    <div class="shopping-widget__head-wrap">
      <button class="shopping-widget__head-arrow" data-action="widget-head-scroll" data-dir="-1" aria-label="Scroll left" hidden>
        <i data-lucide="chevron-left" style="width:14px;height:14px" aria-hidden="true"></i>
      </button>
      <div class="shopping-widget__head-tabs" id="shopping-widget-head-tabs">
        ${heads.map((h) => `
          <button class="shopping-widget__head-tab ${h.id === _widgetActiveHeadId ? 'shopping-widget__head-tab--active' : ''}"
                  data-action="widget-switch-head" data-id="${h.id}">
            ${esc(h.name)}${h.unchecked_count > 0 ? ` <span class="shopping-widget__head-count">${h.unchecked_count}</span>` : ''}
          </button>`).join('')}
      </div>
      <button class="shopping-widget__head-arrow" data-action="widget-head-scroll" data-dir="1" aria-label="Scroll right" hidden>
        <i data-lucide="chevron-right" style="width:14px;height:14px" aria-hidden="true"></i>
      </button>
    </div>`;

  const renderSub = (sub) => {
    const subItems = items.filter((i) => i.list_id === sub.id);
    const visible  = subItems.slice(0, SHOPPING_COLLAPSE_AT);
    const hidden   = subItems.slice(SHOPPING_COLLAPSE_AT);

    const renderItem = (i) => `
      <div class="shopping-widget__item" data-item-id="${i.id}" data-list-id="${sub.id}">
        <button class="shopping-widget__check" data-action="check-item" data-id="${i.id}"
                aria-label="Mark ${esc(i.name)} as done">
          <i data-lucide="circle" style="width:14px;height:14px" aria-hidden="true"></i>
        </button>
        <span class="shopping-widget__item-name">${esc(i.name)}${i.quantity
          ? ` <span class="shopping-widget__qty">${esc(i.quantity)}</span>` : ''}</span>
        ${deleteBtnHtml('delete-shopping-item', `data-id="${i.id}"`, t('common.delete'))}
      </div>`;

    return `
      <div class="shopping-widget__list" data-list-id="${sub.id}">
        <div class="shopping-widget__list-header">
          <i data-lucide="grip-vertical" class="shopping-widget__drag-handle" aria-hidden="true" style="width:14px;height:14px;flex-shrink:0;cursor:grab;color:var(--color-text-tertiary);touch-action:none"></i>
          <div class="shopping-widget__list-name" data-route="/lists" data-head-id="${sub.head_list_id}" role="button" tabindex="0">
            ${esc(sub.name)}
            <span data-badge="${sub.id}" hidden>${sub.unchecked_count}</span>
          </div>
          ${deleteBtnHtml('delete-shopping-sublist', `data-id="${sub.id}" data-name="${esc(sub.name)}"`, t('common.delete'))}
        </div>
        <div class="shopping-widget__items">
          ${visible.map(renderItem).join('')}
          ${hidden.length ? `
            <div class="shopping-widget__overflow" hidden data-overflow="${sub.id}">
              ${hidden.map(renderItem).join('')}
            </div>
            <button class="shopping-widget__more" data-action="show-more" data-list-id="${sub.id}">
              +${hidden.length} more
            </button>` : ''}
        </div>
      </div>`;
  };

  const body = activeSubs.length
    ? activeSubs.map(renderSub).join('')
    : `<div class="widget__empty" style="padding:var(--space-4)">${t('dashboard.noShoppingItems')}</div>`;

  return `<div class="widget ${widgetSpanClass(span)} ${widgetHeightClass(height)}" id="shopping-widget" data-widget-id="shopping-widget" data-widget-span="${span}" data-widget-height="${height}">
    ${widgetHeader('list-checks', t('nav.lists'), totalUnchecked, '/lists', undefined, '/lists', 'lists-add-item', { widgetId: 'shopping-widget', span, height })}
    ${tabsHtml}
    <div class="widget__body" id="shopping-widget-body">${body}</div>
  </div>`;
}

// --------------------------------------------------------
// Wetter-Widget
// --------------------------------------------------------

const WEATHER_ICON_BASE = '/api/v1/weather/icon/';

function renderWeatherWidget(_weather) {
  return '';
}

// --------------------------------------------------------
// Quick Notes Widget (both modes server-synced; private is per-user)
// --------------------------------------------------------

const QN_MODE_KEY_BASE   = 'planium-quick-note-mode';
const QN_LEGACY_KEY_BASE = 'planium-quick-note-text';

function getQNMode() { return localStorage.getItem(dashboardStorageKey(QN_MODE_KEY_BASE)) === 'public' ? 'public' : 'private'; }

function renderQuickNotes(mode = 'private', span = '1', height = 'normal') {
  const isPublic = mode === 'public';
  return `
    <div class="widget ${widgetSpanClass(span)} ${widgetHeightClass(height)}" id="quick-notes-widget" data-widget-id="quick-notes-widget" data-widget-span="${span}" data-widget-height="${height}">
      <div class="widget__header">
        <span class="widget__title qn-expand-trigger" title="Click to expand" style="cursor:pointer">
          ${widgetDragHandle('quick-notes-widget')}
          <i data-lucide="sticky-note" class="widget__title-icon" aria-hidden="true"></i>
          ${t('dashboard.quickNotesTitle')}
        </span>
        <div class="widget__header-actions">
          ${widgetSizeButton('quick-notes-widget', span)}
          ${widgetHeightButton('quick-notes-widget', height)}
          <button class="btn btn--ghost btn--icon qn-mode-btn ${isPublic ? 'qn-mode-btn--active' : ''}"
                  title="${isPublic ? 'Switch to private note' : 'Switch to shared note (visible to all)'}">
            <i data-lucide="${isPublic ? 'globe' : 'lock'}" style="width:15px;height:15px;" aria-hidden="true"></i>
          </button>
        </div>
      </div>
      <div class="quick-notes__editor-wrap">
        <textarea class="quick-notes__editor" id="quick-notes-editor"
                  placeholder="${isPublic ? 'Shared note — visible to all household members…' : t('dashboard.quickNotePlaceholder')}"
                  spellcheck="true"></textarea>
      </div>
      ${isPublic ? `<div class="qn-mode-hint">
        <i data-lucide="globe" style="width:11px;height:11px;" aria-hidden="true"></i>
        Shared with all household members
      </div>` : ''}
    </div>
  `;
}

async function fetchQuickNote(mode) {
  try {
    const res = await api.get(dashboardApiPath(`/quick-note?scope=${mode}`));
    return res.data?.text ?? '';
  } catch { return ''; }
}

async function wireQuickNotes(container) {
  const widget = container.querySelector('#quick-notes-widget');
  if (!widget) return;
  const editor = widget.querySelector('#quick-notes-editor');
  if (!editor) return;

  const mode = getQNMode();
  let text = await fetchQuickNote(mode);

  // One-shot migration: upload any leftover browser-local private note so
  // users upgrading from the localStorage-only version don't lose content.
  const legacy = localStorage.getItem(dashboardStorageKey(QN_LEGACY_KEY_BASE));
  if (mode === 'private' && !text && legacy) {
    await api.put(dashboardApiPath('/quick-note?scope=private'), { text: legacy }).catch(() => {});
    text = legacy;
  }
  if (legacy != null) localStorage.removeItem(dashboardStorageKey(QN_LEGACY_KEY_BASE));
  editor.value = text;

  let _saveTimer = null;
  editor.addEventListener('input', () => {
    clearTimeout(_saveTimer);
    const scope = getQNMode();
    _saveTimer = setTimeout(() => {
      api.put(dashboardApiPath(`/quick-note?scope=${scope}`), { text: editor.value }).catch(console.error);
    }, 400);
  });

  const toggleBtn = widget.querySelector('.qn-mode-btn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', async () => {
      const newMode = getQNMode() === 'private' ? 'public' : 'private';
      localStorage.setItem(dashboardStorageKey(QN_MODE_KEY_BASE), newMode);
      const isPublic = newMode === 'public';

      // In-place updates — no outerHTML swap, no layout jerk
      toggleBtn.classList.toggle('qn-mode-btn--active', isPublic);
      toggleBtn.title = isPublic ? 'Switch to private note' : 'Switch to shared note (visible to all)';
      const icon = toggleBtn.querySelector('[data-lucide]');
      if (icon) {
        icon.setAttribute('data-lucide', isPublic ? 'globe' : 'lock');
        if (window.lucide) window.lucide.createIcons({ el: toggleBtn });
      }

      editor.placeholder = isPublic
        ? 'Shared note — visible to all household members…'
        : t('dashboard.quickNotePlaceholder');

      let hint = widget.querySelector('.qn-mode-hint');
      if (isPublic && !hint) {
        hint = document.createElement('div');
        hint.className = 'qn-mode-hint';
        hint.innerHTML = `<i data-lucide="globe" style="width:11px;height:11px;" aria-hidden="true"></i> Shared with all household members`;
        widget.appendChild(hint);
        if (window.lucide) window.lucide.createIcons({ el: hint });
      } else if (!isPublic && hint) {
        hint.remove();
      }

      editor.value = await fetchQuickNote(newMode);
    });
  }

  // Expand to large dialog on desktop only
  const expandTrigger = widget.querySelector('.qn-expand-trigger');
  if (expandTrigger) {
    expandTrigger.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="drag-widget"], [data-action="cycle-widget-span"]')) return;
      if (window.innerWidth < 768) return;
      openModal({
        title: t('dashboard.quickNotesTitle'),
        size: 'notes',
        content: `<textarea id="qn-dialog-editor" style="flex:1;min-height:0;width:100%;resize:none;box-sizing:border-box;font-family:inherit;font-size:var(--text-sm);line-height:1.6"
                            class="quick-notes__editor" spellcheck="true"
                            placeholder="${editor.placeholder}"></textarea>`,
        onSave: (panel) => {
          const dialogEditor = panel.querySelector('#qn-dialog-editor');
          dialogEditor.value = editor.value;
          dialogEditor.focus();
          let _dialogSaveTimer = null;
          dialogEditor.addEventListener('input', () => {
            editor.value = dialogEditor.value;
            clearTimeout(_dialogSaveTimer);
            const scope = getQNMode();
            _dialogSaveTimer = setTimeout(() => {
              api.put(dashboardApiPath(`/quick-note?scope=${scope}`), { text: dialogEditor.value }).catch(console.error);
            }, 400);
          });
        },
      });
    });
  }
}

// --------------------------------------------------------
// Quote of the Day Widget
// --------------------------------------------------------

const QUOTE_LS_KEY   = 'planium-show-quotes';
const NEWS_LS_KEY    = 'planium-show-news';
const TICKERS_LS_KEY = 'planium-show-tickers';

function isQuoteEnabled() {
  return localStorage.getItem(QUOTE_LS_KEY) === 'true';
}

function isNewsEnabled() {
  return localStorage.getItem(NEWS_LS_KEY) === 'true';
}

function isTickersEnabled() {
  return localStorage.getItem(TICKERS_LS_KEY) === 'true';
}

function renderQuoteWidget(quote, span = 'full', height = 'normal') {
  if (!quote || !isQuoteEnabled()) return '';
  const quoteText = String(quote.quote ?? '').trim();
  const author = quote.author ? `<span class="quote-widget__author">\u2014 ${esc(quote.author)}</span>` : '';
  const compact = height === 'xxs' || height === 'xs' || height === 'short';
  if (isDashboardTestVariant()) {
    const authorHtml = quote.author
      ? `<div style="margin-top:6px;font-size:11px;line-height:1.2;color:var(--color-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">— ${esc(quote.author)}</div>`
      : '';
    const bodyStyle = compact
      ? 'display:flex;flex-direction:column;gap:4px;align-items:flex-start;justify-content:flex-start;min-height:0;padding:6px 16px 10px;overflow:hidden;'
      : 'display:flex;flex-direction:column;gap:6px;align-items:flex-start;justify-content:flex-start;min-height:0;padding:10px 16px 12px;overflow:hidden;';
    const textStyle = compact
      ? 'margin:0;font-size:13px;line-height:1.35;color:var(--color-text-primary);font-style:italic;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;'
      : 'margin:0;font-size:14px;line-height:1.45;color:var(--color-text-primary);font-style:italic;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;';
    return `
      <div class="widget quote-widget ${widgetSpanClass(span)} ${widgetHeightClass(height)}"
           id="quote-widget" data-widget-id="quote-widget" data-widget-span="${span}" data-widget-height="${height}">
        ${widgetHeader(null, t('dashboard.quoteOfTheDay'), null, null, null, null, null, { widgetId: 'quote-widget', span })}
        <div class="widget__body quote-widget__body" style="${bodyStyle}">
          <div style="display:flex;align-items:flex-start;gap:8px;min-width:0;width:100%;">
            <i data-lucide="quote" class="quote-widget__icon" aria-hidden="true" style="flex:0 0 auto;width:${compact ? 14 : 18}px;height:${compact ? 14 : 18}px;margin-top:2px;"></i>
            <div class="quote-widget__content" style="display:flex;flex-direction:column;gap:4px;min-width:0;flex:1 1 auto;">
              <div class="quote-widget__copy" style="${textStyle}">${esc(quoteText)}</div>
              ${authorHtml ? `<div style="display:block;padding-left:18px;">${authorHtml}</div>` : ''}
            </div>
          </div>
        </div>
      </div>`;
  }
  return `
    <div class="widget quote-widget ${widgetSpanClass(span)} ${widgetHeightClass(height)}${compact ? ' quote-widget--compact' : ''}"
         id="quote-widget" data-widget-id="quote-widget" data-widget-span="${span}" data-widget-height="${height}">
      ${widgetHeader(null, t('dashboard.quoteOfTheDay'), null, null, null, null, null, { widgetId: 'quote-widget', span })}
      <div class="widget__body quote-widget__body${compact ? ' quote-widget__body--compact' : ''}">
        <i data-lucide="quote" class="quote-widget__icon" aria-hidden="true"></i>
        <div class="quote-widget__content">
          <blockquote class="quote-widget__text">${esc(quoteText)}</blockquote>
          ${author}
        </div>
      </div>
    </div>`;
}

function scheduleMidnightQuoteRefresh(container, signal) {
  if (!isQuoteEnabled()) return;
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const msUntilMidnight = midnight - now;

  const timerId = setTimeout(async () => {
    if (signal.aborted) return;
    try {
      const fresh = await api.get('/quotes/today').catch(() => null);
      const el = container.querySelector('#quote-widget');
      if (el && fresh) {
        el.outerHTML = renderQuoteWidget(
          fresh,
          el.dataset.widgetSpan || 'full',
          el.dataset.widgetHeight || 'normal',
        );
        const newEl = container.querySelector('#quote-widget');
        if (newEl && window.lucide) window.lucide.createIcons({ el: newEl });
      }
    } catch { /* non-critical */ }
  }, msUntilMidnight);

  signal.addEventListener('abort', () => clearTimeout(timerId));
}

function wireDashboardLayout(container, layoutState, data) {
  const grid = container.querySelector('.dashboard__grid');
  if (!grid) return;

  const desktopQuery = window.matchMedia('(min-width: 1024px)');
  const isEditMode = () => container.querySelector('.dashboard')?.classList.contains('dashboard--edit-mode');
  let dragging = null;
  let dragPtrId = null;
  let didDrag = false;
  let startX = 0;
  let startY = 0;

  const widgetNodes = () => [...grid.querySelectorAll('.widget[data-widget-id]')];
  const widgetOrder = () => widgetNodes().map((el) => el.dataset.widgetId).filter(Boolean);
  const canEditLayout = () => desktopQuery.matches && (isEditMode() || isDashboardTestVariant());

  let masonryRaf = 0;
  const syncWidgetMasonry = () => {
    if (!isDashboardTestVariant()) return;
    masonryRaf = 0;
    const widgets = widgetNodes();
    if (!desktopQuery.matches) {
      widgets.forEach((widget) => {
        widget.style.gridColumn = '';
        widget.style.gridRow = '';
      });
      return;
    }

    const occupied = [];
    const ensureRows = (rowCount) => {
      while (occupied.length < rowCount) {
        occupied.push(Array(TEST_BOARD_COLUMN_COUNT).fill(false));
      }
    };
    const canPlace = (rowIndex, colIndex, colSpan, rowSpan) => {
      ensureRows(rowIndex + rowSpan);
      for (let r = rowIndex; r < rowIndex + rowSpan; r += 1) {
        for (let c = colIndex; c < colIndex + colSpan; c += 1) {
          if (occupied[r][c]) return false;
        }
      }
      return true;
    };
    const occupy = (rowIndex, colIndex, colSpan, rowSpan) => {
      ensureRows(rowIndex + rowSpan);
      for (let r = rowIndex; r < rowIndex + rowSpan; r += 1) {
        for (let c = colIndex; c < colIndex + colSpan; c += 1) {
          occupied[r][c] = true;
        }
      }
    };

    widgets.forEach((widget) => {
      widget.style.gridColumn = '';
      widget.style.gridRow = '';
    });

    widgets.forEach((widget) => {
      if (!widget.isConnected) return;
      const span = widget.dataset.widgetSpan || '1';
      const height = widget.dataset.widgetHeight || 'normal';
      const colSpan = TEST_BOARD_SPAN_WIDTHS[span] ?? 4;
      const rowSpan = TEST_BOARD_SPAN_ROWS[height] ?? 3;
      let placed = false;

      for (let rowIndex = 0; !placed; rowIndex += 1) {
        for (let colIndex = 0; colIndex <= TEST_BOARD_COLUMN_COUNT - colSpan; colIndex += 1) {
          if (!canPlace(rowIndex, colIndex, colSpan, rowSpan)) continue;
          occupy(rowIndex, colIndex, colSpan, rowSpan);
          widget.style.gridColumn = `${colIndex + 1} / span ${colSpan}`;
          widget.style.gridRow = `${rowIndex + 1} / span ${rowSpan}`;
          placed = true;
          break;
        }
      }
    });
  };

  const scheduleWidgetMasonry = () => {
    if (!isDashboardTestVariant()) return;
    window.cancelAnimationFrame(masonryRaf);
    masonryRaf = window.requestAnimationFrame(syncWidgetMasonry);
  };

  const applyOrder = (order) => {
    const nodeById = new Map(widgetNodes().map((el) => [el.dataset.widgetId, el]));
    for (const id of order) {
      const node = nodeById.get(id);
      if (node) grid.appendChild(node);
    }
  };

  let saveTimer = null;
  const saveLayout = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      api.put(dashboardApiPath('/layout'), { layout: stripDashboardLayoutVisibility(layoutState) }).catch((err) => {
        window.planium?.showToast(err.message, 'danger');
      });
    }, 120);
  };

  container.addEventListener('click', (e) => {
    const openNote = e.target.closest('[data-action="open-board-note"]');
    if (openNote) {
      e.preventDefault();
      e.stopPropagation();
      if (e.target.closest('[data-action="drag-widget"]')) return;
      const noteId = Number(openNote.dataset.noteId);
      const note = (data.pinnedNotes ?? []).find((n) => n.id === noteId);
      if (note) {
        openNote.blur?.();
        openNotePreviewModal({
          note,
          onSaved: (savedNote) => {
            const idx = (data.pinnedNotes ?? []).findIndex((n) => n.id === note.id);
            if (idx !== -1) data.pinnedNotes[idx] = savedNote;
            updateBoardNotesSection(container, data.pinnedNotes ?? []);
          },
        });
      }
      return;
    }

    const heightBtn = e.target.closest('[data-action="cycle-widget-height"]');
    if (heightBtn) {
      e.preventDefault();
      e.stopPropagation();
      if (!canEditLayout()) return;
      const widgetId = heightBtn.dataset.widgetId;
      const widget = container.querySelector(`[data-widget-id="${widgetId}"]`);
      if (!widget) return;
      const current = widget.dataset.widgetHeight || 'normal';
      const next = nextDashboardWidgetHeight(current);
      const nextLabel = dashboardWidgetHeightLabel(next);
      layoutState.heights[widgetId] = next;
      widget.dataset.widgetHeight = next;
      widget.classList.remove(
        'widget-layout--height-xs',
        'widget-layout--height-short',
        'widget-layout--height-normal',
        'widget-layout--height-tall',
        'widget-layout--height-xlarge',
      );
      widget.classList.add(widgetHeightClass(next));
      heightBtn.querySelector('.widget__height-btn-label').textContent = dashboardWidgetHeightLabel(next);
      heightBtn.setAttribute('aria-label', `Resize widget height to ${nextLabel}`);
      scheduleWidgetMasonry();
      saveLayout();
      return;
    }

    const sizeBtn = e.target.closest('[data-action="cycle-widget-span"]');
    if (!sizeBtn) return;
    e.preventDefault();
    e.stopPropagation();
    if (!canEditLayout()) return;
    const widgetId = sizeBtn.dataset.widgetId;
    const widget = container.querySelector(`[data-widget-id="${widgetId}"]`);
    if (!widget) return;
    const current = widget.dataset.widgetSpan || '1';
    const next = nextWidgetSpan(current);
    layoutState.spans[widgetId] = next;
    widget.dataset.widgetSpan = next;
    widget.classList.remove('widget-layout--span-1', 'widget-layout--span-2', 'widget-layout--span-full');
    widget.classList.add(widgetSpanClass(next));
    sizeBtn.querySelector('.widget__size-btn-label').textContent = next === 'full' ? 'Full' : next;
    sizeBtn.setAttribute('aria-label', `Resize widget to ${next === 'full' ? 'full width' : `${next} column${next === '1' ? '' : 's'}`}`);
    scheduleWidgetMasonry();
    saveLayout();
  });

  grid.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('[data-action="drag-widget"]');
    if (!handle || !desktopQuery.matches || e.pointerType === 'touch' || !isEditMode()) return;
    const widget = handle.closest('.widget[data-widget-id]');
    if (!widget) return;
    dragging = widget;
    dragPtrId = e.pointerId;
    didDrag = false;
    startX = e.clientX;
    startY = e.clientY;
    try { handle.setPointerCapture(e.pointerId); } catch {}
  });

  grid.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== dragPtrId || !desktopQuery.matches || !isEditMode()) return;
    const dx = e.clientX - startX;
    const dy = Math.abs(e.clientY - startY);
    if (!didDrag) {
      if (Math.max(Math.abs(dx), dy) < 8) return;
      didDrag = true;
      dragging.classList.add('widget--dragging');
      grid.classList.add('dashboard__grid--dragging');
      try { grid.setPointerCapture(e.pointerId); } catch {}
    }

    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.widget[data-widget-id]');
    if (!over || over === dragging) return;
    const widgets = widgetNodes();
    const dragIdx = widgets.indexOf(dragging);
    const overIdx = widgets.indexOf(over);
    if (dragIdx === -1 || overIdx === -1) return;

    const overRect = over.getBoundingClientRect();
    const insertAfter = e.clientY > overRect.top + (overRect.height / 2);
    if (dragIdx < overIdx) {
      if (insertAfter) over.after(dragging); else over.before(dragging);
    } else if (insertAfter) {
      over.after(dragging);
    } else {
      over.before(dragging);
    }
  });

  const finishDrag = async () => {
    if (!dragging || !desktopQuery.matches || !isEditMode()) return;
    const wasDragged = didDrag;
    const oldOrder = layoutState.order.slice();
    dragging.classList.remove('widget--dragging');
    grid.classList.remove('dashboard__grid--dragging');
    const visibleOrder = widgetOrder();
    const hiddenOrder = layoutState.order.filter((id) => !visibleOrder.includes(id));
    const newOrder = [...hiddenOrder, ...visibleOrder];
    dragging = null;
    dragPtrId = null;
    didDrag = false;
    if (!wasDragged) return;
    if (JSON.stringify(newOrder) === JSON.stringify(oldOrder)) return;
    layoutState.order = newOrder;
    try {
      await api.put(dashboardApiPath('/layout'), { layout: stripDashboardLayoutVisibility(layoutState) });
    } catch (err) {
      layoutState.order = oldOrder;
      applyOrder(oldOrder);
      window.planium?.showToast(err.message, 'danger');
    }
  };

  grid.addEventListener('pointerup', finishDrag);
  grid.addEventListener('pointercancel', () => {
    if (!dragging) return;
    dragging.classList.remove('widget--dragging');
    grid.classList.remove('dashboard__grid--dragging');
    dragging = null;
    dragPtrId = null;
    didDrag = false;
  });

  window.addEventListener('resize', scheduleWidgetMasonry, { signal: _fabController.signal });
  scheduleWidgetMasonry();
}

function wireDashboardTestBoard(container, boardState, widgetIds) {
  const board = container.querySelector('#dashboard-test-board');
  if (!board) return;

  const desktopQuery = window.matchMedia('(min-width: 1024px)');
  const isEditMode = () => container.querySelector('.dashboard')?.classList.contains('dashboard--edit-mode');
  const canInteract = () => isEditMode() && (desktopQuery.matches || isDashboardTestVariant());
  const slotsById = new Map(
    [...board.querySelectorAll('.dashboard-test-board__slot')].map((slot) => [slot.dataset.boardWidgetId, slot])
  );

  const applyRects = (rects) => {
    const metrics = dashboardTestBoardCellSize(board);
    let maxBottom = 0;
    for (const id of widgetIds) {
      const slot = slotsById.get(id);
      const rect = rects[id];
      if (!slot || !rect) continue;
      const pixels = dashboardTestBoardRectToPixels(rect, metrics);
      slot.style.left = pixels.left;
      slot.style.top = pixels.top;
      slot.style.width = pixels.width;
      slot.style.height = pixels.height;
      maxBottom = Math.max(maxBottom, parseFloat(pixels.top) + parseFloat(pixels.height));
    }
    board.style.height = `${Math.max(maxBottom, 1)}px`;
    board.classList.remove('dashboard__test-board--pending');
  };

  const commitRects = (activeId = null) => {
    boardState.rects = packDashboardTestBoardRects(boardState.rects, widgetIds, activeId);
    boardState.order = sortDashboardTestBoardOrder(boardState.rects, widgetIds);
    applyRects(boardState.rects);
    saveDashboardTestBoardState(boardState);
  };

  let interaction = null;

  const endInteraction = () => {
    if (!interaction) return;
    const { id, rect } = interaction;
    boardState.rects[id] = normalizeDashboardTestBoardRect(rect, boardState.rects[id]);
    commitRects(id);
    interaction = null;
    board.classList.remove('dashboard__test-board--dragging');
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endInteraction);
    window.removeEventListener('pointercancel', endInteraction);
  };

  const onPointerMove = (event) => {
    if (!interaction || event.pointerId !== interaction.pointerId) return;
    const { colWidth, rowHeight, columnGap, rowGap } = interaction.metrics;
    const cellX = Math.round((event.clientX - interaction.startX) / (colWidth + columnGap));
    const cellY = Math.round((event.clientY - interaction.startY) / (rowHeight + rowGap));
    const base = interaction.startRect;
    let next = { ...base };

    if (interaction.type === 'move') {
      next.x = base.x + cellX;
      next.y = base.y + cellY;
    } else {
      const dir = interaction.dir;
      if (dir.includes('e')) next.w = base.w + cellX;
      if (dir.includes('s')) next.h = base.h + cellY;
      if (dir.includes('w')) {
        next.x = base.x + cellX;
        next.w = base.w - cellX;
      }
      if (dir.includes('n')) {
        next.y = base.y + cellY;
        next.h = base.h - cellY;
      }
    }

    next = normalizeDashboardTestBoardRect(next, base);
    interaction.rect = next;
    const slot = slotsById.get(interaction.id);
    if (slot) {
      const pixels = dashboardTestBoardRectToPixels(next, interaction.metrics);
      slot.style.left = pixels.left;
      slot.style.top = pixels.top;
      slot.style.width = pixels.width;
      slot.style.height = pixels.height;
    }
  };

  const beginInteraction = (event, type, dir = null) => {
    if (!canInteract()) return;
    const slot = event.target.closest('.dashboard-test-board__slot');
    if (!slot) return;
    const id = slot.dataset.boardWidgetId;
    const startRect = boardState.rects[id];
    if (!startRect) return;
    interaction = {
      id,
      type,
      dir,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startRect: { ...startRect },
      rect: { ...startRect },
      metrics: dashboardTestBoardCellSize(board),
    };
    board.classList.add('dashboard__test-board--dragging');
    try { event.target.setPointerCapture(event.pointerId); } catch {}
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endInteraction, { once: true });
    window.addEventListener('pointercancel', endInteraction, { once: true });
  };

  board.addEventListener('pointerdown', (event) => {
    if (!canInteract()) return;
    const resizeHandle = event.target.closest('[data-action="test-resize"]');
    if (resizeHandle) {
      event.preventDefault();
      beginInteraction(event, 'resize', resizeHandle.dataset.dir);
      return;
    }

    const moveHandle = event.target.closest('.widget__drag-handle');
    if (!moveHandle) return;
    if (!moveHandle.closest('.dashboard-test-board__slot')) return;
    event.preventDefault();
    beginInteraction(event, 'move');
  });

  window.addEventListener('resize', () => {
    commitRects();
  }, { signal: _fabController.signal });

  applyRects(boardState.rects);
}

// --------------------------------------------------------
// FAB Speed-Dial
// --------------------------------------------------------

const FAB_ACTIONS = (user) => [
  { route: '/tasks',    label: t('dashboard.fabTask'),     icon: 'check-square'   },
  { route: '/calendar', label: t('dashboard.fabCalendar'), icon: 'calendar-plus'  },
  { route: '/lists', label: t('dashboard.fabShopping'), icon: 'shopping-cart'  },
  { action: 'create-note', label: t('dashboard.fabNote'), icon: 'sticky-note'    },
];

function renderFab(user) {
  const actionsHtml = FAB_ACTIONS(user).map((a) => `
    <div class="fab-action" ${a.route ? `data-route="${a.route}"` : `data-action="${a.action}"`} role="button" tabindex="-1"
         aria-label="${a.label}">
      <span class="fab-action__label">${a.label}</span>
      <button class="fab-action__btn" tabindex="-1" aria-hidden="true">
        <i data-lucide="${a.icon}" aria-hidden="true"></i>
      </button>
    </div>
  `).join('');

  return `
    <div class="fab-container" id="fab-container">
      <button class="fab-main" id="fab-main" aria-label="${t('nav.quickActions')}" aria-expanded="false">
        <i data-lucide="plus" aria-hidden="true"></i>
      </button>
      <button class="fab-settings" id="fab-settings" type="button" aria-label="${t('settings.dashboardWidgetsTitle')}" title="${t('settings.dashboardWidgetsTitle')}">
        <i data-lucide="settings" aria-hidden="true"></i>
      </button>
      <button class="fab-settings fab-edit-toggle" id="fab-edit-mode" type="button"
              aria-label="Edit widgets" aria-pressed="${isDashboardEditModeEnabled() ? 'true' : 'false'}"
              title="Edit widgets">
        <i data-lucide="pencil" aria-hidden="true"></i>
      </button>
      <div class="fab-actions" id="fab-actions" aria-hidden="true">
        ${actionsHtml}
      </div>
    </div>
  `;
}

function initFab(container, signal, user, onNoteSaved = null) {
  const fabMain    = container.querySelector('#fab-main');
  const fabActions = container.querySelector('#fab-actions');
  const fabEdit    = container.querySelector('#fab-edit-mode');
  if (!fabMain) return;

  let open = false;

  function toggleFab(force) {
    open = force !== undefined ? force : !open;
    fabMain.classList.toggle('fab-main--open', open);
    fabMain.setAttribute('aria-expanded', String(open));
    fabActions.classList.toggle('fab-actions--visible', open);
    fabActions.setAttribute('aria-hidden', String(!open));
    fabActions.querySelectorAll('[role="button"]').forEach((el) => {
      el.tabIndex = open ? 0 : -1;
    });
    if (window.lucide) window.lucide.createIcons();
  }

  fabMain.addEventListener('click', (e) => { e.stopPropagation(); toggleFab(); });

  if (fabEdit) {
    fabEdit.addEventListener('click', (e) => {
      e.stopPropagation();
      const enabled = !container.querySelector('.dashboard')?.classList.contains('dashboard--edit-mode');
      setDashboardEditMode(container, enabled);
    });
  }

  const FAB_CREATE_FLAGS = {
    '/tasks':    'tasks-create-new',
    '/calendar': 'calendar-create-new',
    '/notes':    'notes-create-new',
    '/lists': 'lists-add-item',
  };

  fabActions.querySelectorAll('[data-route]').forEach((el) => {
    const go = () => {
      toggleFab(false);
      const flag = FAB_CREATE_FLAGS[el.dataset.route];
      if (flag) localStorage.setItem(flag, '1');
      window.planium.navigate(el.dataset.route);
    };
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  });

  fabActions.querySelectorAll('[data-action="create-note"]').forEach((el) => {
    const go = () => {
      toggleFab(false);
      openNoteModal({
        mode: 'create',
        onSaved: onNoteSaved,
      });
    };
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  });

  document.addEventListener('click', () => { if (open) toggleFab(false); }, { signal });
}

// --------------------------------------------------------
// Navigations-Links verdrahten
// --------------------------------------------------------

function wireLinks(container) {
  container.querySelectorAll('[data-route]').forEach((el) => {
    if (el.id === 'fab-main' || el.closest('#fab-actions')) return;
    if (el.classList.contains('widget__add-btn') && el.closest('#tasks-widget')) return;
    const go = () => {
      // Widget + button → set create flag then navigate
      if (el.dataset.createFlag) {
        localStorage.setItem(el.dataset.createFlag, '1');
        window.planium.navigate(el.dataset.route);
        return;
      }
      // Tasks "All" link → open kanban view
      if (el.dataset.route === '/tasks' && el.classList.contains('widget__link')) {
        localStorage.setItem('tasks-view', 'kanban');
      }
      // Calendar event item → open that specific event on arrival
      if (el.dataset.eventId) {
        localStorage.setItem('calendar-open-event', JSON.stringify({
          id:   parseInt(el.dataset.eventId, 10),
          date: el.dataset.eventDate,
        }));
      }
      // Task item → open that specific task on arrival
      if (el.dataset.taskId) {
        localStorage.setItem('tasks-open-task', el.dataset.taskId);
      }
      // Personal-list shortcut → switch tasks page to that list tab on arrival
      if (el.dataset.personalListId) {
        localStorage.setItem('tasks-active-tab', el.dataset.personalListId);
      }
      // Shopping list name → open that specific list on arrival
      if (el.dataset.listId) {
        localStorage.setItem('lists-open-list', el.dataset.listId);
      }
      window.planium.navigate(el.dataset.route);
    };
    if (el.tagName === 'A') {
      el.addEventListener('click', (e) => { e.preventDefault(); go(); });
    } else {
      el.addEventListener('click', (e) => { if (e.target.closest('a[href]')) return; go(); });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      });
    }
  });
}

function wireTasksWidgetBody(root, dashData, refreshWidget) {
  // Personal item delete
  root.querySelectorAll('[data-action="delete-personal-widget-item"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await showConfirm(t('tasks.deleteItemConfirm') ?? 'Delete this item?',
        { danger: true });
      if (!ok) return;
      const listId = Number(btn.dataset.listId);
      const itemId = Number(btn.dataset.itemId);
      const itemEl = btn.closest('.personal-widget-item');
      itemEl.classList.add('personal-widget-item--checking');
      setTimeout(() => itemEl.remove(), 250);
      try {
        await api.delete(`/personal-lists/${listId}/items/${itemId}`);
        dashData.personalItems = (dashData.personalItems || []).filter((i) => i.id !== itemId);
      } catch {
        window.planium?.showToast('Could not delete item', 'danger');
        refreshWidget();
      }
    });
  });

  // Personal item: open edit dialog
  const openPersonalItemEdit = (itemId, listId) => {
    const item = (dashData.personalItems || []).find((i) => i.id === itemId);
    if (!item) return;
    openItemEditDialog({
      item,
      container: root,
      listId,
      onSaved: (updated) => {
        const idx = dashData.personalItems.findIndex((i) => i.id === itemId);
        if (idx >= 0) dashData.personalItems[idx] = { ...dashData.personalItems[idx], ...updated };
        refreshWidget();
      },
      onDeleted: () => {
        dashData.personalItems = (dashData.personalItems || []).filter((i) => i.id !== itemId);
        refreshWidget();
      },
    });
  };

  // Personal item: open edit dialog on item click
  root.querySelectorAll('[data-action="open-personal-widget-item"]').forEach((item) => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('a[href]')) return; // don't open if clicked on a link
      if (e.target.closest('button, input, textarea, select, [contenteditable="true"]')) return;
      if (selectionIsInsideElement(item)) return;
      e.stopPropagation();
      const listId = Number(item.dataset.listId);
      const itemId = Number(item.dataset.itemId);
      openPersonalItemEdit(itemId, listId);
    });
  });

  root.querySelectorAll('[data-action="edit-personal-widget-item"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const listId = Number(btn.dataset.listId);
      const itemId = Number(btn.dataset.itemId);
      openPersonalItemEdit(itemId, listId);
    });
  });

  // Personal item: view/edit note in floating panel
  root.querySelectorAll('[data-action="view-personal-widget-item-note"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const itemId = Number(btn.dataset.itemId);
      const item = (dashData.personalItems || []).find((i) => i.id === itemId);
      if (!item) return;

      document.getElementById('item-note-panel')?.remove();
      const panel = document.createElement('div');
      panel.id = 'item-note-panel';
      panel.innerHTML = `
        <div class="item-note-panel__backdrop"></div>
        <div class="item-note-panel__card" role="dialog" aria-label="${esc(item.title)}">
          <div class="item-note-panel__header">
            <span class="item-note-panel__title">${esc(item.title)}</span>
            <button class="item-note-panel__close" aria-label="Close">
              <i data-lucide="x" style="width:16px;height:16px;pointer-events:none" aria-hidden="true"></i>
            </button>
          </div>
          <textarea class="item-note-panel__textarea" placeholder="Add a note...">${esc(item.description || '')}</textarea>
          <div class="item-note-panel__footer">
            <button class="btn btn--primary item-note-panel__save" style="min-height:36px;padding:0 var(--space-4)">Save</button>
          </div>
        </div>`;
      document.body.appendChild(panel);
      if (window.lucide) window.lucide.createIcons({ el: panel });

      const textarea = panel.querySelector('.item-note-panel__textarea');
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);

      const close = () => panel.remove();
      const saveBtn = panel.querySelector('.item-note-panel__save');
      panel.querySelector('.item-note-panel__backdrop').addEventListener('click', close);
      panel.querySelector('.item-note-panel__close').addEventListener('click', close);
      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        try {
          const description = textarea.value || null;
          const res = await api.patch(`/personal-lists/${item.list_id}/items/${itemId}`, { description });
          const idx = dashData.personalItems.findIndex((i) => i.id === itemId);
          if (idx >= 0) dashData.personalItems[idx] = { ...dashData.personalItems[idx], ...res.data };
          close();
          refreshWidget();
        } catch {
          saveBtn.disabled = false;
        }
      });
    });
  });

  // Personal item: cycle status and refresh after the server accepts it.
  root.querySelectorAll('[data-action="toggle-personal-widget-item"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const listId = Number(btn.dataset.listId);
      const itemId = Number(btn.dataset.itemId);
      const item = (dashData.personalItems || []).find((i) => i.id === itemId);
      if (!item) return;
      const currentStatus = getPersonalWidgetItemStatus(item);
      const nextStatus = btn.dataset.nextStatus || PERSONAL_WIDGET_STATUS_CYCLE[currentStatus] || 'open';
      if (currentStatus === nextStatus) return;
      const willBeDone = nextStatus === 'done';
      const list = (dashData.personalLists || []).find((l) => l.id === listId);
      setPersonalWidgetItemStatus(item, nextStatus);
      try {
        const res = await api.patch(`/personal-lists/${listId}/items/${itemId}`, { status: nextStatus });
        const updated = res.data?.data ?? res.data ?? null;
        if (updated) {
          const idx = (dashData.personalItems || []).findIndex((i) => i.id === itemId);
          if (idx >= 0) dashData.personalItems[idx] = { ...dashData.personalItems[idx], ...updated };
        }
        const finalStatus = getPersonalWidgetItemStatus(updated ?? item);
        if (list && willBeDone !== (finalStatus === 'done')) {
          list.pending_count += willBeDone ? 1 : -1;
        }
        refreshWidget();
        broadcastPersonalItemChange({
          source: PERSONAL_ITEM_SYNC_SOURCE,
          listId,
          itemId,
          previousStatus: currentStatus,
          nextStatus: finalStatus,
          item: updated ?? item,
        });
      } catch (err) {
        setPersonalWidgetItemStatus(item, currentStatus);
        refreshWidget();
        window.planium?.showToast(err?.data?.error ?? err?.message ?? 'Could not update item', 'danger');
      }
    });
  });

  // Personal item: add via inline form (Enter submits, focus stays on input)
  root.querySelectorAll('[data-action="add-personal-widget-item"]').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = form.querySelector('.personal-widget-add__input');
      const title = (input?.value ?? '').trim();
      if (!title) return;
      const listId = Number(form.dataset.listId);
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      try {
        const res = await api.post(`/personal-lists/${listId}/items`, { title });
        if (res?.data) {
          dashData.personalItems = [...(dashData.personalItems || []), res.data];
        }
        input.value = '';
        refreshWidget();
        // After re-render, refocus the new input for the same list so Enter-Enter chains
        const fresh = root.ownerDocument.querySelector(
          `[data-action="add-personal-widget-item"][data-list-id="${listId}"] .personal-widget-add__input`
        );
        fresh?.focus();
      } catch {
        window.planium?.showToast('Could not add item', 'danger');
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  });
}

function ensureActiveTabVisible(tabsEl, smooth = false) {
  if (!tabsEl) return;
  const active = tabsEl.querySelector('.tasks-widget__tab--active');
  if (!active) return;
  const pad = 12;
  const tabLeft  = active.offsetLeft;
  const tabRight = tabLeft + active.offsetWidth;
  const viewLeft = tabsEl.scrollLeft;
  const viewRight = viewLeft + tabsEl.clientWidth;
  let target = viewLeft;
  if (tabLeft < viewLeft + pad) {
    target = Math.max(0, tabLeft - pad);
  } else if (tabRight > viewRight - pad) {
    target = tabRight - tabsEl.clientWidth + pad;
  } else {
    return;
  }
  const maxScroll = tabsEl.scrollWidth - tabsEl.clientWidth;
  target = Math.max(0, Math.min(maxScroll, target));
  if (Math.abs(target - tabsEl.scrollLeft) < 1) return;
  tabsEl.scrollTo({ left: target, behavior: smooth ? 'smooth' : 'auto' });
}

function ensureActiveShoppingTabVisible(tabsEl, smooth = false) {
  if (!tabsEl) return;
  const active = tabsEl.querySelector('.shopping-widget__head-tab--active');
  if (!active) return;
  const pad = 12;
  const tabLeft  = active.offsetLeft;
  const tabRight = tabLeft + active.offsetWidth;
  const viewLeft = tabsEl.scrollLeft;
  const viewRight = viewLeft + tabsEl.clientWidth;
  let target = viewLeft;
  if (tabLeft < viewLeft + pad) {
    target = Math.max(0, tabLeft - pad);
  } else if (tabRight > viewRight - pad) {
    target = tabRight - tabsEl.clientWidth + pad;
  } else {
    return;
  }
  const maxScroll = tabsEl.scrollWidth - tabsEl.clientWidth;
  target = Math.max(0, Math.min(maxScroll, target));
  if (Math.abs(target - tabsEl.scrollLeft) < 1) return;
  tabsEl.scrollTo({ left: target, behavior: smooth ? 'smooth' : 'auto' });
}

function wireScrollClickGuard(scrollEl) {
  if (!scrollEl) return;
  let startX = 0;
  let startY = 0;
  let moved = false;
  let suppressUntil = 0;

  scrollEl.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    moved = false;
  }, { passive: true });

  scrollEl.addEventListener('touchmove', (e) => {
    if (!e.touches.length) return;
    const dx = Math.abs(e.touches[0].clientX - startX);
    const dy = Math.abs(e.touches[0].clientY - startY);
    if (dx > 8 || dy > 8) moved = true;
  }, { passive: true });

  scrollEl.addEventListener('touchend', () => {
    if (moved) suppressUntil = Date.now() + 350;
    moved = false;
  });

  scrollEl.addEventListener('touchcancel', () => {
    moved = false;
  });

  scrollEl.addEventListener('click', (e) => {
    if (Date.now() < suppressUntil) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
}

function wireTasksWidget(container, dashData, refreshWidget) {
  const widgetEl = container.querySelector('#tasks-widget');
  const bodyEl = container.querySelector('#tasks-widget-body');
  if (bodyEl) wireTasksWidgetBody(bodyEl, dashData, refreshWidget);

  // Plus button: open full create dialog for the currently selected personal list
  const addBtn = widgetEl?.querySelector('.widget__add-btn');
  if (addBtn) {
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const listId = Number(widgetEl.dataset.activeTab);
      if (!listId) return;
      openItemEditDialog({
        item: { id: null, title: '', priority: 'none', due_date: null, due_time: null,
                alarm_at: null, description: null, recurrence_rule: null },
        container,
        listId,
        onSaved: (saved) => {
          dashData.personalItems = [...(dashData.personalItems ?? []), saved];
          refreshWidget();
        },
      });
    });
  }

  const tabsEl = container.querySelector('#tasks-widget-tabs');
  const leftArrow  = container.querySelector('[data-action="tasks-tabs-scroll"][data-dir="-1"]');
  const rightArrow = container.querySelector('[data-action="tasks-tabs-scroll"][data-dir="1"]');
  function updateTabsArrows() {
    if (!tabsEl || !leftArrow || !rightArrow) return;
    const overflow = tabsEl.scrollWidth - tabsEl.clientWidth > 2;
    leftArrow.hidden  = !overflow || tabsEl.scrollLeft <= 2;
    rightArrow.hidden = !overflow || tabsEl.scrollLeft + tabsEl.clientWidth >= tabsEl.scrollWidth - 2;
  }

  // Tab switching — partial update (no full widget re-render), keeps tabs scroll + widget height stable
  function softSwitchTab(tab) {
    if (!widgetEl) return;
    widgetEl.dataset.activeTab = String(tab);
    widgetEl.querySelectorAll('.tasks-widget__tab').forEach((b) => {
      b.classList.toggle('tasks-widget__tab--active', b.dataset.tab === String(tab));
    });
    const body = container.querySelector('#tasks-widget-body');
    if (body) {
      const activeTab = Number(tab);
      body.innerHTML = renderTasksWidgetBody(
        activeTab,
        dashData.personalLists ?? [],
        dashData.personalItems ?? [],
      );
      if (window.lucide) window.lucide.createIcons();
      wireTasksWidgetBody(body, dashData, refreshWidget);
      wireLinks(body);
    }
    ensureActiveTabVisible(tabsEl, true);
  }

  container.querySelectorAll('[data-action="switch-widget-tab"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tab = btn.dataset.tab;
      const tabKey = dashboardStorageKey('dashboard-tasks-tab');
      if (localStorage.getItem(tabKey) === tab) return;
      localStorage.setItem(tabKey, tab);
      softSwitchTab(tab);
    });
  });

  if (tabsEl) {
    wireScrollClickGuard(tabsEl);
    tabsEl.addEventListener('scroll', updateTabsArrows, { passive: true });
    tabsEl.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      if (tabsEl.scrollWidth - tabsEl.clientWidth <= 2) return;
      e.preventDefault();
      tabsEl.scrollBy({ left: e.deltaY, behavior: 'auto' });
    }, { passive: false });
    requestAnimationFrame(() => {
      ensureActiveTabVisible(tabsEl, false);
      updateTabsArrows();
    });
    window.addEventListener('resize', updateTabsArrows);
  }
  container.querySelectorAll('[data-action="tasks-tabs-scroll"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!tabsEl) return;
      const dir = Number(btn.dataset.dir);
      tabsEl.scrollBy({ left: dir * Math.max(120, tabsEl.clientWidth * 0.7), behavior: 'smooth' });
    });
  });

  }

function wireEventsWidget(container, data) {
  const widget = container.querySelector('#events-widget');
  if (!widget) return;
  widget.querySelectorAll('[data-action="delete-event"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const title = btn.dataset.title || '';
      if (!await showConfirm(t('calendar.deleteConfirm', { title }), { danger: true })) return;
      const id = Number(btn.dataset.id);
      const itemEl = btn.closest('.event-item');
      itemEl.classList.add('task-widget-item--checking');
      setTimeout(() => itemEl.remove(), 250);
      try {
        await api.delete(`/calendar/${id}`);
        data.upcomingEvents = (data.upcomingEvents ?? []).filter((ev) => ev.id !== id);
      } catch (err) {
        window.planium?.showToast(err?.data?.error ?? 'Could not delete event', 'danger');
      }
    });
  });
}

function wireGreetingLink(container) {
  const btn = container.querySelector('.greeting-home-btn[data-quick-link]');
  if (!btn) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const quickLink = btn.dataset.quickLink?.trim();
    if (!quickLink) return;

    const isInternalRoute = quickLink.startsWith('/') && !quickLink.startsWith('//');
    if (isInternalRoute && window.planium?.navigate) {
      window.planium.navigate(quickLink);
      return;
    }

    // Mobile/standalone shells can hand off "_blank" links to the external browser.
    // Keep external links in the current browser context on small screens instead.
    const isMobile = window.matchMedia('(max-width: 1023px)').matches
      || window.matchMedia('(pointer: coarse)').matches;
    if (isMobile) {
      window.location.href = quickLink;
      return;
    }

    window.open(quickLink, '_blank', 'noopener,noreferrer');
  });
}

function wireWeatherChip(container, weather) {
  if (!weather) return;
  const chip = container.querySelector('.greeting-weather[data-action="open-weather"]');
  if (!chip) return;

  const open = () => openWeatherModal(weather);
  chip.addEventListener('click', (e) => { e.stopPropagation(); open(); });
  chip.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });
}

function openWeatherModal(weather) {
  const cur = weather.current;
  const days = (weather.forecast ?? []).slice(0, 5);
  const locale = getLocale();

  const todayStr = new Date().toISOString().slice(0, 10);
  const dayLabel = (dateStr) => {
    if (dateStr === todayStr) return t('common.today');
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  };

  const forecastRows = days.map((d) => `
    <li class="weather-modal__row">
      <span class="weather-modal__day">${esc(dayLabel(d.date))}</span>
      <img class="weather-modal__row-icon" src="${WEATHER_ICON_BASE}${d.icon}"
           alt="${esc(d.desc || '')}" width="32" height="32" loading="lazy">
      <span class="weather-modal__desc">${esc(d.desc || '')}</span>
      <span class="weather-modal__temps">
        <span class="weather-modal__max">${esc(String(d.temp_max))}°</span>
        <span class="weather-modal__min">${esc(String(d.temp_min))}°</span>
      </span>
    </li>`).join('');

  const cityLine = weather.city ? `<div class="weather-modal__city">${esc(weather.city)}</div>` : '';

  const meta = esc(t('dashboard.weatherFeelsLike', {
    temp:     cur.feels_like,
    humidity: cur.humidity,
    wind:     cur.wind_speed,
  }));

  const content = `
    <div class="weather-modal">
      <div class="weather-modal__current">
        <img class="weather-modal__current-icon" src="${WEATHER_ICON_BASE}${cur.icon}"
             alt="${esc(cur.desc || '')}" width="64" height="64">
        <div class="weather-modal__current-info">
          ${cityLine}
          <div class="weather-modal__current-temp">${esc(String(cur.temp))}°</div>
          <div class="weather-modal__current-desc">${esc(cur.desc || '')}</div>
          <div class="weather-modal__current-meta">${meta}</div>
        </div>
      </div>
      ${forecastRows ? `<ul class="weather-modal__list">${forecastRows}</ul>` : ''}
    </div>`;

  openModal({
    title: t('dashboard.weatherForecastTitle'),
    content,
    size: 'sm',
  });
}

function wireNewsRotation(container, headlines, signal) {
  if (!headlines || headlines.length <= 1) return;
  const sourceEl = container.querySelector('#greeting-news-source');
  const titleEl  = container.querySelector('#greeting-news-title');
  if (!sourceEl || !titleEl) return;

  let idx = 0;
  const rotate = () => {
    idx = (idx + 1) % headlines.length;
    titleEl.classList.add('greeting-news__title--fade');
    setTimeout(() => {
      const h = headlines[idx];
      sourceEl.textContent = h.source;
      titleEl.textContent  = h.title;
      titleEl.href         = h.url || '';
    }, 300);
    setTimeout(() => titleEl.classList.remove('greeting-news__title--fade'), 300);
  };

  const timerId = setInterval(rotate, 10_000);
  signal.addEventListener('abort', () => clearInterval(timerId));
}

// --------------------------------------------------------
// Haupt-Render
// --------------------------------------------------------

export async function render(container, { user }) {
  _fabController?.abort();
  _fabController = new AbortController();
  currentDashboardData = null;
  currentRefreshTasksWidget = null;

  container.innerHTML = `
    <div class="dashboard">
      <div class="dashboard__grid">
        <div class="widget-greeting" style="grid-column:1/-1">
    
          <div class="widget-greeting__content">
            <div class="widget-greeting__date-row">
              <span class="widget-greeting__day">${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date().getDay()]}</span>
              <span class="widget-greeting__sep" aria-hidden="true">·</span>
              <span>${formatDate(new Date())}</span>
            </div>
            ${isTickersEnabled() ? renderPriceTickers() : ''}
          </div>
        </div>
        ${skeletonWidget(3)}
        ${skeletonWidget(3)}
        ${skeletonWidget(2)}
        ${skeletonWidget(3)}
      </div>
    </div>
    ${renderFab(user)}
  `;

  let data      = { upcomingEvents: [], urgentTasks: [], todayMeals: [], pinnedNotes: [], lists: [], listItems: [], layout: null };
  let weather   = null;
  let quote     = null;
  let headlines = null;
  let webview   = { configured: false, items: [] };
  try {
    const [dashRes, weatherRes, quoteRes, newsRes, webviewRes] = await Promise.all([
      api.get(dashboardApiPath('')),
      api.get('/weather').catch(() => ({ data: null })),
      isQuoteEnabled() ? api.get('/quotes/today').catch(() => null) : Promise.resolve(null),
      isNewsEnabled() ? api.get('/freshrss/headlines').catch(() => ({ data: null })) : Promise.resolve({ data: null }),
      api.get('/webview/config').catch(() => null),
    ]);
    data      = dashRes;
    weather   = weatherRes.data ?? null;
    quote     = quoteRes;
    headlines = newsRes?.data ?? null;
    webview   = webviewRes ?? { configured: false, items: [] };
  } catch (err) {
    console.error('[Dashboard] Ladefehler:', err.message);
    window.planium?.showToast(t('dashboard.loadError'), 'warning');
  }

  // Greeting urgent chip: union of urgent household tasks + urgent personal items
  // across every list the user has access to. Personal items use list_id for routing.
  const householdUrgent = (data.urgentTasks ?? [])
    .filter((t) => t.priority === 'urgent')
    .map((t) => ({ id: t.id, title: t.title, kind: 'task' }));
  const personalUrgent = (data.personalItems ?? [])
    .filter((it) => it.priority === 'urgent' && !it.done)
    .map((it) => ({ id: it.id, title: it.title, kind: 'personal', list_id: it.list_id }));
  const urgentTasks = [...householdUrgent, ...personalUrgent];
  const stats = { urgentTasks };
  const layoutState = normalizeDashboardLayoutForDevice(data.layout);
  const seededTestBoard = applyDashboardTestBoardTemplate(layoutState);
  if (seededTestBoard) {
    api.put(dashboardApiPath('/layout'), { layout: stripDashboardLayoutVisibility(layoutState) }).catch(() => {});
  }
  const hiddenWidgets = new Set(layoutState.hidden ?? []);
  const webviewItems = (webview.items ?? []).filter((item) => item && item.url);
  const pinnedNotes = (data.pinnedNotes ?? []).filter((note) => note && note.id != null);
  const boardNotes = pinnedNotes;
  const widgetHtmlById = {
    'quote-widget': renderQuoteWidget(
      quote,
      layoutState.spans['quote-widget'],
      layoutState.heights['quote-widget'] ?? 'normal',
    ),
    'tasks-widget': renderTasksWidget(
      data.personalLists ?? [],
      data.personalItems ?? [],
      layoutState.spans['tasks-widget'],
      layoutState.heights['tasks-widget'] ?? 'normal',
    ),
    'events-widget': renderUpcomingEvents(
      data.upcomingEvents ?? [],
      layoutState.spans['events-widget'],
      layoutState.heights['events-widget'] ?? 'normal',
    ),
    'shopping-widget': renderShoppingWidget(
      data.heads ?? [],
      data.sublists ?? [],
      data.listItems ?? [],
      layoutState.spans['shopping-widget'],
      layoutState.heights['shopping-widget'] ?? 'normal',
    ),
    'quick-notes-widget': renderQuickNotes(
      getQNMode(),
      layoutState.spans['quick-notes-widget'],
      layoutState.heights['quick-notes-widget'] ?? 'normal',
    ),
  };
  const dynamicWidgetHtmlById = Object.fromEntries([
    ...webviewItems.map((item) => {
      const id = dashboardLayoutItemId('webview', item.id);
      return [id, renderWebviewCard(item, {
        variant: 'widget',
        span: layoutState.spans[id] ?? 'full',
        height: layoutState.heights[id] ?? 'normal',
      })];
    }),
  ]);

  if (isDashboardTestVariant()) {
    const visibleWidgetIds = layoutState.order
      .filter((id) => !hiddenWidgets.has(id))
      .filter((id) => widgetHtmlById[id] || dynamicWidgetHtmlById[id]);
    const boardWidgetIds = [
      ...visibleWidgetIds,
      ...webviewItems.map((item) => dashboardLayoutItemId('webview', item.id))
        .filter((id) => !visibleWidgetIds.includes(id) && dynamicWidgetHtmlById[id]),
    ];
    const testBoardState = loadDashboardTestBoardState(boardWidgetIds);
    const boardOrder = Array.isArray(testBoardState.order) && testBoardState.order.length
      ? testBoardState.order.filter((id) => boardWidgetIds.includes(id)).concat(boardWidgetIds.filter((id) => !testBoardState.order.includes(id)))
      : boardWidgetIds.slice();
    const packedRects = packDashboardTestBoardRects(testBoardState.rects, boardOrder);
    testBoardState.rects = packedRects;
    testBoardState.order = sortDashboardTestBoardOrder(packedRects, boardWidgetIds);
    saveDashboardTestBoardState(testBoardState);

    const testBoardHtml = testBoardState.order.map((id) => {
      const widgetHtml = widgetHtmlById[id] ?? dynamicWidgetHtmlById[id];
      return renderDashboardTestBoardSlot(id, widgetHtml, packedRects[id]);
    }).join('');

    container.innerHTML = `
    <div class="dashboard dashboard--test-board${isDashboardEditModeEnabled() ? ' dashboard--edit-mode' : ''}">
      <h1 class="sr-only">${t('dashboard.title')}</h1>
      <div class="dashboard__grid">
        ${renderGreeting(user, stats, headlines, weather)}
        <div class="dashboard__test-board dashboard__test-board--pending" id="dashboard-test-board">
          ${testBoardHtml}
        </div>
      </div>
      ${renderLegacyBoardNotes(boardNotes)}
      ${renderFab(user)}
    `;

    wireLinks(container);
    wireGreetingLink(container);
    wireWeatherChip(container, weather);
    wireNewsRotation(container, headlines, _fabController.signal);
    wireDashboardTestBoard(container, testBoardState, boardWidgetIds);
    if (isTickersEnabled()) wirePriceTickers(container, _fabController.signal);
    scheduleMidnightQuoteRefresh(container, _fabController.signal);
    initFab(container, _fabController.signal, user, (savedNote) => {
      if (!savedNote) return;
      data.pinnedNotes = Array.isArray(data.pinnedNotes) ? data.pinnedNotes.slice() : [];
      const idx = data.pinnedNotes.findIndex((n) => n.id === savedNote.id);
      if (savedNote.pinned) {
        if (idx === -1) data.pinnedNotes.unshift(savedNote);
        else data.pinnedNotes[idx] = savedNote;
      } else if (idx !== -1) {
        data.pinnedNotes.splice(idx, 1);
      }
      updateBoardNotesSection(container, data.pinnedNotes);
    });

    function refreshTasksWidget() {
      const widgetEl = container.querySelector('#tasks-widget');
      if (!widgetEl) return;
      const html = renderTasksWidget(
        data.personalLists ?? [],
        data.personalItems ?? [],
        widgetEl.dataset.widgetSpan ?? layoutState.spans['tasks-widget'],
        widgetEl.dataset.widgetHeight ?? layoutState.heights['tasks-widget'] ?? 'normal',
      );
      widgetEl.outerHTML = html;
      if (window.lucide) window.lucide.createIcons();
      wireTasksWidget(container, data, refreshTasksWidget);
      wireLinks(container);
    }

    currentDashboardData = data;
    currentRefreshTasksWidget = refreshTasksWidget;
    wireTasksWidget(container, data, refreshTasksWidget);
    wireShoppingWidget(container, data);
    wireEventsWidget(container, data);
    wireQuickNotes(container);
    wireWebviewCards(container);
    if (window.lucide) window.lucide.createIcons();
    const fabEditToggle = container.querySelector('#fab-edit-mode');
    if (fabEditToggle && isDashboardTestVariant()) {
      fabEditToggle.classList.add('fab-edit-toggle--testboard');
    }
    return;
  }

  const orderedWidgets = layoutState.order
    .filter((id) => !hiddenWidgets.has(id))
    .map((id) => widgetHtmlById[id] ?? dynamicWidgetHtmlById[id])
    .filter(Boolean)
    .join('');
  const unorderedWidgets = [
    ...webviewItems.map((item) => dashboardLayoutItemId('webview', item.id)),
  ]
    .filter((id) => !layoutState.order.includes(id) && !hiddenWidgets.has(id))
    .map((id) => dynamicWidgetHtmlById[id])
    .filter(Boolean)
    .join('');

  container.innerHTML = `
    <div class="dashboard${isDashboardEditModeEnabled() ? ' dashboard--edit-mode' : ''}${isDashboardTestVariant() ? ' dashboard--test-board' : ''}">
      <h1 class="sr-only">${t('dashboard.title')}</h1>
      <div class="dashboard__grid">
        ${renderGreeting(user, stats, headlines, weather)}
        ${orderedWidgets}
        ${unorderedWidgets}
        ${renderWeatherWidget(weather)}
      </div>
      ${renderLegacyBoardNotes(boardNotes)}
    </div>
    ${renderFab(user)}
  `;

  wireLinks(container);
  wireGreetingLink(container);
  wireWeatherChip(container, weather);
  wireNewsRotation(container, headlines, _fabController.signal);
  wireDashboardLayout(container, layoutState, data);
  if (isTickersEnabled()) wirePriceTickers(container, _fabController.signal);
  scheduleMidnightQuoteRefresh(container, _fabController.signal);
  initFab(container, _fabController.signal, user, (savedNote) => {
    if (!savedNote) return;
    data.pinnedNotes = Array.isArray(data.pinnedNotes) ? data.pinnedNotes.slice() : [];
    const idx = data.pinnedNotes.findIndex((n) => n.id === savedNote.id);
    if (savedNote.pinned) {
      if (idx === -1) data.pinnedNotes.unshift(savedNote);
      else data.pinnedNotes[idx] = savedNote;
    } else if (idx !== -1) {
      data.pinnedNotes.splice(idx, 1);
    }
    updateBoardNotesSection(container, data.pinnedNotes);
  });

  function refreshTasksWidget() {
    const widgetEl = container.querySelector('#tasks-widget');
    if (!widgetEl) return;
    const html = renderTasksWidget(
      data.personalLists ?? [],
      data.personalItems ?? [],
      widgetEl.dataset.widgetSpan ?? layoutState.spans['tasks-widget'],
      widgetEl.dataset.widgetHeight ?? layoutState.heights['tasks-widget'] ?? 'normal',
    );
    widgetEl.outerHTML = html;
    if (window.lucide) window.lucide.createIcons();
    wireTasksWidget(container, data, refreshTasksWidget);
    wireLinks(container);
  }
  currentDashboardData = data;
  currentRefreshTasksWidget = refreshTasksWidget;
  wireTasksWidget(container, data, refreshTasksWidget);
  wireShoppingWidget(container, data);
  wireEventsWidget(container, data);
  wireQuickNotes(container);
  wireWebviewCards(container);
  if (window.lucide) window.lucide.createIcons();

  // Wetter: 30-Minuten-Hintergrund-Refresh — aktualisiert nur die Greeting-Chips
  const weatherTimerId = setInterval(async () => {
    const res = await api.get('/weather').catch(() => ({ data: null }));
    if (!res.data) return;
    const iconEl = container.querySelector('.greeting-weather__icon');
    const tempEl = container.querySelector('.greeting-weather__temp');
    if (iconEl) { iconEl.src = WEATHER_ICON_BASE + res.data.current.icon; iconEl.alt = esc(res.data.current.desc); }
    if (tempEl) tempEl.textContent = res.data.current.temp + '°';
  }, 30 * 60 * 1000);
  _fabController.signal.addEventListener('abort', () => clearInterval(weatherTimerId));
}

function wireShoppingWidgetReorder(container, lists) {
  const body = container.querySelector('#shopping-widget-body');
  if (!body) return;

  let dragging = null;
  let didDrag  = false;
  let startY   = 0;
  let isTouch  = false;

  function getListEls() {
    return [...body.querySelectorAll('.shopping-widget__list')];
  }

  // Hit-test via bounding rects — works reliably on all devices
  function findOverList(clientY) {
    for (const el of getListEls()) {
      if (el === dragging) continue;
      const rect = el.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) return el;
    }
    return null;
  }

  function onStart(clientY, e) {
    const handle = e.target.closest('.shopping-widget__drag-handle');
    if (!handle) return;
    const listEl = handle.closest('.shopping-widget__list');
    if (!listEl) return;
    dragging = listEl;
    didDrag  = false;
    startY   = clientY;
  }

  function onMove(clientY) {
    if (!dragging) return;
    const dy = clientY - startY;
    if (!didDrag) {
      if (Math.abs(dy) < 8) return;
      didDrag = true;
      dragging.classList.add('shopping-widget__list--dragging');
    }
    const over = findOverList(clientY);
    if (!over) return;
    const listEls = getListEls();
    const dragIdx = listEls.indexOf(dragging);
    const overIdx = listEls.indexOf(over);
    if (dragIdx === -1 || overIdx === -1) return;
    if (dragIdx < overIdx) over.after(dragging);
    else over.before(dragging);
  }

  async function onEnd() {
    if (!dragging) return;
    const wasDragged = didDrag;
    dragging.classList.remove('shopping-widget__list--dragging');
    const newOrder = getListEls().map((el) => Number(el.dataset.listId));
    const oldOrder = lists.map((l) => l.id);
    dragging = null;
    didDrag  = false;
    isTouch  = false;
    if (!wasDragged) return;
    if (JSON.stringify(newOrder) === JSON.stringify(oldOrder)) return;
    lists.sort((a, b) => newOrder.indexOf(a.id) - newOrder.indexOf(b.id));
    try {
      await api.patch('/lists/sublists/reorder', { ids: newOrder });
    } catch (err) {
      window.planium?.showToast(err.message, 'danger');
      lists.sort((a, b) => oldOrder.indexOf(a.id) - oldOrder.indexOf(b.id));
    }
  }

  function onCancel() {
    if (!dragging) return;
    dragging.classList.remove('shopping-widget__list--dragging');
    dragging = null; didDrag = false; isTouch = false;
  }

  // Touch events (mobile / tablet)
  body.addEventListener('touchstart', (e) => {
    isTouch = true;
    onStart(e.touches[0].clientY, e);
    if (dragging) e.preventDefault();
  }, { passive: false });

  body.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    e.preventDefault();
    onMove(e.touches[0].clientY);
  }, { passive: false });

  body.addEventListener('touchend', onEnd);
  body.addEventListener('touchcancel', onCancel);

  // Pointer events (mouse on desktop — skip if touch already started)
  body.addEventListener('pointerdown', (e) => {
    if (isTouch || e.pointerType === 'touch') return;
    onStart(e.clientY, e);
    if (dragging) e.preventDefault();
  });

  body.addEventListener('pointermove', (e) => {
    if (isTouch || e.pointerType === 'touch' || !dragging) return;
    onMove(e.clientY);
  });

  body.addEventListener('pointerup', (e) => {
    if (isTouch || e.pointerType === 'touch') return;
    onEnd();
  });

  body.addEventListener('pointercancel', (e) => {
    if (isTouch || e.pointerType === 'touch') return;
    onCancel();
  });
}

function wireShoppingWidgetLinks(widget) {
  widget.querySelectorAll('[data-route="/lists"][data-head-id]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      localStorage.setItem('lists-open-head', el.dataset.headId);
    });
  });
}

function wireShoppingWidget(container, data) {
  const widget = container.querySelector('#shopping-widget');
  const body = container.querySelector('#shopping-widget-body');
  if (!body || !widget) return;

  wireShoppingWidgetReorder(container, data.sublists ?? []);

  const tabsEl = widget.querySelector('#shopping-widget-head-tabs');
  const leftArrow  = widget.querySelector('[data-action="widget-head-scroll"][data-dir="-1"]');
  const rightArrow = widget.querySelector('[data-action="widget-head-scroll"][data-dir="1"]');
  function updateArrows() {
    if (!tabsEl || !leftArrow || !rightArrow) return;
    const overflow = tabsEl.scrollWidth - tabsEl.clientWidth > 2;
    leftArrow.hidden  = !overflow || tabsEl.scrollLeft <= 2;
    rightArrow.hidden = !overflow || tabsEl.scrollLeft + tabsEl.clientWidth >= tabsEl.scrollWidth - 2;
  }

  if (tabsEl) {
    wireScrollClickGuard(tabsEl);
    tabsEl.addEventListener('scroll', updateArrows, { passive: true });
    requestAnimationFrame(() => {
      ensureActiveShoppingTabVisible(tabsEl, false);
      updateArrows();
    });
    window.addEventListener('resize', updateArrows);
  }

  widget.querySelectorAll('[data-action="widget-head-scroll"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!tabsEl) return;
      const dir = Number(btn.dataset.dir);
      tabsEl.scrollBy({ left: dir * Math.max(120, tabsEl.clientWidth * 0.7), behavior: 'smooth' });
    });
  });

  function softSwitchHead(newId) {
    if (!widget) return;
    _widgetActiveHeadId = newId;
    widget.querySelectorAll('[data-action="widget-switch-head"]').forEach((b) => {
      b.classList.toggle('shopping-widget__head-tab--active', Number(b.dataset.id) === newId);
    });
    const heads    = data.heads    ?? [];
    const sublists = data.sublists ?? [];
    const listItems = (data.listItems ?? []).filter((i) => !i.is_checked);
    const activeSubs = sublists.filter((s) => s.head_list_id === newId && listItems.some((i) => i.list_id === s.id));
    const renderItem = (i) => `
      <div class="shopping-widget__item" data-item-id="${i.id}" data-list-id="${i.list_id}">
        <button class="shopping-widget__check" data-action="check-item" data-id="${i.id}"
                aria-label="Mark ${esc(i.name)} as done">
          <i data-lucide="circle" style="width:14px;height:14px" aria-hidden="true"></i>
        </button>
        <span class="shopping-widget__item-name">${esc(i.name)}${i.quantity
          ? ` <span class="shopping-widget__qty">${esc(i.quantity)}</span>` : ''}</span>
        ${deleteBtnHtml('delete-shopping-item', `data-id="${i.id}"`, t('common.delete'))}
      </div>`;
    const renderSub = (sub) => {
      const subItems = listItems.filter((i) => i.list_id === sub.id);
      const visible  = subItems.slice(0, SHOPPING_COLLAPSE_AT);
      const hidden   = subItems.slice(SHOPPING_COLLAPSE_AT);
      return `
        <div class="shopping-widget__list" data-list-id="${sub.id}">
          <div class="shopping-widget__list-header">
            <i data-lucide="grip-vertical" class="shopping-widget__drag-handle" aria-hidden="true" style="width:14px;height:14px;flex-shrink:0;cursor:grab;color:var(--color-text-tertiary);touch-action:none"></i>
            <div class="shopping-widget__list-name" data-route="/lists" data-head-id="${sub.head_list_id}" role="button" tabindex="0">
              ${esc(sub.name)}
              <span data-badge="${sub.id}" hidden>${sub.unchecked_count}</span>
            </div>
            ${deleteBtnHtml('delete-shopping-sublist', `data-id="${sub.id}" data-name="${esc(sub.name)}"`, t('common.delete'))}
          </div>
          <div class="shopping-widget__items">
            ${visible.map(renderItem).join('')}
            ${hidden.length ? `
              <div class="shopping-widget__overflow" hidden data-overflow="${sub.id}">
                ${hidden.map(renderItem).join('')}
              </div>
              <button class="shopping-widget__more" data-action="show-more" data-list-id="${sub.id}">
                +${hidden.length} more
              </button>` : ''}
          </div>
        </div>`;
    };
    const newBody = activeSubs.length
      ? activeSubs.map(renderSub).join('')
      : `<div class="widget__empty" style="padding:var(--space-4)">${t('dashboard.noShoppingItems')}</div>`;
    if (body) {
      body.innerHTML = newBody;
      if (window.lucide) window.lucide.createIcons({ el: body });
      wireShoppingWidgetReorder(container, sublists);
    }
    if (tabsEl) ensureActiveShoppingTabVisible(tabsEl, true);
    wireShoppingWidgetLinks(widget);
  }

  widget.querySelectorAll('[data-action="widget-switch-head"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const newId = Number(btn.dataset.id);
      if (newId === _widgetActiveHeadId) return;
      softSwitchHead(newId);
    });
  });

  wireShoppingWidgetLinks(widget);

  body.addEventListener('click', async (e) => {
    // Show more toggle
    const moreBtn = e.target.closest('[data-action="show-more"]');
    if (moreBtn) {
      e.stopPropagation();
      const listId  = moreBtn.dataset.listId;
      const overflow = body.querySelector(`[data-overflow="${listId}"]`);
      if (overflow) {
        overflow.hidden = false;
        moreBtn.remove();
        if (window.lucide) window.lucide.createIcons({ el: overflow });
      }
      return;
    }

    // Delete shopping item
    const deleteItemBtn = e.target.closest('[data-action="delete-shopping-item"]');
    if (deleteItemBtn) {
      e.stopPropagation();
      const ok = await showConfirm(t('shopping.deleteItemConfirm'), { danger: true });
      if (!ok) return;
      const id      = Number(deleteItemBtn.dataset.id);
      const itemEl  = deleteItemBtn.closest('.shopping-widget__item');
      const listEl  = deleteItemBtn.closest('.shopping-widget__list');
      const listId  = Number(listEl?.dataset.listId);
      const badge   = body.querySelector(`[data-badge="${listId}"]`);

      itemEl.classList.add('shopping-widget__item--checking');
      setTimeout(() => itemEl.remove(), 250);

      if (badge) {
        const cur = parseInt(badge.textContent, 10) - 1;
        if (cur <= 0) {
          listEl.remove();
        } else {
          badge.textContent = cur;
        }
      }

      const totalBadge = container.querySelector('#shopping-widget .widget__badge');
      if (totalBadge) {
        const total = parseInt(totalBadge.textContent, 10) - 1;
        totalBadge.textContent = total > 0 ? total : 0;
      }

      data.listItems = (data.listItems ?? []).filter((i) => i.id !== id);
      try {
        await api.delete(`/lists/items/${id}`);
      } catch {
        window.planium?.showToast('Could not delete item', 'danger');
      }
      return;
    }

    // Delete shopping sublist (entire sub-list card)
    const deleteSubBtn = e.target.closest('[data-action="delete-shopping-sublist"]');
    if (deleteSubBtn) {
      e.stopPropagation();
      const id    = Number(deleteSubBtn.dataset.id);
      const name  = deleteSubBtn.dataset.name || '';
      const ok = await showConfirm(t('shopping.deleteListConfirm', { name }), { danger: true });
      if (!ok) return;
      const listEl = deleteSubBtn.closest('.shopping-widget__list');
      listEl?.remove();
      data.sublists = (data.sublists ?? []).filter((s) => s.id !== id);
      data.listItems = (data.listItems ?? []).filter((i) => i.list_id !== id);
      try {
        await api.delete(`/lists/${id}`);
      } catch {
        window.planium?.showToast('Could not delete list', 'danger');
      }
      return;
    }

    // Check item
    const checkBtn = e.target.closest('[data-action="check-item"]');
    if (checkBtn) {
      e.stopPropagation();
      const id      = Number(checkBtn.dataset.id);
      const itemEl  = checkBtn.closest('.shopping-widget__item');
      const listEl  = checkBtn.closest('.shopping-widget__list');
      const listId  = Number(listEl?.dataset.listId);
      const badge   = body.querySelector(`[data-badge="${listId}"]`);

      // Optimistic: strike through and fade out
      itemEl.classList.add('shopping-widget__item--checking');
      setTimeout(() => itemEl.remove(), 300);

      // Update badge count
      if (badge) {
        const cur = parseInt(badge.textContent, 10) - 1;
        if (cur <= 0) {
          listEl.remove();
        } else {
          badge.textContent = cur;
        }
      }

      // Update total badge in header
      const totalBadge = container.querySelector('#shopping-widget .widget__badge');
      if (totalBadge) {
        const total = parseInt(totalBadge.textContent, 10) - 1;
        totalBadge.textContent = total > 0 ? total : 0;
      }

      try {
        await api.patch(`/lists/items/${id}`, { is_checked: 1 });
      } catch {
        window.planium?.showToast('Could not update item', 'danger');
      }
      return;
    }
  });
}

function wireWeatherRefresh(container) {
  const refreshBtn = container.querySelector('#weather-refresh-btn');
  if (!refreshBtn) return;
  const doWeatherRefresh = async () => {
    refreshBtn.disabled = true;
    refreshBtn.classList.add('weather-widget__refresh--spinning');
    try {
      const res = await api.get('/weather').catch(() => ({ data: null }));
      const wWidget = container.querySelector('#weather-widget');
      if (wWidget) {
        wWidget.outerHTML = renderWeatherWidget(res.data ?? null);
        const newWidget = container.querySelector('#weather-widget');
        if (newWidget && window.lucide) window.lucide.createIcons({ el: newWidget });
        wireWeatherRefresh(container);
      }
    } catch { /* silently ignore */ }
  };
  refreshBtn.addEventListener('click', doWeatherRefresh, { signal: _fabController.signal });
}
