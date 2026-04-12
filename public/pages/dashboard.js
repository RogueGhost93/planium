/**
 * Modul: Dashboard
 * Zweck: Startseite mit Begrüßung, Terminen, Aufgaben, Essen, Notizen und FAB
 * Abhängigkeiten: /api.js
 */

import { api } from '/api.js';
import { t, formatDate, formatTime, getLocale } from '/i18n.js';
import { esc } from '/utils/html.js';

// Hält den AbortController des aktuellen FAB-Listeners - wird bei jedem render() erneuert.
let _fabController = null;

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
  if (isNextCalendarWeek(short)) return t('dashboard.nextWeek');
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

function widgetHeader(icon, title, count, linkHref, linkLabel, addRoute, addFlag) {
  linkLabel = linkLabel ?? t('dashboard.allLink');
  const addBtn = addRoute
    ? `<button class="widget__add-btn" data-route="${addRoute}"${addFlag ? ` data-create-flag="${addFlag}"` : ''}
               aria-label="${t('common.add')}">
         <i data-lucide="plus" style="width:14px;height:14px;pointer-events:none" aria-hidden="true"></i>
       </button>`
    : '';
  return `
    <div class="widget__header">
      <span class="widget__title">
        <i data-lucide="${icon}" class="widget__title-icon" aria-hidden="true"></i>
        ${title}
      </span>
      <div class="widget__header-actions">
        ${addBtn}
        <button data-route="${linkHref}" class="widget__link">
          ${linkLabel}
        </button>
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

function renderGreeting(user, stats = {}) {
  const { urgentTasks = [] } = stats;
  const quickLink = user?.quick_link || '';

  const now = new Date();
  const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()];

  let urgentChip = '';
  if (urgentTasks.length > 0) {
    const top = urgentTasks[0];
    const rest = urgentTasks.length - 1;
    const moreTag = rest > 0
      ? `<span class="greeting-chip__more">+${rest}</span>`
      : '';
    urgentChip = `
      <span class="greeting-chip greeting-chip--warn" data-route="/tasks" data-task-id="${top.id}" role="button" tabindex="0">
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

  return `
    <div class="widget-greeting">
      <div class="widget-greeting__content">
        <div class="widget-greeting__date-row">
          <span class="widget-greeting__day">${dayName}</span>
          <span class="widget-greeting__sep" aria-hidden="true">·</span>
          <span>${formatDate(now)}</span>
        </div>
        <div class="widget-greeting__chips">
          ${urgentChip}
          ${homeBtn}
        </div>
      </div>
    </div>
  `;
}

function renderUrgentTasks(tasks) {
  if (!tasks.length) {
    return `<div class="widget">
      ${widgetHeader('check-square', t('nav.tasks'), 0, '/tasks', undefined, '/tasks', 'tasks-create-new')}
      <div class="widget__empty">
        <i data-lucide="check-circle" class="empty-state__icon" style="color:var(--color-success)" aria-hidden="true"></i>
        <div>${t('dashboard.allDone')}</div>
      </div>
    </div>`;
  }

  const items = tasks.map((t) => {
    const due = formatDueDate(t.due_date);
    return `
      <div class="task-item" data-route="/tasks" data-task-id="${t.id}" role="button" tabindex="0">
        <button class="task-widget-check" data-action="check-task" data-id="${t.id}"
                aria-label="Mark as done" title="Mark as done">
          <i data-lucide="circle" style="width:16px;height:16px" aria-hidden="true"></i>
        </button>
        <div class="task-item__content">
          <div class="task-item__title">${esc(t.title)}</div>
          ${due ? `<div class="task-item__meta ${due.overdue ? 'task-item__meta--overdue' : ''}">${due.html}</div>` : ''}
        </div>
        ${t.assigned_color ? `
          <div class="task-item__avatar" style="background-color:${esc(t.assigned_color)}"
               title="${esc(t.assigned_name)}">${esc(initials(t.assigned_name || ''))}</div>` : ''}
      </div>
    `;
  }).join('');

  return `<div class="widget" id="tasks-widget">
    ${widgetHeader('check-square', t('nav.tasks'), tasks.length, '/tasks', undefined, '/tasks', 'tasks-create-new')}
    <div class="widget__body" id="tasks-widget-body">${items}</div>
  </div>`;
}

