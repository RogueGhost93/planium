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

function renderGreeting(user, stats = {}, headlines = null) {
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
      ${newsRow}
    </div>
  `;
}

// --------------------------------------------------------
// Tasks Widget — Tab-Switcher (Household + Personal Lists)
// --------------------------------------------------------

function readWidgetActiveTab(personalLists) {
  const stored = localStorage.getItem('dashboard-tasks-tab');
  if (stored === 'household') return 'household';
  if (stored != null) {
    const id = Number(stored);
    if (personalLists.some((l) => l.id === id)) return id;
  }
  return 'household';
}

function renderHouseholdTaskItems(tasks) {
  if (!tasks.length) {
    return `<div class="widget__empty">
      <i data-lucide="check-circle" class="empty-state__icon" style="color:var(--color-success)" aria-hidden="true"></i>
      <div>${t('dashboard.allDone')}</div>
    </div>`;
  }
  return tasks.map((tk) => {
    const due = formatDueDate(tk.due_date);
    const isUrgent = tk.priority === 'urgent';
    return `
      <div class="task-item ${isUrgent ? 'task-item--urgent' : ''}" data-route="/tasks" data-task-id="${tk.id}" role="button" tabindex="0">
        ${isUrgent ? '<div class="task-item__bar" aria-hidden="true"></div>' : ''}
        <button class="task-widget-check" data-action="check-task" data-id="${tk.id}"
                aria-label="Mark as done" title="Mark as done">
          <i data-lucide="circle" style="width:16px;height:16px" aria-hidden="true"></i>
        </button>
        <div class="task-item__content">
          <div class="task-item__title">${esc(tk.title)}</div>
          ${due ? `<div class="task-item__meta ${due.overdue ? 'task-item__meta--overdue' : ''}">${due.html}</div>` : ''}
        </div>
        ${tk.assigned_color ? `
          <div class="task-item__avatar" style="background-color:${esc(tk.assigned_color)}"
               title="${esc(tk.assigned_name)}">${esc(initials(tk.assigned_name || ''))}</div>` : ''}
      </div>
    `;
  }).join('');
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

function renderPersonalListBody(list, items) {
  const pending = items.filter((i) => !i.done);
  const itemsHtml = pending.length
    ? pending.map((it) => {
        const isUrgent = it.priority === 'urgent';
        const due = personalDueLabel(it.due_date);
        const meta = (isUrgent || due) ? `
          <div class="personal-widget-item__meta">
            ${isUrgent ? '<span class="priority-dot priority-dot--urgent" aria-hidden="true"></span>' : ''}
            ${due ? `<span class="personal-widget-item__due ${due.cls}">${esc(due.label)}</span>` : ''}
          </div>` : '';
        return `
        <div class="personal-widget-item ${isUrgent ? 'personal-widget-item--urgent' : ''}" data-item-id="${it.id}">
          <button class="personal-widget-item__check"
                  data-action="toggle-personal-widget-item"
                  data-list-id="${list.id}" data-item-id="${it.id}"
                  aria-label="Mark as done"></button>
          <div class="personal-widget-item__body">
            <span class="personal-widget-item__title">${esc(it.title)}</span>
            ${meta}
          </div>
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
             maxlength="200" autocomplete="off">
      <button class="personal-widget-add__btn" type="submit" aria-label="${t('tasks.personalListAdd')}">
        <i data-lucide="plus" style="width:16px;height:16px;pointer-events:none" aria-hidden="true"></i>
      </button>
    </form>
    <div class="personal-widget-items">${itemsHtml}</div>
  `;
}

function renderTasksWidget(widgetTasks, personalLists, personalItems) {
  const activeTab = readWidgetActiveTab(personalLists);

  const householdCount = widgetTasks.length;
  const householdTab = `
    <button class="tasks-widget__tab ${activeTab === 'household' ? 'tasks-widget__tab--active' : ''}"
            data-action="switch-widget-tab" data-tab="household">
      <i data-lucide="users" style="width:12px;height:12px;pointer-events:none" aria-hidden="true"></i>
      <span>${t('tasks.tabHousehold')}</span>
      ${householdCount > 0 ? `<span class="tasks-widget__tab-count">${householdCount}</span>` : ''}
    </button>`;

  const personalTabs = personalLists.map((l) => {
    const isActive = activeTab === l.id;
    const pending = personalItems.filter((i) => i.list_id === l.id && !i.done).length;
    return `
      <button class="tasks-widget__tab ${isActive ? 'tasks-widget__tab--active' : ''}"
              data-action="switch-widget-tab" data-tab="${l.id}"
              style="--tab-color:${esc(l.color)}">
        <span class="tasks-widget__tab-dot" aria-hidden="true"></span>
        <span>${esc(l.name)}</span>
        ${!l.is_owner ? '<i data-lucide="users" style="width:11px;height:11px;pointer-events:none;opacity:0.7" aria-hidden="true"></i>' : ''}
        ${pending > 0 ? `<span class="tasks-widget__tab-count">${pending}</span>` : ''}
      </button>`;
  }).join('');

  let body;
  if (activeTab === 'household') {
    body = renderHouseholdTaskItems(widgetTasks);
  } else {
    const list = personalLists.find((l) => l.id === activeTab);
    const items = personalItems.filter((i) => i.list_id === activeTab);
    body = list
      ? renderPersonalListBody(list, items)
      : renderHouseholdTaskItems(widgetTasks);
  }

  // Header count = active tab count
  let headerCount = householdCount;
  if (activeTab !== 'household') {
    headerCount = personalItems.filter((i) => i.list_id === activeTab && !i.done).length;
  }

  return `<div class="widget" id="tasks-widget" data-active-tab="${activeTab}">
    ${widgetHeader('check-square', t('nav.tasks'), headerCount, '/tasks', undefined, '/tasks', 'tasks-create-new')}
    <div class="tasks-widget__tabs" id="tasks-widget-tabs">
      ${householdTab}${personalTabs}
    </div>
    <div class="widget__body" id="tasks-widget-body">${body}</div>
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

let _widgetActiveHeadId = null;

function renderShoppingWidget(heads, sublists, items) {
  const totalUnchecked = heads.reduce((s, h) => s + (h.unchecked_count || 0), 0);

  if (!heads.length) {
    return `<div class="widget">
      ${widgetHeader('list-checks', t('nav.lists'), 0, '/lists', undefined, '/lists', 'lists-create-new')}
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
      </div>`;

    return `
      <div class="shopping-widget__list" data-list-id="${sub.id}">
        <div class="shopping-widget__list-header">
          <i data-lucide="grip-vertical" class="shopping-widget__drag-handle" aria-hidden="true" style="width:14px;height:14px;flex-shrink:0;cursor:grab;color:var(--color-text-tertiary);touch-action:none"></i>
          <div class="shopping-widget__list-name" data-route="/lists" data-head-id="${sub.head_list_id}" role="button" tabindex="0">
            ${esc(sub.name)}
            <span data-badge="${sub.id}" hidden>${sub.unchecked_count}</span>
          </div>
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

  return `<div class="widget" id="shopping-widget">
    ${widgetHeader('list-checks', t('nav.lists'), totalUnchecked, '/lists', undefined, '/lists', 'lists-add-item')}
    ${tabsHtml}
    <div class="widget__body" id="shopping-widget-body">${body}</div>
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
const NEWS_LS_KEY  = 'planner-show-news';

function isQuoteEnabled() {
  return localStorage.getItem(QUOTE_LS_KEY) !== 'false';
}

function isNewsEnabled() {
  return localStorage.getItem(NEWS_LS_KEY) === 'true';
}

function renderQuoteWidget(quote) {
  if (!quote || !isQuoteEnabled()) return '';
  const author = quote.author ? `<span class="quote-widget__author">\u2014 ${esc(quote.author)}</span>` : '';
  return `
    <div class="widget quote-widget" id="quote-widget" style="grid-column:1/-1">
      <div class="widget__body quote-widget__body">
        <i data-lucide="quote" class="quote-widget__icon" aria-hidden="true"></i>
        <blockquote class="quote-widget__text">${esc(quote.quote)}</blockquote>
        ${author}
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
        el.outerHTML = renderQuoteWidget(fresh);
        const newEl = container.querySelector('#quote-widget');
        if (newEl && window.lucide) window.lucide.createIcons({ el: newEl });
      }
    } catch { /* non-critical */ }
  }, msUntilMidnight);

  signal.addEventListener('abort', () => clearTimeout(timerId));
}

// --------------------------------------------------------
// FAB Speed-Dial
// --------------------------------------------------------

const FAB_ACTIONS = () => [
  { route: '/tasks',    label: t('dashboard.fabTask'),     icon: 'check-square'   },
  { route: '/calendar', label: t('dashboard.fabCalendar'), icon: 'calendar-plus'  },
  { route: '/lists', label: t('dashboard.fabShopping'), icon: 'shopping-cart'  },
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
    '/lists': 'lists-add-item',
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
      // Personal-list shortcut → switch tasks page to that list tab on arrival
      if (el.dataset.personalListId) {
        localStorage.setItem('tasks-active-tab', el.dataset.personalListId);
      }
      // Shopping list name → open that specific list on arrival
      if (el.dataset.listId) {
        localStorage.setItem('lists-open-list', el.dataset.listId);
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

function wireTasksWidget(container, dashData, refreshWidget) {
  // Household task check-off
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

  // Tab switching (household / personal lists)
  container.querySelectorAll('[data-action="switch-widget-tab"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tab = btn.dataset.tab;
      localStorage.setItem('dashboard-tasks-tab', tab);
      refreshWidget();
    });
  });

  // Personal item: toggle done (optimistic, refetches list)
  container.querySelectorAll('[data-action="toggle-personal-widget-item"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const listId = Number(btn.dataset.listId);
      const itemId = Number(btn.dataset.itemId);
      const itemEl = btn.closest('.personal-widget-item');
      itemEl.classList.add('personal-widget-item--checking');
      setTimeout(() => itemEl.remove(), 250);
      try {
        await api.patch(`/personal-lists/${listId}/items/${itemId}`, { done: true });
        const idx = (dashData.personalItems || []).findIndex((i) => i.id === itemId);
        if (idx >= 0) dashData.personalItems[idx].done = 1;
      } catch {
        window.planner?.showToast('Could not update item', 'danger');
        refreshWidget();
      }
    });
  });

  // Personal item: add via inline form (Enter submits, focus stays on input)
  container.querySelectorAll('[data-action="add-personal-widget-item"]').forEach((form) => {
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
        const fresh = container.querySelector(
          `[data-action="add-personal-widget-item"][data-list-id="${listId}"] .personal-widget-add__input`
        );
        fresh?.focus();
      } catch {
        window.planner?.showToast('Could not add item', 'danger');
      } finally {
        if (submitBtn) submitBtn.disabled = false;
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

  let data      = { upcomingEvents: [], urgentTasks: [], todayMeals: [], pinnedNotes: [], lists: [], listItems: [] };
  let weather   = null;
  let quote     = null;
  let headlines = null;
  try {
    const [dashRes, weatherRes, quoteRes, newsRes] = await Promise.all([
      api.get('/dashboard'),
      api.get('/weather').catch(() => ({ data: null })),
      isQuoteEnabled() ? api.get('/quotes/today').catch(() => null) : Promise.resolve(null),
      isNewsEnabled() ? api.get('/freshrss/headlines').catch(() => ({ data: null })) : Promise.resolve({ data: null }),
    ]);
    data      = dashRes;
    weather   = weatherRes.data ?? null;
    quote     = quoteRes;
    headlines = newsRes?.data ?? null;
  } catch (err) {
    console.error('[Dashboard] Ladefehler:', err.message);
    window.planner?.showToast(t('dashboard.loadError'), 'warning');
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

  const widgetTasks = (data.urgentTasks ?? []).filter((t) => {
    if (t.priority === 'urgent') return true;
    if (!t.due_date) return true;
    const diff = diffCalendarDays(t.due_date);
    if (diff < 0) return true;
    if (t.is_recurring) {
      const rrule = (t.recurrence_rule || '').toUpperCase();
      if (rrule.includes('FREQ=YEARLY'))  return diff <= 30;
      if (rrule.includes('FREQ=MONTHLY')) return diff <= 7;
      if (rrule.includes('FREQ=WEEKLY'))  return diff <= 1;
      if (rrule.includes('FREQ=DAILY'))   return diff <= 1;
      return diff <= 14;
    }
    return diff <= 14;
  });

  container.innerHTML = `
    <div class="dashboard">
      <h1 class="sr-only">${t('dashboard.title')}</h1>
      <div class="dashboard__grid">
        ${renderGreeting(user, stats, headlines)}
        ${renderQuoteWidget(quote)}
        ${renderWeatherWidget(weather)}
        ${renderTasksWidget(widgetTasks, data.personalLists ?? [], data.personalItems ?? [])}
        ${renderUpcomingEvents(data.upcomingEvents ?? [])}
        ${renderShoppingWidget(data.heads ?? [], data.sublists ?? [], data.listItems ?? [])}
        ${renderQuickNotes()}
        ${renderBoardNotes(data.pinnedNotes ?? [])}
      </div>
    </div>
    ${renderFab()}
  `;

  wireLinks(container);
  wireGreetingLink(container);
  wireNewsRotation(container, headlines, _fabController.signal);
  scheduleMidnightQuoteRefresh(container, _fabController.signal);
  initFab(container, _fabController.signal);

  function refreshTasksWidget() {
    const widgetEl = container.querySelector('#tasks-widget');
    if (!widgetEl) return;
    const html = renderTasksWidget(widgetTasks, data.personalLists ?? [], data.personalItems ?? []);
    widgetEl.outerHTML = html;
    if (window.lucide) window.lucide.createIcons();
    wireTasksWidget(container, data, refreshTasksWidget);
    wireLinks(container);
  }
  wireTasksWidget(container, data, refreshTasksWidget);
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
      await api.patch('/lists/sublists/reorder', { ids: newOrder });
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
    tabsEl.addEventListener('scroll', updateArrows, { passive: true });
    requestAnimationFrame(() => {
      const active = tabsEl.querySelector('.shopping-widget__head-tab--active');
      if (active) active.scrollIntoView({ inline: 'nearest', block: 'nearest' });
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

  widget.querySelectorAll('[data-action="widget-switch-head"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const newId = Number(btn.dataset.id);
      if (newId === _widgetActiveHeadId) return;
      _widgetActiveHeadId = newId;
      const fresh = renderShoppingWidget(data.heads ?? [], data.sublists ?? [], data.listItems ?? []);
      widget.outerHTML = fresh;
      if (window.lucide) window.lucide.createIcons();
      wireShoppingWidget(container, data);
    });
  });

  // Clicking a sublist name navigates to /lists and opens its head
  widget.querySelectorAll('[data-route="/lists"][data-head-id]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      localStorage.setItem('lists-open-head', el.dataset.headId);
    });
  });

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
        await api.patch(`/lists/items/${id}`, { is_checked: 1 });
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