function renderUpcomingEvents(events) {
  if (!events.length) {
    return `<div class="widget">
      ${widgetHeader('calendar', t('nav.calendar'), 0, '/calendar', undefined, '/calendar', 'calendar-create-new')}
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
      </div>
    `;
  }).join('');

  return `<div class="widget">
    ${widgetHeader('calendar', t('nav.calendar'), events.length, '/calendar', undefined, '/calendar', 'calendar-create-new')}
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

function renderBoardNotes(notes) {
  if (!notes.length) return '';

  return notes.map((n) => `
    <div class="note-item dashboard-note" data-route="/notes" role="button" tabindex="0"
         style="--note-color:${esc(n.color)};">
      ${n.title ? `<div class="note-item__title">${esc(n.title)}</div>` : ''}
      <div class="note-item__content">${renderMarkdownLight(n.content)}</div>
    </div>
  `).join('');
}

const SHOPPING_COLLAPSE_AT = 6;

function renderShoppingWidget(lists, items) {
  const totalUnchecked = lists.reduce((sum, l) => sum + l.unchecked_count, 0);

  if (!lists.length) {
    return `<div class="widget">
      ${widgetHeader('shopping-cart', t('nav.shopping'), 0, '/shopping', undefined, '/shopping', 'shopping-create-new')}
      <div class="widget__empty">
        <i data-lucide="shopping-cart" class="empty-state__icon" aria-hidden="true"></i>
        <div>${t('dashboard.noShoppingItems')}</div>
      </div>
    </div>`;
  }

  const rows = lists.map((list) => {
    const listItems = items.filter((i) => i.list_id === list.id);
    const visible   = listItems.slice(0, SHOPPING_COLLAPSE_AT);
    const hidden    = listItems.slice(SHOPPING_COLLAPSE_AT);

    const renderItem = (i) => `
      <div class="shopping-widget__item" data-item-id="${i.id}" data-list-id="${list.id}">
        <button class="shopping-widget__check" data-action="check-item" data-id="${i.id}"
                aria-label="Mark ${esc(i.name)} as done">
          <i data-lucide="circle" style="width:14px;height:14px" aria-hidden="true"></i>
        </button>
        <span class="shopping-widget__item-name">${esc(i.name)}${i.quantity
          ? ` <span class="shopping-widget__qty">${esc(i.quantity)}</span>` : ''}</span>
      </div>`;

    return `
      <div class="shopping-widget__list" data-list-id="${list.id}">
        <div class="shopping-widget__list-header">
          <i data-lucide="grip-vertical" class="shopping-widget__drag-handle" aria-hidden="true" style="width:14px;height:14px;flex-shrink:0;cursor:grab;color:var(--color-text-tertiary);touch-action:none"></i>
          <div class="shopping-widget__list-name" data-route="/shopping" data-list-id="${list.id}" role="button" tabindex="0">
            ${esc(list.name)}
            <span data-badge="${list.id}" hidden>${list.unchecked_count}</span>
          </div>
        </div>
        <div class="shopping-widget__items">
          ${visible.map(renderItem).join('')}
          ${hidden.length ? `
            <div class="shopping-widget__overflow" hidden data-overflow="${list.id}">
              ${hidden.map(renderItem).join('')}
            </div>
            <button class="shopping-widget__more" data-action="show-more" data-list-id="${list.id}">
              +${hidden.length} more
            </button>` : ''}
        </div>
      </div>`;
  }).join('');

  return `<div class="widget" id="shopping-widget">
    ${widgetHeader('shopping-cart', t('nav.shopping'), totalUnchecked, '/shopping', undefined, '/shopping', 'shopping-create-new')}
    <div class="widget__body" id="shopping-widget-body">${rows}</div>
  </div>`;
}

// --------------------------------------------------------
// Wetter-Widget
// --------------------------------------------------------

const WEATHER_ICON_BASE = '/api/v1/weather/icon/';

function renderWeatherWidget(weather) {
  if (!weather) return '';

  const { city, current, forecast } = weather;

  const forecastHtml = forecast.map((d, i) => {
    const date = new Date(d.date + 'T12:00:00');
    const label = new Intl.DateTimeFormat(getLocale(), { weekday: 'short' }).format(date);
    const extraCls = i >= 3 ? ' weather-forecast__day--extended' : '';
    return `
      <div class="weather-forecast__day${extraCls}">
        <div class="weather-forecast__label">${label}</div>
        <img class="weather-forecast__icon" src="${WEATHER_ICON_BASE}${d.icon}"
             alt="${esc(d.desc)}" width="32" height="32" loading="lazy">
        <div class="weather-forecast__temps">
          <span class="weather-forecast__high">${d.temp_max}°</span>
          <span class="weather-forecast__low">${d.temp_min}°</span>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="widget weather-widget" id="weather-widget">
      <button class="weather-widget__refresh" id="weather-refresh-btn" aria-label="${t('dashboard.weatherRefresh')}" title="${t('dashboard.weatherRefreshTitle')}">
        <i data-lucide="refresh-cw" style="width:14px;height:14px;" aria-hidden="true"></i>
      </button>
      <div class="weather-widget__inner">
        <div class="weather-widget__main">
          <div class="weather-widget__left">
            <div class="weather-widget__temp">${esc(current.temp)}°C</div>
            <div class="weather-widget__desc">${esc(current.desc)}</div>
            <div class="weather-widget__city">${esc(city)}</div>
            <div class="weather-widget__meta">
              ${t('dashboard.weatherFeelsLike', { temp: current.feels_like, humidity: current.humidity, wind: current.wind_speed })}
            </div>
          </div>
          <img class="weather-widget__icon" src="${WEATHER_ICON_BASE}${current.icon}"
               alt="${esc(current.desc)}" width="80" height="80" loading="lazy">
        </div>
        ${forecast.length ? `<div class="weather-forecast">${forecastHtml}</div>` : ''}
      </div>
    </div>`;
}

// --------------------------------------------------------
// Quick Notes Widget (simple sticky-note textarea, auto-saves to localStorage)
// --------------------------------------------------------

const QN_KEY = 'planner-quick-note-text';

function loadQuickNoteText() {
  return localStorage.getItem(QN_KEY) ?? '';
}

function renderQuickNotes() {
  const text = loadQuickNoteText();
  return `
    <div class="widget" id="quick-notes-widget">
      <div class="widget__header">
        <span class="widget__title">
          <i data-lucide="sticky-note" class="widget__title-icon" aria-hidden="true"></i>
          ${t('dashboard.quickNotesTitle')}
        </span>
      </div>
      <div class="quick-notes__editor-wrap">
        <textarea class="quick-notes__editor" id="quick-notes-editor"
                  placeholder="${t('dashboard.quickNotePlaceholder')}"
                  spellcheck="true">${esc(text)}</textarea>
      </div>
    </div>
  `;
}

function wireQuickNotes(container) {
  const editor = container.querySelector('#quick-notes-editor');
  if (!editor) return;

  let _saveTimer = null;
  editor.addEventListener('input', () => {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      localStorage.setItem(QN_KEY, editor.value);
    }, 400);
  });
}

// --------------------------------------------------------
// Quote of the Day Widget
// --------------------------------------------------------

const QUOTE_LS_KEY = 'planner-show-quotes';

function isQuoteEnabled() {
  return localStorage.getItem(QUOTE_LS_KEY) !== 'false';
}

function renderQuoteWidget(quote) {
  if (!quote || !isQuoteEnabled()) return '';
  const author = quote.author ? `<span class="quote-widget__author">\u2014 ${esc(quote.author)}</span>` : '';
  return `
    <div class="widget quote-widget" style="grid-column:1/-1">
      <div class="widget__body quote-widget__body">
        <i data-lucide="quote" class="quote-widget__icon" aria-hidden="true"></i>
        <blockquote class="quote-widget__text">${esc(quote.quote)}</blockquote>
        ${author}
      </div>
    </div>`;
}

// --------------------------------------------------------
// FAB Speed-Dial
// --------------------------------------------------------

const FAB_ACTIONS = () => [
  { route: '/tasks',    label: t('dashboard.fabTask'),     icon: 'check-square'   },
  { route: '/calendar', label: t('dashboard.fabCalendar'), icon: 'calendar-plus'  },
  { route: '/shopping', label: t('dashboard.fabShopping'), icon: 'shopping-cart'  },
  { route: '/notes',    label: t('dashboard.fabNote'),     icon: 'sticky-note'    },
];

function renderFab() {
  const actionsHtml = FAB_ACTIONS().map((a) => `
    <div class="fab-action" data-route="${a.route}" role="button" tabindex="-1"
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
      <div class="fab-actions" id="fab-actions" aria-hidden="true">
        ${actionsHtml}
      </div>
    </div>
  `;
}

function initFab(container, signal) {
  const fabMain    = container.querySelector('#fab-main');
  const fabActions = container.querySelector('#fab-actions');
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

  const FAB_CREATE_FLAGS = {
    '/tasks':    'tasks-create-new',
    '/calendar': 'calendar-create-new',
    '/notes':    'notes-create-new',
    '/shopping': 'shopping-create-new',
  };

  fabActions.querySelectorAll('[data-route]').forEach((el) => {
    const go = () => {
      toggleFab(false);
      const flag = FAB_CREATE_FLAGS[el.dataset.route];
      if (flag) localStorage.setItem(flag, '1');
      window.planner.navigate(el.dataset.route);
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
    const go = () => {
      // Widget + button → set create flag then navigate
      if (el.dataset.createFlag) {
        localStorage.setItem(el.dataset.createFlag, '1');
        window.planner.navigate(el.dataset.route);
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
      // Shopping list name → open that specific list on arrival
      if (el.dataset.listId) {
        localStorage.setItem('shopping-open-list', el.dataset.listId);
      }
      window.planner.navigate(el.dataset.route);
    };
    if (el.tagName === 'A') {
      el.addEventListener('click', (e) => { e.preventDefault(); go(); });
    } else {
      el.addEventListener('click', go);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      });
    }
  });
}

function wireTasksWidget(container) {
  container.querySelectorAll('[data-action="check-task"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.id);
      const itemEl = btn.closest('.task-item');
      itemEl.classList.add('task-widget-item--checking');
      setTimeout(() => itemEl.remove(), 300);
      try {
        await api.patch(`/tasks/${id}/status`, { status: 'done' });
      } catch {
        window.planner?.showToast('Could not update task', 'danger');
      }
    });
  });
}

function wireGreetingLink(container) {
  const btn = container.querySelector('.greeting-home-btn[data-quick-link]');
  if (!btn) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    location.href = btn.dataset.quickLink;
  });
}

// --------------------------------------------------------
// Haupt-Render
// --------------------------------------------------------

export async function render(container, { user }) {
  _fabController?.abort();
  _fabController = new AbortController();

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
          </div>
        </div>
        ${skeletonWidget(3)}
        ${skeletonWidget(3)}
        ${skeletonWidget(2)}
        ${skeletonWidget(3)}
      </div>
    </div>
    ${renderFab()}
  `;

  let data    = { upcomingEvents: [], urgentTasks: [], todayMeals: [], pinnedNotes: [], shoppingLists: [], shoppingItems: [] };
  let weather = null;
  let quote   = null;
  try {
    const [dashRes, weatherRes, quoteRes] = await Promise.all([
      api.get('/dashboard'),
      api.get('/weather').catch(() => ({ data: null })),
      isQuoteEnabled() ? api.get('/quotes/today').catch(() => null) : Promise.resolve(null),
    ]);
    data    = dashRes;
    weather = weatherRes.data ?? null;
    quote   = quoteRes;
  } catch (err) {
    console.error('[Dashboard] Ladefehler:', err.message);
    window.planner?.showToast(t('dashboard.loadError'), 'warning');
  }

  const urgentTasks = (data.urgentTasks ?? []).filter((t) => t.priority === 'urgent');
  const stats = { urgentTasks };

  const widgetTasks = (data.urgentTasks ?? []).filter((t) => {
    if (t.priority === 'urgent') return true;
    if (!t.due_date) return false;
    const diff = diffCalendarDays(t.due_date);
    if (diff < 0) return true;
    if (t.is_recurring) {
      const rrule = (t.recurrence_rule || '').toUpperCase();
      if (rrule.includes('FREQ=YEARLY'))  return diff <= 30;
      if (rrule.includes('FREQ=MONTHLY')) return diff <= 14;
      return diff <= 14;
    }
    return diff <= 14;
  });

  container.innerHTML = `
    <div class="dashboard">
      <h1 class="sr-only">${t('dashboard.title')}</h1>
      <div class="dashboard__grid">
        ${renderGreeting(user, stats)}
        ${renderQuoteWidget(quote)}
        ${renderWeatherWidget(weather)}
        ${renderUrgentTasks(widgetTasks)}
        ${renderUpcomingEvents(data.upcomingEvents ?? [])}
        ${renderShoppingWidget(data.shoppingLists ?? [], data.shoppingItems ?? [])}
        ${renderQuickNotes()}
        ${renderBoardNotes(data.pinnedNotes ?? [])}
      </div>
    </div>
    ${renderFab()}
  `;

  wireLinks(container);
  wireGreetingLink(container);
  initFab(container, _fabController.signal);
  wireTasksWidget(container);
  wireShoppingWidget(container, data);
  wireQuickNotes(container);
  if (window.lucide) window.lucide.createIcons();

  // Wetter-Refresh: Button + 30-Minuten-Interval
  const refreshBtn = container.querySelector('#weather-refresh-btn');
  if (refreshBtn) {
    const doWeatherRefresh = async () => {
      refreshBtn.disabled = true;
      refreshBtn.classList.add('weather-widget__refresh--spinning');
      try {
        const res = await api.get('/weather').catch(() => ({ data: null }));
        const wWidget = container.querySelector('#weather-widget');
        if (wWidget) {
          const fresh = renderWeatherWidget(res.data ?? null);
          wWidget.outerHTML = fresh;
          const newWidget = container.querySelector('#weather-widget');
          if (newWidget && window.lucide) window.lucide.createIcons({ el: newWidget });
          wireWeatherRefresh(container);
        }
      } catch { /* silently ignore */ }
    };

    refreshBtn.addEventListener('click', doWeatherRefresh, { signal: _fabController.signal });

    // 30-Minuten Auto-Refresh - abortiert wenn Seite verlassen wird
    const timerId = setInterval(doWeatherRefresh, 30 * 60 * 1000);
    _fabController.signal.addEventListener('abort', () => clearInterval(timerId));
  }
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
      await api.patch('/shopping/reorder', { ids: newOrder });
    } catch (err) {
      window.planner?.showToast(err.message, 'danger');
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

function wireShoppingWidget(container, data) {
  const body = container.querySelector('#shopping-widget-body');
  if (!body) return;

  wireShoppingWidgetReorder(container, data.shoppingLists ?? []);

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
        await api.patch(`/shopping/items/${id}`, { is_checked: 1 });
      } catch {
        window.planner?.showToast('Could not update item', 'danger');
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
