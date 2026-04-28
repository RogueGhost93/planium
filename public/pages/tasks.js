/**
 * Modul: Aufgaben (Tasks)
 * Zweck: Listenansicht mit Filtern, Gruppierung, CRUD-Modal, Subtask-Verwaltung
 * Abhängigkeiten: /api.js
 */

import { api } from '/api.js';
import { renderRRuleFields, bindRRuleEvents, getRRuleValues } from '/rrule-ui.js';
import { openModal as openSharedModal, closeModal, wireBlurValidation, btnSuccess, btnError, showConfirm, showPrompt } from '/components/modal.js';
import { stagger, vibrate } from '/utils/ux.js';
import { t, formatDate } from '/i18n.js';
import { esc, linkify } from '/utils/html.js';

// --------------------------------------------------------
// Konstanten
// --------------------------------------------------------

const PRIORITIES = () => [
  { value: 'none',   label: t('tasks.priorityNone'),   color: 'transparent'                  },
  { value: 'urgent', label: t('tasks.priorityUrgent'), color: 'var(--color-priority-urgent)' },
  { value: 'high',   label: t('tasks.priorityHigh'),   color: 'var(--color-priority-high)'   },
  { value: 'medium', label: t('tasks.priorityMedium'), color: 'var(--color-priority-medium)' },
  { value: 'low',    label: t('tasks.priorityLow'),    color: 'var(--color-priority-low)'    },
];

const TASK_STATUSES = () => [
  { value: 'open',        label: t('tasks.statusOpen') },
  { value: 'in_progress', label: t('tasks.statusInProgress') },
  { value: 'done',        label: t('tasks.statusDone') },
];

const PERSONAL_STATUSES = () => [
  { value: 'open', label: t('tasks.statusOpen') },
  { value: 'in_progress', label: t('tasks.statusInProgress') },
  { value: 'done', label: t('tasks.statusDone') },
];

const PRIORITY_LABELS = () => Object.fromEntries(PRIORITIES().map((p) => [p.value, p.label]));
const STATUS_LABELS   = () => Object.fromEntries(TASK_STATUSES().map((s) => [s.value, s.label]));

// --------------------------------------------------------
// Hilfsfunktionen
// --------------------------------------------------------

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function normalizeSearch(value = '') {
  return value == null ? '' : String(value).trim().toLowerCase();
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

function formatDueDate(dateStr) {
  if (!dateStr) return null;
  const due  = new Date(dateStr);
  const now  = new Date();
  now.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due - now) / 86400000);

  if (diffDays < 0)  return { label: t('tasks.overdueDay', { count: Math.abs(diffDays) }), cls: 'due-date--overdue' };
  if (diffDays === 0) return { label: t('tasks.dueToday'),   cls: 'due-date--today' };
  if (diffDays === 1) return { label: t('tasks.dueTomorrow'), cls: ''                };
  return { label: formatDate(due), cls: '' };
}

const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

function diffCalendarDays(dateStr) {
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const targetMidnight = dateStr.length === 10
    ? new Date(dateStr + 'T00:00:00')
    : new Date(dateStr);
  targetMidnight.setHours(0, 0, 0, 0);
  return Math.round((targetMidnight - todayMidnight) / (1000 * 60 * 60 * 24));
}

function isRecurringTaskDue(task) {
  if (!task.is_recurring || !task.due_date || task.priority === 'urgent') return true;
  const diff = diffCalendarDays(task.due_date);
  if (diff < 0) return true;
  const rrule = (task.recurrence_rule || '').toUpperCase();
  if (rrule.includes('FREQ=YEARLY'))  return diff <= 30;
  if (rrule.includes('FREQ=MONTHLY')) return diff <= 7;
  if (rrule.includes('FREQ=WEEKLY'))  return diff <= 1;
  if (rrule.includes('FREQ=DAILY'))   return diff <= 1;
  return diff <= 14;
}

// Urgent always first (overrides date). Everything else sorted by due date,
// with priority as tiebreaker for same date (or both undated).
export function sortTasksForList(tasks) {
  return tasks.slice().sort((a, b) => {
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

// --------------------------------------------------------
// Render-Bausteine
// --------------------------------------------------------

function renderPriorityBadge(priority) {
  if (priority === 'none') return '';
  return `<span class="priority-badge priority-badge--${priority}">
    <span class="priority-dot priority-dot--${priority}"></span>
    ${PRIORITY_LABELS()[priority] ?? priority}
  </span>`;
}

function renderToolbarSearch({ scope, open, value, label, placeholder }) {
  const expanded = open || !!value;
  return `
    <div class="toolbar-search" data-search-scope="${scope}">
      <i data-lucide="search" class="toolbar-search__icon" aria-hidden="true"></i>
      <input class="toolbar-search__input" type="search" id="${scope}-search"
             placeholder="${esc(placeholder)}" value="${esc(value)}" autocomplete="off">
      <button class="btn btn--ghost btn--icon toolbar-search__clear" type="button"
              data-action="clear-${scope}-search" aria-label="${t('common.clear')}" ${value ? '' : 'hidden'}>
        <i data-lucide="x" style="width:14px;height:14px;pointer-events:none" aria-hidden="true"></i>
      </button>
    </div>`;
}

function renderDueDate(dateStr) {
  const d = formatDueDate(dateStr);
  if (!d) return '';
  return `<span class="due-date ${d.cls}">
    <i data-lucide="clock" style="width:11px;height:11px" aria-hidden="true"></i> ${d.label}
  </span>`;
}

function renderTaskCard(task, opts = {}) {
  const { expandedSubtasks = false } = opts;
  const isDone     = task.status === 'done';
  const isSelected = state.selectedIds.has(task.id);
  const progress = task.subtask_total > 0
    ? Math.round((task.subtask_done / task.subtask_total) * 100)
    : null;

  const subtasksHtml = task.subtasks?.length
    ? task.subtasks.map((s) => `
        <div class="subtask-item ${s.status === 'done' ? 'subtask-item--done' : ''}"
             data-subtask-id="${s.id}">
          <button class="subtask-item__checkbox ${s.status === 'done' ? 'subtask-item__checkbox--done' : ''}"
                  data-action="toggle-subtask" data-id="${s.id}"
                  data-status="${s.status}" aria-label="${t('tasks.subtaskMarkDone', { title: esc(s.title) })}">
            ${s.status === 'done' ? '<i data-lucide="check" style="width:10px;height:10px;color:#fff" aria-hidden="true"></i>' : ''}
          </button>
          <span class="subtask-item__title">${esc(s.title)}</span>
        </div>`).join('')
    : '';

  return `
    <div class="task-card ${isDone ? 'task-card--done' : ''} ${isSelected ? 'task-card--selected' : ''}" data-task-id="${task.id}" data-action="open-task">
      <div class="task-card__main">
        <button class="task-select-cb" data-action="toggle-select" data-id="${task.id}"
                aria-pressed="${isSelected}" aria-label="${t('tasks.selectTask')}">
          ${isSelected ? '<i data-lucide="check" style="width:12px;height:12px;color:#fff" aria-hidden="true"></i>' : ''}
        </button>
        <button class="task-status-btn task-status-btn--${task.status}"
                data-action="toggle-status" data-id="${task.id}" data-status="${task.status}"
                aria-label="${t('tasks.markDone', { title: esc(task.title) })}">
          <i data-lucide="check" class="task-status-btn__check" aria-hidden="true"></i>
        </button>

        <div class="task-card__body">
          <div class="task-card__title">
            ${linkify(task.title)}
          </div>
          <div class="task-card__meta">
            ${renderPriorityBadge(task.priority)}
            ${renderDueDate(task.due_date)}
            ${task.is_recurring ? `<span class="due-date" aria-label="${t('tasks.recurring')}"><i data-lucide="repeat" style="width:12px;height:12px" aria-hidden="true"></i></span>` : ''}
          </div>
        </div>

        ${task.assigned_color ? `
          <div class="task-avatar" style="background-color:${esc(task.assigned_color)}"
               title="${esc(task.assigned_name)}">
            ${esc(initials(task.assigned_name ?? ''))}
          </div>` : ''}

        ${(!task.priority || task.priority === 'none') && state.householdShowPriority ? `
        <div class="priority-quick-flags" role="group" aria-label="Set priority">
          <button class="priority-quick-flag priority-quick-flag--urgent" data-action="set-task-priority" data-id="${task.id}" data-priority="urgent" title="Urgent"></button>
          <button class="priority-quick-flag priority-quick-flag--high"   data-action="set-task-priority" data-id="${task.id}" data-priority="high"   title="High"></button>
          <button class="priority-quick-flag priority-quick-flag--medium" data-action="set-task-priority" data-id="${task.id}" data-priority="medium" title="Medium"></button>
          <button class="priority-quick-flag priority-quick-flag--low"    data-action="set-task-priority" data-id="${task.id}" data-priority="low"    title="Low"></button>
        </div>` : ''}

        <button class="btn btn--ghost btn--icon" data-action="edit-task" data-id="${task.id}"
                aria-label="${t('tasks.editButton')}" style="min-height:unset;width:36px;height:36px">
          <i data-lucide="pencil" style="width:16px;height:16px" aria-hidden="true"></i>
        </button>
        <button class="btn btn--ghost btn--icon" data-action="delete-task-direct" data-id="${task.id}"
                aria-label="${t('common.delete')}" style="min-height:unset;width:36px;height:36px;color:var(--color-text-secondary)">
          <i data-lucide="x" style="width:16px;height:16px" aria-hidden="true"></i>
        </button>
      </div>

      ${progress !== null ? `
        <div class="subtask-progress" data-action="toggle-subtasks" data-id="${task.id}"
             aria-label="${t('tasks.subtaskToggle')}">
          <div class="subtask-progress__bar-wrap">
            <div class="subtask-progress__bar-fill" style="width:${progress}%"></div>
          </div>
          <span class="subtask-progress__text">${task.subtask_done}/${task.subtask_total}</span>
        </div>` : ''}

      ${task.subtasks !== undefined ? `
        <div class="subtask-list ${expandedSubtasks ? 'subtask-list--visible' : ''}"
             id="subtasks-${task.id}">
          ${subtasksHtml}
          <button class="subtask-item__add" data-action="add-subtask" data-parent="${task.id}">
            ${t('tasks.subtaskAdd')}
          </button>
        </div>` : ''}
    </div>`;
}

function renderTaskGroups(tasks) {
  const open = tasks.filter((t) => t.status !== 'done');
  const pending = sortTasksForList(open.filter((t) => isRecurringTaskDue(t)));
  const notYetDue = sortTasksForList(open.filter((t) => !isRecurringTaskDue(t)));
  const done = sortTasksForList(tasks.filter((t) => t.status === 'done'));

  if (!pending.length && !notYetDue.length && !done.length) {
    return `<div class="empty-state">
      <svg class="empty-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
      <div class="empty-state__title">${t('tasks.emptyTitle')}</div>
      <div class="empty-state__description">${t('tasks.emptyDescription')}</div>
    </div>`;
  }

  let html = '';

  if (pending.length) {
    html += `
      <div class="task-group">
        ${pending.map((tk) => renderTaskCard(tk)).join('')}
      </div>`;
  }

  if (notYetDue.length) {
    html += `
      <div class="task-group">
        <div class="task-group__divider">
          <span>${t('tasks.notYetDue')}</span>
        </div>
        ${notYetDue.map((tk) => renderTaskCard(tk)).join('')}
      </div>`;
  }

  if (done.length) {
    html += `
      <div class="task-group task-group--done">
        <div class="task-group__divider">
          <span>${t('tasks.statusDone')} (${done.length})</span>
          <button class="btn btn--ghost personal-list__clear-btn" data-action="clear-done-tasks">
            <i data-lucide="trash-2" style="width:14px;height:14px" aria-hidden="true"></i>
            ${t('tasks.personalListClearDone')}
          </button>
        </div>
        ${done.map((tk) => renderTaskCard(tk)).join('')}
      </div>`;
  }

  return html;
}

// --------------------------------------------------------
// Task-Modal (Erstellen / Bearbeiten)
// --------------------------------------------------------

function renderModalContent({ task = null, users = [] } = {}) {
  const isEdit = !!task;

  const userOptions = users.map((u) =>
    `<option value="${u.id}" ${task?.assigned_to === u.id ? 'selected' : ''}>${esc(u.display_name)}</option>`
  ).join('');

  const current = task?.priority ?? 'none';
  const priorityOptions = PRIORITIES()
    .map((p) =>
      `<option value="${p.value}" ${current === p.value ? 'selected' : ''}>${p.label}</option>`
    ).join('');

  const modeToggle = isEdit ? '' : `
    <div class="task-mode-toggle" role="tablist" aria-label="${t('tasks.newTask')}">
      <button type="button" class="task-mode-toggle__btn task-mode-toggle__btn--active"
              data-mode="task" role="tab" aria-selected="true">
        ${t('tasks.newTask')}
      </button>
      <button type="button" class="task-mode-toggle__btn"
              data-mode="list" role="tab" aria-selected="false">
        ${t('tasks.newPersonalList')}
      </button>
    </div>
    <input type="hidden" id="task-form-mode" name="mode" value="task">`;

  const listModeFields = isEdit ? '' : `
    <div data-mode-fields="list" hidden>
      <div class="form-group">
        <label class="label" for="new-list-name">${t('tasks.personalListNameLabel')}</label>
        <input class="input" type="text" id="new-list-name" name="list_name"
               placeholder="${t('tasks.personalListNamePlaceholder')}"
               maxlength="600" autocomplete="off">
      </div>

      <div class="form-group">
        <label class="label">${t('tasks.personalListColorLabel')}</label>
        <div class="color-swatches" id="new-list-swatches">
          ${PERSONAL_LIST_COLORS.map((c, idx) => `
            <button type="button" class="color-swatch ${idx === 0 ? 'color-swatch--active' : ''}"
                    data-color="${c}" style="background-color:${c}"
                    aria-label="${c}"></button>
          `).join('')}
        </div>
        <input type="hidden" id="new-list-color" name="list_color" value="${PERSONAL_LIST_COLORS[0]}">
      </div>

      <div class="form-group">
        <label class="label" for="new-list-items">${t('shopping.newListItemsLabel')}</label>
        <textarea class="input" id="new-list-items" name="list_items"
                  rows="4" placeholder="${t('tasks.personalListAddPlaceholder')}"
                  style="resize:vertical"></textarea>
      </div>
    </div>`;

  return `
    <form id="task-form" novalidate>
      <input type="hidden" id="task-id" value="${task?.id ?? ''}">

      ${modeToggle}

      <div data-mode-fields="task">
        <div class="form-group">
          <div class="form-field">
            <label class="label" for="task-title">${t('tasks.titleLabel')}</label>
            <input class="input" type="text" id="task-title" name="title"
                   value="${esc(task?.title)}" placeholder="${t('tasks.titlePlaceholder')}"
                   required autocomplete="off">
            <div class="form-field__error">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/>
                   <line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16.01"/>
              </svg>
              ${t('common.required')}
            </div>
          </div>
        </div>

        <div class="form-group">
          <label class="label" for="task-description">${t('tasks.descriptionLabel')}</label>
          <textarea class="input" id="task-description" name="description"
                    rows="2" placeholder="${t('tasks.descriptionPlaceholder')}"
                    style="resize:vertical">${esc(task?.description)}</textarea>
        </div>

        <div class="form-group" style="margin-bottom:0">
          <label class="label" for="task-priority">${t('tasks.priorityLabel')}</label>
          <select class="input" id="task-priority" name="priority" style="min-height:44px">
            ${priorityOptions}
          </select>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3);margin-top:var(--space-4)">
          <div class="form-group" style="margin-bottom:0">
            <label class="label" for="task-due-date">${t('tasks.dueDateLabel')}</label>
            <input class="input" type="date" id="task-due-date" name="due_date"
                   value="${task?.due_date ?? ''}">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="label" for="task-due-time">${t('tasks.dueTimeLabel')}</label>
            <input class="input" type="time" id="task-due-time" name="due_time"
                   value="${task?.due_time ?? ''}">
          </div>
        </div>

        <div class="form-group" style="margin-top:var(--space-4)">
          <label class="label" for="task-alarm-at">${t('tasks.alarmLabel')}</label>
          <input class="input" type="datetime-local" id="task-alarm-at" name="alarm_at"
                 value="${task?.alarm_at ?? ''}">
        </div>

        <div class="form-group" style="margin-top:var(--space-4)">
          <label class="label" for="task-assigned">${t('tasks.assignedLabel')}</label>
          <select class="input" id="task-assigned" name="assigned_to" style="min-height:44px">
            <option value="">${t('tasks.assignedNobody')}</option>
            ${userOptions}
          </select>
        </div>

        ${isEdit ? `
          <div class="form-group">
            <label class="label" for="task-status">${t('tasks.statusLabel')}</label>
            <select class="input" id="task-status" name="status" style="min-height:44px">
              ${TASK_STATUSES().map((s) =>
                `<option value="${s.value}" ${task.status === s.value ? 'selected' : ''}>${s.label}</option>`
              ).join('')}
            </select>
          </div>` : ''}

        ${renderRRuleFields('task', task?.recurrence_rule)}
      </div>

      ${listModeFields}

      <div id="task-form-error" class="login-error" hidden></div>

      <div class="modal-panel__footer" style="padding:0;border:none;margin-top:var(--space-6)">
        ${isEdit ? `
          <button type="button" class="btn btn--danger" data-action="delete-task"
                  data-id="${task.id}">${t('common.delete')}</button>` : ''}
        <button type="submit" class="btn btn--primary" id="task-submit-btn">
          ${isEdit ? t('common.save') : t('common.create')}
        </button>
      </div>
    </form>`;
}

// --------------------------------------------------------
// Seiten-State
// --------------------------------------------------------

let state = {
  tasks:            [],
  users:            [],
  filters:          { status: '', priority: '', assigned_to: '' },
  taskSearch:       '',
  taskSearchOpen:   false,
  householdName:         localStorage.getItem('household-name')         || '',
  householdColor:        localStorage.getItem('household-color')        || '#2563EB',
  householdShowPriority: localStorage.getItem('household-show-priority') !== '0',
  viewMode:         localStorage.getItem('tasks-view') || 'list',
  expandedTasks:    new Set(),
  dragTaskId:       null,
  selectMode:       false,
  selectedIds:      new Set(),
  taskLists:        [],
  activeTab:        'household',
  personalItems:    [],
  personalViewMode:    localStorage.getItem('personal-view') || 'list',
  personalFilters:     { status: '', priority: '', assigned_to: '' },
  personalSearch:      '',
  personalSearchOpen:  false,
  personalSelectMode:  false,
  personalSelectedIds: new Set(),
};

// Preset palette for personal-list color picker (8 swatches)
const PERSONAL_LIST_COLORS = [
  '#2563EB', '#7C3AED', '#0B7A73', '#16A34A',
  '#C2410C', '#DC2626', '#B45309', '#DB2777',
];

// --------------------------------------------------------
// API-Aktionen
// --------------------------------------------------------

async function loadTasks(container) {
  const params = new URLSearchParams();
  if (state.filters.status)      params.set('status',      state.filters.status);
  if (state.filters.priority)    params.set('priority',    state.filters.priority);
  if (state.filters.assigned_to) params.set('assigned_to', state.filters.assigned_to);

  const query = params.toString() ? `?${params}` : '';
  const data  = await api.get(`/tasks${query}`);
  state.tasks = data.data ?? [];
  renderTaskList(container);
}

function taskMatchesSearch(task, query) {
  if (!query) return true;
  const priorityLabels = PRIORITY_LABELS();
  const statusLabels = STATUS_LABELS();
  return [
    task.title,
    task.description,
    task.priority,
    priorityLabels[task.priority],
    task.status,
    statusLabels[task.status],
    task.assigned_name,
    task.due_date,
  ].some((value) => normalizeSearch(value).includes(query));
}

function getVisibleTasks() {
  const query = normalizeSearch(state.taskSearch);
  return query ? state.tasks.filter((task) => taskMatchesSearch(task, query)) : state.tasks;
}

function personalItemMatchesSearch(item, query) {
  if (!query) return true;
  const priorityLabels = PRIORITY_LABELS();
  const status = item.status ?? (item.done ? 'done' : 'open');
  const statusLabel = STATUS_LABELS()[status] ?? status;
  return [
    item.title,
    item.note,
    item.priority,
    priorityLabels[item.priority],
    statusLabel,
    item.due_date,
  ].some((value) => normalizeSearch(value).includes(query));
}

function getPersonalItemStatus(item) {
  return item?.status ?? (item?.done ? 'done' : 'open');
}

function setPersonalItemStatus(item, status) {
  item.status = status;
  item.done = status === 'done' ? 1 : 0;
}

const PERSONAL_STATUS_CYCLE = { open: 'in_progress', in_progress: 'done', done: 'open' };
const PERSONAL_STATUS_ICON  = { open: 'circle', in_progress: 'circle-dot', done: 'check-circle' };

async function toggleTaskStatus(id, currentStatus) {
  const next = currentStatus === 'done' ? 'open' : 'done';
  const res = await api.patch(`/tasks/${id}/status`, { status: next });
  // Recurring task: server rescheduled it in place — update local state directly
  if (res.data?.rescheduled) {
    const task = state.tasks.find((t) => t.id === parseInt(id, 10));
    if (task) { task.status = 'open'; task.due_date = res.data.due_date; }
  }
  return res;
}

async function toggleSubtaskStatus(id, currentStatus) {
  const next = currentStatus === 'done' ? 'open' : 'done';
  await api.patch(`/tasks/${id}/status`, { status: next });
}

async function loadTaskForEdit(id) {
  const data = await api.get(`/tasks/${id}`);
  return data.data;
}

// --------------------------------------------------------
// Modal-Verwaltung (delegiert an Shared Modal-System)
// --------------------------------------------------------

function openTaskModal({ task = null, users = [], prefill = null } = {}, container) {
  const isEdit = !!task;
  openSharedModal({
    title: isEdit ? t('tasks.editTask') : t('tasks.newTask'),
    content: renderModalContent({ task, users }),
    size: 'lg',
    onSave(panel) {
      if (prefill) {
        const titleEl = panel.querySelector('#task-title');
        const descEl  = panel.querySelector('#task-description');
        if (titleEl) titleEl.value = prefill.title || '';
        if (descEl)  descEl.value  = prefill.description || '';
      }

      // RRULE-Events binden
      bindRRuleEvents(document, 'task');

      // Blur-Validierung für required-Felder aktivieren
      wireBlurValidation(panel);

      // Mode toggle (Task ↔ New list) — create only
      if (!isEdit) {
        wireTaskModeToggle(panel);
        wireNewListSwatches(panel);
      }

      // Form-Events
      panel.querySelector('#task-form')
        ?.addEventListener('submit', (e) => handleFormSubmit(e, container));

      panel.querySelector('[data-action="delete-task"]')
        ?.addEventListener('click', (e) => handleDeleteTask(e.currentTarget.dataset.id, container));
    },
  });
}

function wireTaskModeToggle(panel) {
  const modeInput = panel.querySelector('#task-form-mode');
  const taskFields = panel.querySelector('[data-mode-fields="task"]');
  const listFields = panel.querySelector('[data-mode-fields="list"]');
  const titleInput = panel.querySelector('#task-title');
  const listNameInput = panel.querySelector('#new-list-name');
  const submitBtn = panel.querySelector('#task-submit-btn');
  if (!modeInput || !taskFields || !listFields) return;

  const applyMode = (mode) => {
    modeInput.value = mode;
    const isList = mode === 'list';
    taskFields.hidden = isList;
    listFields.hidden = !isList;
    if (titleInput) titleInput.required = !isList;
    if (listNameInput) listNameInput.required = isList;
    if (submitBtn) submitBtn.textContent = t('common.create');
    panel.querySelectorAll('.task-mode-toggle__btn').forEach((btn) => {
      const active = btn.dataset.mode === mode;
      btn.classList.toggle('task-mode-toggle__btn--active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    const focusEl = isList ? listNameInput : titleInput;
    setTimeout(() => focusEl?.focus(), 0);
  };

  panel.querySelectorAll('.task-mode-toggle__btn').forEach((btn) => {
    btn.addEventListener('click', () => applyMode(btn.dataset.mode));
  });
}

function wireNewListSwatches(panel) {
  const swatches = panel.querySelector('#new-list-swatches');
  const colorInput = panel.querySelector('#new-list-color');
  if (!swatches || !colorInput) return;
  swatches.addEventListener('click', (e) => {
    const swatch = e.target.closest('.color-swatch');
    if (!swatch) return;
    swatches.querySelectorAll('.color-swatch--active')
      .forEach((s) => s.classList.remove('color-swatch--active'));
    swatch.classList.add('color-swatch--active');
    colorInput.value = swatch.dataset.color;
  });
}

// --------------------------------------------------------
// Formular-Handler
// --------------------------------------------------------

async function handleFormSubmit(e, container) {
  e.preventDefault();
  const form      = e.target;
  const errorEl   = document.getElementById('task-form-error');
  const submitBtn = document.getElementById('task-submit-btn');
  const taskId    = document.getElementById('task-id').value;
  const mode      = form.mode?.value ?? 'task';

  errorEl.hidden = true;
  submitBtn.disabled = true;
  submitBtn.textContent = t('common.saving');

  const originalLabel = taskId ? t('common.save') : t('common.create');

  // --- "New list" path: create personal list + optional initial items ---
  if (!taskId && mode === 'list') {
    const name  = String(form.list_name?.value ?? '').trim();
    const color = String(form.list_color?.value ?? '').trim() || PERSONAL_LIST_COLORS[0];
    const itemsRaw = String(form.list_items?.value ?? '');
    const itemTitles = itemsRaw.split('\n').map((s) => s.trim()).filter(Boolean);

    if (!name) {
      errorEl.textContent = t('common.required');
      errorEl.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
      return;
    }

    try {
      const res = await api.post('/personal-lists', { name, color });
      const newList = res.data;
      state.taskLists.push(newList);

      if (itemTitles.length) {
        const created = await Promise.all(
          itemTitles.map((title) =>
            api.post(`/personal-lists/${newList.id}/items`, { title }).then((r) => r.data).catch(() => null)
          )
        );
        state.personalItems = created.filter(Boolean);
      } else {
        state.personalItems = [];
      }

      state.activeTab = newList.id;
      localStorage.setItem('tasks-active-tab', String(newList.id));

      window.planium.showToast(t('tasks.personalListCreatedToast'), 'success');
      btnSuccess(submitBtn, originalLabel);
      setTimeout(() => closeModal(), 700);

      if (container) {
        renderTaskTabsBar(container);
        renderPersonalView(container);
      }
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
      btnError(submitBtn);
    }
    return;
  }

  // --- "Task" path (household task: create or edit) ---
  const rrule = getRRuleValues(document, 'task');
  const body = {
    title:           form.title.value.trim(),
    description:     form.description.value.trim() || null,
    priority:        form.priority.value,
    due_date:        form.due_date?.value || null,
    due_time:        form.due_time?.value || null,
    alarm_at:        form.alarm_at?.value || null,
    assigned_to:     form.assigned_to.value ? Number(form.assigned_to.value) : null,
    is_recurring:    rrule.is_recurring ? 1 : 0,
    recurrence_rule: rrule.recurrence_rule,
  };
  if (form.status) body.status = form.status.value;

  try {
    if (taskId) {
      await api.put(`/tasks/${taskId}`, body);
      window.planium.showToast(t('tasks.savedToast'), 'success');
    } else {
      await api.post('/tasks', body);
      window.planium.showToast(t('tasks.createdToast'), 'success');
    }
    btnSuccess(submitBtn, originalLabel);
    setTimeout(() => closeModal(), 700);
    await loadTasks(container);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
    btnError(submitBtn);
  }
}

async function handleDeleteTask(id, container) {
  if (!await showConfirm(t('tasks.deleteConfirm'), { danger: true })) return;
  try {
    await api.delete(`/tasks/${id}`);
    closeModal();
    window.planium.showToast(t('tasks.deletedToast'), 'default');
    await loadTasks(container);
  } catch (err) {
    window.planium.showToast(err.message, 'danger');
  }
}

async function handleAddSubtask(parentId, container) {
  const title = await showPrompt(t('tasks.subtaskPrompt'));
  if (!title?.trim()) return;
  try {
    await api.post('/tasks', { title: title.trim(), parent_task_id: parentId });
    await loadTasks(container);
  } catch (err) {
    window.planium.showToast(err.message, 'danger');
  }
}

// --------------------------------------------------------
// Kanban-Ansicht
// --------------------------------------------------------

const KANBAN_COLS = () => [
  { status: 'open',        label: t('tasks.kanbanOpen'),        colorVar: '--color-text-secondary' },
  { status: 'in_progress', label: t('tasks.kanbanInProgress'), colorVar: '#c2410c' },
  { status: 'done',        label: t('tasks.kanbanDone'),        colorVar: '--color-success'        },
];

const KANBAN_STATUS_CYCLE = { open: 'in_progress', in_progress: 'done', done: 'open' };
const KANBAN_STATUS_ICON  = { open: 'circle', in_progress: 'circle-dot', done: 'check-circle' };

function renderKanbanCard(task) {
  const due = formatDueDate(task.due_date);
  const nextStatus = KANBAN_STATUS_CYCLE[task.status] ?? 'open';
  const icon = KANBAN_STATUS_ICON[task.status] ?? 'circle';
  const nextStatusLabel = STATUS_LABELS()[nextStatus] ?? nextStatus.replace('_', ' ');
  const isSelected = state.selectedIds.has(task.id);
  return `
    <div class="kanban-card ${task.status === 'done' ? 'kanban-card--done' : ''} ${isSelected ? 'kanban-card--selected' : ''}"
         data-task-id="${task.id}" draggable="${!state.selectMode}">
      ${state.selectMode ? `
        <button class="task-select-cb kanban-select-cb ${isSelected ? 'task-select-cb--checked' : ''}"
                data-action="toggle-select" data-id="${task.id}"
                aria-pressed="${isSelected}" aria-label="Select task">
          ${isSelected ? '<i data-lucide="check" style="width:12px;height:12px;color:#fff" aria-hidden="true"></i>' : ''}
        </button>` : ''}
      <div class="kanban-card__header">
        <div class="kanban-card__title">${esc(task.title)}</div>
        <button class="kanban-card__status-btn" data-action="cycle-status"
                data-id="${task.id}" data-next-status="${nextStatus}"
                title="Move to ${nextStatusLabel}" aria-label="${t('tasks.cycleStatus')}">
          <i data-lucide="${icon}" style="width:14px;height:14px;pointer-events:none" aria-hidden="true"></i>
        </button>
      </div>
      <div class="kanban-card__meta">
        ${renderPriorityBadge(task.priority)}
        ${due ? `<span class="due-date ${due.cls}"><i data-lucide="clock" style="width:10px;height:10px" aria-hidden="true"></i> ${due.label}</span>` : ''}
      </div>
      ${task.assigned_color ? `
        <div class="kanban-card__footer">
          <div class="task-avatar" style="background-color:${task.assigned_color};width:22px;height:22px;font-size:9px"
               title="${task.assigned_name ?? ''}">
            ${initials(task.assigned_name ?? '')}
          </div>
        </div>` : ''}
    </div>`;
}

function renderKanban(container) {
  const listEl = container.querySelector('#task-list');
  if (!listEl) return;

  const cols = KANBAN_COLS();
  const grouped = {};
  for (const col of cols) grouped[col.status] = [];
  for (const t of getVisibleTasks()) {
    if (grouped[t.status]) grouped[t.status].push(t);
    else grouped['open'].push(t);
  }

  listEl.innerHTML = `
    <div class="kanban-board">
      ${cols.map((col) => `
        <div class="kanban-col" data-status="${col.status}">
          <div class="kanban-col__header">
            <span class="kanban-col__title" style="color:${col.colorVar.startsWith('--') ? `var(${col.colorVar})` : col.colorVar}">
              ${col.label}
            </span>
            <span class="kanban-col__count">${grouped[col.status].length}</span>
          </div>
          <div class="kanban-col__body" data-drop-zone="${col.status}">
            ${grouped[col.status].map((t) => renderKanbanCard(t)).join('')}
            <div class="kanban-drop-placeholder" hidden></div>
          </div>
        </div>
      `).join('')}
    </div>`;

  if (window.lucide) window.lucide.createIcons();
  wireKanbanDrag(container);
  updateOverdueBadge();
}

function wireKanbanDrag(container) {
  const board = container.querySelector('.kanban-board');
  if (!board) return;

  board.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.kanban-card[data-task-id]');
    if (!card) return;
    state.dragTaskId = card.dataset.taskId;
    card.classList.add('kanban-card--dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  board.addEventListener('dragend', (e) => {
    const card = e.target.closest('.kanban-card[data-task-id]');
    if (card) card.classList.remove('kanban-card--dragging');
    board.querySelectorAll('.kanban-drop-placeholder').forEach((el) => el.hidden = true);
    board.querySelectorAll('.kanban-col__body--over').forEach((el) =>
      el.classList.remove('kanban-col__body--over')
    );
    state.dragTaskId = null;
  });

  board.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const zone = e.target.closest('[data-drop-zone]');
    if (!zone) return;
    board.querySelectorAll('.kanban-col__body--over').forEach((el) =>
      el.classList.remove('kanban-col__body--over')
    );
    zone.classList.add('kanban-col__body--over');
  });

  board.addEventListener('dragleave', (e) => {
    const zone = e.target.closest('[data-drop-zone]');
    if (zone && !zone.contains(e.relatedTarget)) {
      zone.classList.remove('kanban-col__body--over');
    }
  });

  board.addEventListener('drop', async (e) => {
    e.preventDefault();
    const zone = e.target.closest('[data-drop-zone]');
    if (!zone || !state.dragTaskId) return;
    zone.classList.remove('kanban-col__body--over');

    const newStatus = zone.dataset.dropZone;
    const taskId    = state.dragTaskId;
    const task      = state.tasks.find((t) => String(t.id) === String(taskId));
    if (!task || task.status === newStatus) return;

    // Optimistisches Update
    task.status = newStatus;
    renderKanban(container);

    try {
      await api.patch(`/tasks/${taskId}/status`, { status: newStatus });
      await loadTasks(container); // sync
    } catch (err) {
      window.planium.showToast(err.message, 'danger');
      await loadTasks(container);
    }
  });

  // Klick auf Kanban-Card öffnet Edit-Modal (oder cycle-status button)
  board.addEventListener('click', async (e) => {
    // Quick-status cycle button
    const cycleBtn = e.target.closest('[data-action="cycle-status"]');
    if (cycleBtn) {
      e.stopPropagation();
      const taskId    = cycleBtn.dataset.id;
      const newStatus = cycleBtn.dataset.nextStatus;
      const task      = state.tasks.find((t) => String(t.id) === String(taskId));
      if (!task) return;
      task.status = newStatus;
      renderKanban(container);
      try {
        const res = await api.patch(`/tasks/${taskId}/status`, { status: newStatus });
        if (res.data?.rescheduled) {
          task.status   = 'open';
          task.due_date = res.data.due_date;
          renderKanban(container);
        }
      } catch (err) {
        window.planium.showToast(err.message, 'danger');
        await loadTasks(container);
      }
      return;
    }

    // Select mode: toggle selection on card click
    const card = e.target.closest('.kanban-card[data-task-id]');
    if (!card) return;

    if (state.selectMode) {
      const taskId = parseInt(card.dataset.taskId, 10);
      const isSelected = state.selectedIds.has(taskId);
      if (isSelected) state.selectedIds.delete(taskId);
      else state.selectedIds.add(taskId);
      card.classList.toggle('kanban-card--selected', !isSelected);
      const cb = card.querySelector('.kanban-select-cb');
      if (cb) {
        cb.classList.toggle('task-select-cb--checked', !isSelected);
        cb.setAttribute('aria-pressed', String(!isSelected));
        cb.innerHTML = !isSelected
          ? '<i data-lucide="check" style="width:12px;height:12px;color:#fff" aria-hidden="true"></i>'
          : '';
        if (window.lucide) window.lucide.createIcons({ nodes: [cb] });
      }
      updateBulkBar(container);
      return;
    }

    // Normal mode: open edit modal
    try {
      const task = await loadTaskForEdit(card.dataset.taskId);
      openTaskModal({ task, users: state.users }, container);
    } catch (err) {
      window.planium.showToast(t('tasks.loadError'), 'danger');
    }
  });
}

// --------------------------------------------------------
// Partielle DOM-Updates
// --------------------------------------------------------

function renderTaskList(container) {
  if (state.viewMode === 'kanban') {
    renderKanban(container);
    return;
  }
  const listEl = container.querySelector('#task-list');
  if (!listEl) return;
  listEl.innerHTML = renderTaskGroups(getVisibleTasks());
  listEl.classList.toggle('task-list--select-mode', state.selectMode);
  if (window.lucide) window.lucide.createIcons();
  stagger(listEl.querySelectorAll('.task-card, .kanban-card'));
  updateOverdueBadge();
}

function renderFilters(container) {
  const menu = container.querySelector('#filter-menu');
  if (!menu) return;

  const sections = [];
  const statusLabels   = STATUS_LABELS();
  const priorityLabels = PRIORITY_LABELS();

  sections.push(`<div class="filter-dropdown__section">
    <div class="filter-dropdown__title">${t('tasks.statusLabel')}</div>`);
  TASK_STATUSES().forEach((s) => {
    const isActive = state.filters.status === s.value;
    sections.push(`<label class="filter-option">
      <input type="radio" name="status" value="${s.value}" ${isActive ? 'checked' : ''} data-filter="status">
      <span class="filter-option__label">${s.label}</span>
    </label>`);
  });
  sections.push(`<label class="filter-option">
    <input type="radio" name="status" value="" ${!state.filters.status ? 'checked' : ''} data-filter="status">
    <span class="filter-option__label">${t('tasks.clearFilter')}</span>
  </label></div>`);

  sections.push(`<div class="filter-dropdown__section">
    <div class="filter-dropdown__title">${t('tasks.priorityLabel')}</div>`);
  PRIORITIES().forEach((p) => {
    const isActive = state.filters.priority === p.value;
    sections.push(`<label class="filter-option">
      <input type="radio" name="priority" value="${p.value}" ${isActive ? 'checked' : ''} data-filter="priority">
      <span class="filter-option__label">${p.label}</span>
    </label>`);
  });
  sections.push(`<label class="filter-option">
    <input type="radio" name="priority" value="" ${!state.filters.priority ? 'checked' : ''} data-filter="priority">
    <span class="filter-option__label">${t('tasks.clearFilter')}</span>
  </label></div>`);

  if (state.users.length > 1) {
    sections.push(`<div class="filter-dropdown__section">
      <div class="filter-dropdown__title">${t('tasks.assignedLabel')}</div>`);
    state.users.forEach((u) => {
      const isActive = state.filters.assigned_to === String(u.id);
      sections.push(`<label class="filter-option">
        <input type="radio" name="assigned_to" value="${u.id}" ${isActive ? 'checked' : ''} data-filter="assigned_to">
        <span class="filter-option__label">${u.display_name}</span>
      </label>`);
    });
    sections.push(`<label class="filter-option">
      <input type="radio" name="assigned_to" value="" ${!state.filters.assigned_to ? 'checked' : ''} data-filter="assigned_to">
      <span class="filter-option__label">${t('tasks.clearFilter')}</span>
    </label></div>`);
  }

  menu.innerHTML = sections.join('');
  wireFilterDropdown(container);
}

function updateOverdueBadge() {
  const overdue = state.tasks.filter((t) => {
    if (!t.due_date || t.status === 'done') return false;
    return new Date(t.due_date) < new Date().setHours(0, 0, 0, 0);
  }).length;

  document.querySelectorAll('[data-route="/tasks"] .nav-badge').forEach((el) => el.remove());
  if (overdue > 0) {
    document.querySelectorAll('[data-route="/tasks"]').forEach((el) => {
      el.insertAdjacentHTML('beforeend', `<span class="nav-badge">${overdue}</span>`);
    });
  }
}

// --------------------------------------------------------
// Event-Verdrahtung
// --------------------------------------------------------

/** Toggle a task's selected state and update the card DOM without full re-render. */
function toggleSelectId(taskId, cardEl) {
  if (state.selectedIds.has(taskId)) {
    state.selectedIds.delete(taskId);
  } else {
    state.selectedIds.add(taskId);
  }
  if (!cardEl) return;
  const isSelected = state.selectedIds.has(taskId);
  cardEl.classList.toggle('task-card--selected', isSelected);
  const cb = cardEl.querySelector('.task-select-cb');
  if (cb) {
    cb.setAttribute('aria-pressed', String(isSelected));
    cb.innerHTML = isSelected
      ? '<i data-lucide="check" style="width:12px;height:12px;color:#fff" aria-hidden="true"></i>'
      : '';
    if (window.lucide) window.lucide.createIcons({ nodes: [cb] });
  }
}

function updateBulkBar(container) {
  const inSelect = state.selectMode;
  // Toggle normal toolbar items
  const newBtn    = container.querySelector('#btn-new-task');
  const viewToggle = container.querySelector('#view-toggle');
  const groupToggle = container.querySelector('#group-mode-toggle');
  const search = container.querySelector('[data-search-scope="task"]');
  if (newBtn)    newBtn.hidden    = inSelect;
  if (viewToggle) viewToggle.hidden = inSelect;
  if (groupToggle) groupToggle.hidden = inSelect;
  if (search) search.hidden = inSelect;
  // Toggle bulk items
  const countEl    = container.querySelector('#bulk-count');
  const deleteBtn   = container.querySelector('#btn-bulk-delete');
  if (countEl)    { countEl.hidden    = !inSelect; countEl.textContent = t('tasks.selectedCount', { count: state.selectedIds.size }); }
  if (deleteBtn)   deleteBtn.hidden   = !inSelect;
}

function wireSelectMode(container) {
  const selectBtn = container.querySelector('#btn-select');
  if (!selectBtn) return;

  selectBtn.addEventListener('click', () => {
    state.selectMode = !state.selectMode;
    if (!state.selectMode) state.selectedIds.clear();
    selectBtn.classList.toggle('btn--primary', state.selectMode);
    selectBtn.setAttribute('aria-pressed', String(state.selectMode));
    renderTaskList(container);
    updateBulkBar(container);
  });

  container.querySelector('#btn-deselect-all')?.addEventListener('click', () => {
    state.selectedIds.clear();
    updateBulkBar(container);
    renderTaskList(container);
  });

  container.querySelector('#btn-bulk-delete')?.addEventListener('click', async () => {
    const count = state.selectedIds.size;
    if (!count) return;
    if (!await showConfirm(t('tasks.bulkDeleteConfirm', { count }), { danger: true })) return;
    const ids = [...state.selectedIds];
    try {
      await Promise.all(ids.map((id) => api.delete(`/tasks/${id}`)));
      state.selectedIds.clear();
      state.selectMode = false;
      selectBtn.classList.remove('btn--primary');
      selectBtn.setAttribute('aria-pressed', 'false');
      updateBulkBar(container);
      window.planium.showToast(t('tasks.bulkDeletedToast', { count }), 'default');
      await loadTasks(container);
    } catch (err) {
      window.planium.showToast(err.message, 'danger');
    }
  });
}

function wireFilterDropdown(container) {
  const inputs = container.querySelectorAll('#filter-menu input[type="radio"]');
  inputs.forEach((input) => {
    input.addEventListener('change', async () => {
      const filter = input.dataset.filter;
      state.filters[filter] = input.value;
      renderFilters(container);
      await loadTasks(container);
    });
  });
}

function wireFilterDropdownToggle(container) {
  const dropdown = container.querySelector('#filter-dropdown');
  const btn = container.querySelector('#btn-filter');
  const menu = container.querySelector('#filter-menu');
  if (!dropdown || !btn || !menu) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = menu.classList.contains('filter-dropdown__menu--open');
    menu.classList.toggle('filter-dropdown__menu--open', !isOpen);
    btn.setAttribute('aria-pressed', !isOpen);
  });

  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target)) {
      menu.classList.remove('filter-dropdown__menu--open');
      btn.setAttribute('aria-pressed', 'false');
    }
  });
}

function wireToolbarSearch(container, { scope, valueKey, openKey, refresh }) {
  const root = container.querySelector(`[data-search-scope="${scope}"]`);
  if (!root) return;
  const input = root.querySelector('.toolbar-search__input');
  const clear = root.querySelector('.toolbar-search__clear');
  if (!input || !clear) return;

  input.addEventListener('input', () => {
    state[valueKey] = input.value;
    clear.hidden = !state[valueKey];
    refresh();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    state[valueKey] = '';
    input.value = '';
    clear.hidden = true;
    refresh();
  });

  clear.addEventListener('click', () => {
    state[valueKey] = '';
    input.value = '';
    clear.hidden = true;
    input.focus();
    refresh();
  });
}

function wireViewToggle(container) {
  const toggle = container.querySelector('#view-toggle');
  if (!toggle) return;

  // Apply initial view state to toggle buttons
  toggle.querySelectorAll('[data-view]').forEach((b) =>
    b.classList.toggle('group-toggle__btn--active', b.dataset.view === state.viewMode)
  );
  const groupToggle = container.querySelector('#group-mode-toggle');
  if (groupToggle) groupToggle.style.display = state.viewMode === 'list' ? '' : 'none';

  toggle.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.viewMode = btn.dataset.view;
      localStorage.setItem('tasks-view', state.viewMode);
      toggle.querySelectorAll('[data-view]').forEach((b) =>
        b.classList.toggle('group-toggle__btn--active', b.dataset.view === state.viewMode)
      );
      renderTaskList(container);
    });
  });
}

function wireNewTaskBtn(container) {
  const handler = () => {
    openTaskModal({ users: state.users }, container);
  };
  container.querySelector('#btn-new-task')?.addEventListener('click', handler);
  container.querySelector('#fab-new-task')?.addEventListener('click', handler);
}

function wireTaskList(container) {
  const listEl = container.querySelector('#task-list');
  if (!listEl) return;

  // Select mode: clicking anywhere on a card row toggles selection
  listEl.addEventListener('click', (e) => {
    if (!state.selectMode) return;
    if (e.target.closest('[data-action="toggle-select"]')) return;
    const card = e.target.closest('.task-card[data-task-id]');
    if (!card) return;
    e.stopImmediatePropagation();
    const taskId = parseInt(card.dataset.taskId, 10);
    toggleSelectId(taskId, card);
    updateBulkBar(container);
  });

  listEl.addEventListener('click', async (e) => {
    if (e.target.closest('a[href]')) return;
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const id     = target.dataset.id;

    if (action === 'toggle-select') {
      const taskId = parseInt(id, 10);
      toggleSelectId(taskId, target.closest('.task-card'));
      updateBulkBar(container);
      return;
    }

    if (state.selectMode) return; // block all other actions in select mode

    if (action === 'toggle-status') {
      const status = target.dataset.status;
      target.classList.toggle('task-status-btn--done', status !== 'done');
      target.closest('.task-card')?.classList.toggle('task-card--done', status !== 'done');
      try {
        await toggleTaskStatus(id, status);
        await loadTasks(container);
      } catch (err) {
        window.planium.showToast(err.message, 'danger');
        await loadTasks(container);
      }
    }

    if (action === 'toggle-subtasks') {
      const subtaskList = document.getElementById(`subtasks-${id}`);
      if (subtaskList) subtaskList.classList.toggle('subtask-list--visible');
    }

    if (action === 'toggle-subtask') {
      try {
        await toggleSubtaskStatus(id, target.dataset.status);
        await loadTasks(container);
      } catch (err) {
        window.planium.showToast(err.message, 'danger');
      }
    }

    if (action === 'edit-task') {
      try {
        const task = await loadTaskForEdit(id);
        openTaskModal({ task, users: state.users }, container);
      } catch (err) {
        window.planium.showToast(t('tasks.loadError'), 'danger');
      }
      return;
    }

    if (action === 'open-task') {
      const card = target.closest('.task-card[data-task-id]');
      if (card && selectionIsInsideElement(card)) return;
      try {
        const task = await loadTaskForEdit(id);
        openTaskModal({ task, users: state.users }, container);
      } catch (err) {
        window.planium.showToast(t('tasks.loadError'), 'danger');
      }
      return;
    }

    if (action === 'set-task-priority') {
      const priority = target.dataset.priority;
      const task = state.tasks.find((tk) => tk.id === parseInt(id, 10));
      if (!task || !priority) return;
      task.priority = priority;
      renderTaskList(container);
      try {
        await api.patch(`/tasks/${id}/priority`, { priority });
      } catch (err) {
        task.priority = 'none';
        renderTaskList(container);
        window.planium.showToast(err.message, 'danger');
      }
      return;
    }

    if (action === 'delete-task-direct') {
      await handleDeleteTask(id, container);
    }

    if (action === 'clear-done-tasks') {
      const doneTasks = state.tasks.filter((tk) => tk.status === 'done');
      if (!doneTasks.length) return;
      const count = doneTasks.length;
      if (!await showConfirm(t('tasks.personalListClearDoneConfirm'), { danger: true })) return;
      try {
        await Promise.all(doneTasks.map((tk) => api.delete(`/tasks/${tk.id}`)));
        window.planium.showToast(t('tasks.bulkDeletedToast', { count }), 'default');
        await loadTasks(container);
      } catch (err) {
        window.planium.showToast(err.message, 'danger');
      }
    }

    if (action === 'add-subtask') {
      await handleAddSubtask(target.dataset.parent, container);
    }
  });
}

// --------------------------------------------------------
// Persönliche Listen (solo todos)
// Eigenes UI: Tabs oben, einfache Item-Rows ohne Modal.
// --------------------------------------------------------

function readActiveTab() {
  const raw = localStorage.getItem('tasks-active-tab');
  if (!raw || raw === 'household') return 'household';
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 'household';
}

async function loadPersonalLists() {
  try {
    const data = await api.get('/personal-lists');
    state.taskLists = data.data ?? [];
  } catch (err) {
    state.taskLists = [];
  }
}

async function loadPersonalItems(listId) {
  try {
    const data = await api.get(`/personal-lists/${listId}/items`);
    state.personalItems = data.data ?? [];
  } catch (err) {
    state.personalItems = [];
    window.planium.showToast(t('tasks.personalListLoadError'), 'danger');
  }
}

function renderTaskTabsBar(container) {
  const bar = container.querySelector('#task-tabs-bar');
  if (!bar) return;

  const activeList = state.taskLists.find((l) => l.id === state.activeTab);
  if (activeList?.color) {
    const c = activeList.color;
    container.querySelector('.tasks-page')?.style.setProperty('--module-accent', c);
    container.querySelector('.personal-list')?.style.setProperty('--module-accent', c);
    document.documentElement.style.setProperty('--active-module-accent', c);
  }

  const personalTabs = state.taskLists.map((l) => {
    const isActive = state.activeTab === l.id;
    const isShared = !l.is_owner || (l.shared_user_ids?.length > 0);
    const indicator = isShared
      ? `<i data-lucide="users" style="width:12px;height:12px;pointer-events:none;flex-shrink:0;color:${isActive ? '#fff' : 'var(--tab-color)'}" aria-hidden="true"></i>`
      : '<span class="task-tab__color-dot" aria-hidden="true"></span>';
    return `
      <button class="task-tab ${isActive ? 'task-tab--active' : ''}"
              data-action="switch-tab" data-tab="${l.id}"
              data-list-id="${l.id}" data-owned="${l.is_owner ? '1' : '0'}"
              style="--tab-color: ${esc(l.color)}"
              title="${!l.is_owner && l.owner_name ? esc(t('tasks.sharedByLabel', { name: l.owner_name })) : esc(l.name)}">
        ${indicator}
        ${esc(l.name)}
        ${l.pending_count > 0 ? `<span class="task-tab__count">${l.pending_count}</span>` : ''}
      </button>`;
  }).join('');

  bar.innerHTML = personalTabs + `
    <button class="task-tab__new" data-action="new-list"
            aria-label="${t('tasks.newPersonalList')}" title="${t('tasks.newPersonalList')}">
      <i data-lucide="plus" style="width:18px;height:18px" aria-hidden="true"></i>
    </button>
  `;
  if (window.lucide) window.lucide.createIcons();
}

function formatPersonalDueDate(iso) {
  if (!iso) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const target = new Date(iso + 'T00:00:00'); target.setHours(0,0,0,0);
  const diff = Math.round((target - today) / 86400000);
  let cls = '';
  let label;
  if (diff < 0)        { cls = 'personal-item__due--overdue'; label = t('tasks.overdue') ?? 'Overdue'; }
  else if (diff === 0) { cls = 'personal-item__due--today';   label = t('tasks.dueToday') ?? 'Today'; }
  else if (diff === 1) { label = t('common.tomorrow') ?? 'Tomorrow'; }
  else                 { label = formatDate(target); }
  return { cls, label };
}

function renderPersonalItemRow(item) {
  const due = formatPersonalDueDate(item.due_date);
  const isSelected = state.personalSelectedIds.has(item.id);
  const list = state.taskLists.find((l) => l.id === state.activeTab);
  const showPriority = list?.show_priority !== 0;
  const isShared = list && (!list.is_owner || (list.shared_user_ids?.length > 0));
  const status = getPersonalItemStatus(item);
  const nextStatus = PERSONAL_STATUS_CYCLE[status] ?? 'open';
  const statusIcon = PERSONAL_STATUS_ICON[status] ?? 'circle';
  return `
    <div class="task-card ${status === 'done' ? 'task-card--done' : ''} ${isSelected ? 'task-card--selected' : ''}" data-item-id="${item.id}" data-action="open-personal-item">
      <div class="task-card__main">
        <button class="task-select-cb" data-action="toggle-personal-select" data-item-id="${item.id}"
                aria-pressed="${isSelected}" aria-label="${t('tasks.selectTask')}">
          ${isSelected ? '<i data-lucide="check" style="width:12px;height:12px;color:#fff" aria-hidden="true"></i>' : ''}
        </button>
        <button class="task-status-btn task-status-btn--${status}"
                data-action="cycle-personal-item"
                data-next-status="${nextStatus}"
                aria-label="${t('tasks.cycleStatus')}">
          <i data-lucide="${statusIcon}" style="width:12px;height:12px;pointer-events:none" aria-hidden="true"></i>
        </button>
        <div class="task-card__body">
          <div class="task-card__title">
            ${linkify(item.title)}
          </div>
          ${item.description ? `<div class="task-card__description">${linkify(item.description)}</div>` : ''}
          <div class="task-card__meta">
            ${renderPriorityBadge(item.priority ?? 'none')}
            ${due ? `<span class="due-date ${due.cls}">
              <i data-lucide="clock" style="width:11px;height:11px" aria-hidden="true"></i> ${esc(due.label)}
            </span>` : ''}
            ${item.is_recurring ? `<span class="due-date" aria-label="${t('tasks.recurring')}"><i data-lucide="repeat" style="width:12px;height:12px" aria-hidden="true"></i></span>` : ''}
          </div>
        </div>
        ${isShared && item.assigned_color ? `
          <div class="task-avatar" style="background-color:${esc(item.assigned_color)}"
               title="${esc(item.assigned_name)}">
            ${esc(initials(item.assigned_name ?? ''))}
          </div>` : ''}
        ${(!item.priority || item.priority === 'none') && showPriority ? `
        <div class="priority-quick-flags" role="group" aria-label="Set priority">
          <button class="priority-quick-flag priority-quick-flag--urgent" data-action="set-personal-priority" data-priority="urgent" title="Urgent"></button>
          <button class="priority-quick-flag priority-quick-flag--high"   data-action="set-personal-priority" data-priority="high"   title="High"></button>
          <button class="priority-quick-flag priority-quick-flag--medium" data-action="set-personal-priority" data-priority="medium" title="Medium"></button>
          <button class="priority-quick-flag priority-quick-flag--low"    data-action="set-personal-priority" data-priority="low"    title="Low"></button>
        </div>` : ''}
        <button class="btn btn--ghost btn--icon" data-action="delete-personal-item"
                aria-label="Delete"
                style="min-height:unset;width:36px;height:36px;color:var(--color-text-secondary)">
          <i data-lucide="x" style="width:16px;height:16px" aria-hidden="true"></i>
        </button>
      </div>
    </div>`;
}

function renderPersonalItems() {
  const filtered = getFilteredPersonalItems();

  if (!filtered.length) {
    return `<div class="personal-list__empty">${t('tasks.personalListEmpty')}</div>`;
  }

  if (state.personalFilters.status) {
    return `<div class="task-group">${sortTasksForList(filtered).map(renderPersonalItemRow).join('')}</div>`;
  }

  const notDone   = filtered.filter((i) => getPersonalItemStatus(i) !== 'done');
  const pending   = sortTasksForList(notDone.filter((i) => isRecurringTaskDue(i)));
  const notYetDue = sortTasksForList(notDone.filter((i) => !isRecurringTaskDue(i)));
  const done      = sortTasksForList(filtered.filter((i) => getPersonalItemStatus(i) === 'done'));
  let html = '';

  if (pending.length) {
    html += `<div class="task-group">${pending.map(renderPersonalItemRow).join('')}</div>`;
  }
  if (notYetDue.length) {
    html += `
      <div class="task-group">
        <div class="task-group__divider">
          <span>${t('tasks.notYetDue')}</span>
        </div>
        ${notYetDue.map(renderPersonalItemRow).join('')}
      </div>`;
  }
  if (done.length) {
    html += `
      <div class="task-group task-group--done">
        <div class="task-group__divider">
          <span>${t('tasks.personalListDoneSection')} (${done.length})</span>
          <button class="btn btn--ghost personal-list__clear-btn" data-action="clear-done-items">
            <i data-lucide="trash-2" style="width:14px;height:14px" aria-hidden="true"></i>
            ${t('tasks.personalListClearDone')}
          </button>
        </div>
        ${done.map(renderPersonalItemRow).join('')}
      </div>`;
  }
  return html;
}

// --------------------------------------------------------
// Personal List — filters + kanban
// --------------------------------------------------------

function getFilteredPersonalItems() {
  let items = state.personalItems;
  if (state.personalFilters.status) {
    items = items.filter((i) => getPersonalItemStatus(i) === state.personalFilters.status);
  }
  if (state.personalFilters.priority) items = items.filter((i) => i.priority === state.personalFilters.priority);
  if (state.personalFilters.assigned_to) items = items.filter((i) => String(i.assigned_to) === state.personalFilters.assigned_to);
  const query = normalizeSearch(state.personalSearch);
  if (query) items = items.filter((i) => personalItemMatchesSearch(i, query));
  return items;
}

function renderPersonalFilters(container) {
  const menu = container.querySelector('#personal-filter-menu');
  if (!menu) return;

  const list = state.taskLists.find((l) => l.id === state.activeTab);
  const isShared = list && (!list.is_owner || (list.shared_user_ids?.length > 0));

  const sections = [];
  const priorityLabels = PRIORITY_LABELS();

  sections.push(`<div class="filter-dropdown__section">
    <div class="filter-dropdown__title">${t('tasks.statusLabel')}</div>`);
  PERSONAL_STATUSES().forEach((s) => {
    const isActive = state.personalFilters.status === s.value;
    sections.push(`<label class="filter-option">
      <input type="radio" name="personal-status" value="${s.value}" ${isActive ? 'checked' : ''} data-personal-filter="status">
      <span class="filter-option__label">${s.label}</span>
    </label>`);
  });
  sections.push(`<label class="filter-option">
    <input type="radio" name="personal-status" value="" ${!state.personalFilters.status ? 'checked' : ''} data-personal-filter="status">
    <span class="filter-option__label">${t('tasks.clearFilter')}</span>
  </label></div>`);

  sections.push(`<div class="filter-dropdown__section">
    <div class="filter-dropdown__title">${t('tasks.priorityLabel')}</div>`);
  ['urgent', 'high', 'medium', 'low', 'none'].forEach((p) => {
    const isActive = state.personalFilters.priority === p;
    sections.push(`<label class="filter-option">
      <input type="radio" name="personal-priority" value="${p}" ${isActive ? 'checked' : ''} data-personal-filter="priority">
      <span class="filter-option__label">${priorityLabels[p] ?? p}</span>
    </label>`);
  });
  sections.push(`<label class="filter-option">
    <input type="radio" name="personal-priority" value="" ${!state.personalFilters.priority ? 'checked' : ''} data-personal-filter="priority">
    <span class="filter-option__label">${t('tasks.clearFilter')}</span>
  </label></div>`);

  if (isShared && state.users.length > 1) {
    sections.push(`<div class="filter-dropdown__section">
      <div class="filter-dropdown__title">${t('tasks.assignedLabel')}</div>`);
    state.users.forEach((u) => {
      const isActive = state.personalFilters.assigned_to === String(u.id);
      sections.push(`<label class="filter-option">
        <input type="radio" name="personal-assigned" value="${u.id}" ${isActive ? 'checked' : ''} data-personal-filter="assigned_to">
        <span class="filter-option__label">${u.display_name}</span>
      </label>`);
    });
    sections.push(`<label class="filter-option">
      <input type="radio" name="personal-assigned" value="" ${!state.personalFilters.assigned_to ? 'checked' : ''} data-personal-filter="assigned_to">
      <span class="filter-option__label">${t('tasks.clearFilter')}</span>
    </label></div>`);
  }

  menu.innerHTML = sections.join('');
  wirePersonalFilterDropdown(container);
}

function wirePersonalFilterDropdown(container) {
  const inputs = container.querySelectorAll('#personal-filter-menu input[type="radio"]');
  inputs.forEach((input) => {
    input.addEventListener('change', () => {
      const filter = input.dataset.personalFilter;
      state.personalFilters[filter] = input.value;
      renderPersonalFilters(container);
      refreshPersonalItems(container);
    });
  });
}

function renderPersonalKanbanCard(item) {
  const due  = formatPersonalDueDate(item.due_date);
  const status = getPersonalItemStatus(item);
  const nextStatus = PERSONAL_STATUS_CYCLE[status] ?? 'open';
  const icon = PERSONAL_STATUS_ICON[status] ?? 'circle';
  return `
    <div class="kanban-card ${status === 'done' ? 'kanban-card--done' : ''}"
         data-item-id="${item.id}" draggable="true" data-action="open-personal-item">
      <div class="kanban-card__header">
        <div class="kanban-card__title">${linkify(item.title)}</div>
        <button class="kanban-card__status-btn" data-action="cycle-personal-item"
                data-next-status="${nextStatus}"
                aria-label="${t('tasks.cycleStatus')}">
          <i data-lucide="${icon}" style="width:14px;height:14px;pointer-events:none" aria-hidden="true"></i>
        </button>
      </div>
      ${item.description ? `<div class="kanban-card__description">${linkify(item.description)}</div>` : ''}
      <div class="kanban-card__meta">
        ${renderPriorityBadge(item.priority ?? 'none')}
        ${due ? `<span class="due-date ${due.cls}">
          <i data-lucide="clock" style="width:10px;height:10px" aria-hidden="true"></i> ${esc(due.label)}
        </span>` : ''}
      </div>
    </div>`;
}

function renderPersonalKanban(container) {
  const wrap = container.querySelector('#personal-items-container');
  if (!wrap) return;

  const filtered = getFilteredPersonalItems();
  const open = sortTasksForList(filtered.filter((i) => getPersonalItemStatus(i) === 'open'));
  const inProgress = sortTasksForList(filtered.filter((i) => getPersonalItemStatus(i) === 'in_progress'));
  const done = sortTasksForList(filtered.filter((i) => getPersonalItemStatus(i) === 'done'));

  wrap.innerHTML = `
    <div class="kanban-board">
      <div class="kanban-col" data-status="open">
        <div class="kanban-col__header">
          <span class="kanban-col__title" style="color:var(--color-text-secondary)">
            ${t('tasks.kanbanOpen')}
          </span>
          <span class="kanban-col__count">${open.length}</span>
        </div>
        <div class="kanban-col__body" data-personal-drop="open">
          ${open.map(renderPersonalKanbanCard).join('')}
          <div class="kanban-drop-placeholder" hidden></div>
        </div>
      </div>
      <div class="kanban-col" data-status="in_progress">
        <div class="kanban-col__header">
          <span class="kanban-col__title" style="color:#c2410c">
            ${t('tasks.kanbanInProgress')}
          </span>
          <span class="kanban-col__count">${inProgress.length}</span>
        </div>
        <div class="kanban-col__body" data-personal-drop="in_progress">
          ${inProgress.map(renderPersonalKanbanCard).join('')}
          <div class="kanban-drop-placeholder" hidden></div>
        </div>
      </div>
      <div class="kanban-col" data-status="done">
        <div class="kanban-col__header">
          <span class="kanban-col__title" style="color:var(--color-success)">
            ${t('tasks.kanbanDone')}
          </span>
          <span class="kanban-col__count">${done.length}</span>
        </div>
        <div class="kanban-col__body" data-personal-drop="done">
          ${done.map(renderPersonalKanbanCard).join('')}
          <div class="kanban-drop-placeholder" hidden></div>
        </div>
      </div>
    </div>`;

  if (window.lucide) window.lucide.createIcons();
  wirePersonalKanbanDrag(container);
}

let _personalDragItemId = null;

function wirePersonalKanbanDrag(container) {
  const wrap = container.querySelector('#personal-items-container');
  if (!wrap) return;
  const board = wrap.querySelector('.kanban-board');
  if (!board) return;

  board.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.kanban-card[data-item-id]');
    if (!card) return;
    _personalDragItemId = parseInt(card.dataset.itemId, 10);
    card.classList.add('kanban-card--dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  board.addEventListener('dragend', (e) => {
    const card = e.target.closest('.kanban-card[data-item-id]');
    if (card) card.classList.remove('kanban-card--dragging');
    board.querySelectorAll('.kanban-col__body--over').forEach((el) =>
      el.classList.remove('kanban-col__body--over')
    );
    _personalDragItemId = null;
  });

  board.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const zone = e.target.closest('[data-personal-drop]');
    if (!zone) return;
    board.querySelectorAll('.kanban-col__body--over').forEach((el) =>
      el.classList.remove('kanban-col__body--over')
    );
    zone.classList.add('kanban-col__body--over');
  });

  board.addEventListener('dragleave', (e) => {
    const zone = e.target.closest('[data-personal-drop]');
    if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('kanban-col__body--over');
  });

  board.addEventListener('drop', async (e) => {
    e.preventDefault();
    const zone = e.target.closest('[data-personal-drop]');
    if (!zone || !_personalDragItemId) return;
    zone.classList.remove('kanban-col__body--over');

    const newStatus = zone.dataset.personalDrop;
    const itemId  = _personalDragItemId;
    const item    = state.personalItems.find((i) => i.id === itemId);
    if (!item || getPersonalItemStatus(item) === newStatus) return;

    const previousStatus = getPersonalItemStatus(item);
    const wasDone = previousStatus === 'done';
    setPersonalItemStatus(item, newStatus);
    const list = state.taskLists.find((l) => l.id === state.activeTab);
    if (list && wasDone !== (newStatus === 'done')) {
      list.pending_count += newStatus === 'done' ? -1 : 1;
      renderTaskTabsBar(container);
    }
    renderPersonalKanban(container);

    try {
      await api.patch(`/personal-lists/${state.activeTab}/items/${itemId}`, { status: newStatus });
    } catch (err) {
      setPersonalItemStatus(item, previousStatus);
      if (list && wasDone !== (newStatus === 'done')) {
        list.pending_count += newStatus === 'done' ? 1 : -1;
        renderTaskTabsBar(container);
      }
      renderPersonalKanban(container);
      window.planium.showToast(err.message, 'danger');
    }
  });
}

function renderPersonalView(container) {
  const list = state.taskLists.find((l) => l.id === state.activeTab);
  const content = container.querySelector('#tasks-content');
  if (!content) return;
  if (!list) return;

  const isOwner = !!list.is_owner;

  const titleEl = isOwner
    ? `<h1 class="tasks-toolbar__title" data-action="edit-list" role="button" tabindex="0"
           style="cursor:pointer" title="${t('tasks.renamePersonalList')}">
         ${esc(list.name)}
       </h1>`
    : `<h1 class="tasks-toolbar__title">${esc(list.name)}</h1>`;

  const sharedByBadge = !isOwner && list.owner_name
    ? `<span class="personal-list__shared-by">
         <i data-lucide="users" style="width:12px;height:12px" aria-hidden="true"></i>
         ${esc(t('tasks.sharedByLabel', { name: list.owner_name }))}
       </span>`
    : '';

  const ownerActions = isOwner ? `
    <button class="btn btn--ghost btn--icon" data-action="share-list"
            aria-label="${t('tasks.sharePersonalList')}" title="${t('tasks.sharePersonalList')}"
            style="color:var(--color-text-secondary)">
      <i data-lucide="user-plus" style="width:18px;height:18px" aria-hidden="true"></i>
    </button>
    <button class="btn btn--ghost btn--icon" data-action="delete-list"
            aria-label="${t('common.delete')}" title="${t('common.delete')}"
            style="color:var(--color-text-secondary)">
      <i data-lucide="trash" style="width:18px;height:18px" aria-hidden="true"></i>
    </button>` : '';

  content.innerHTML = `
    <div class="personal-list" style="--list-color:${esc(list.color)};--module-accent:${esc(list.color)}">
      <div class="tasks-toolbar">
        <div class="tasks-toolbar__heading">
          <span class="personal-list__color-dot" aria-hidden="true"></span>
          ${titleEl}
          ${sharedByBadge}
        </div>
        <div class="tasks-toolbar__actions">
          ${renderToolbarSearch({
            scope: 'personal',
            open: state.personalSearchOpen,
            value: state.personalSearch,
            label: t('tasks.searchPersonalLabel'),
            placeholder: t('tasks.searchPersonalPlaceholder'),
          })}
          <div class="group-toggle" id="personal-view-toggle">
            <button class="group-toggle__btn ${state.personalViewMode === 'list' ? 'group-toggle__btn--active' : ''}"
                    data-personal-view="list"
                    title="${t('tasks.listView')}" aria-label="${t('tasks.listView')}">
              <i data-lucide="list" style="width:14px;height:14px;pointer-events:none" aria-hidden="true"></i>
            </button>
            <button class="group-toggle__btn ${state.personalViewMode === 'kanban' ? 'group-toggle__btn--active' : ''}"
                    data-personal-view="kanban"
                    title="${t('tasks.kanbanView')}" aria-label="${t('tasks.kanbanView')}">
              <i data-lucide="columns" style="width:14px;height:14px;pointer-events:none" aria-hidden="true"></i>
            </button>
          </div>
          <div class="filter-dropdown" id="personal-filter-dropdown">
            <button class="btn btn--ghost btn--icon filter-dropdown__btn" id="personal-btn-filter"
                    aria-label="${t('tasks.filterLabel')}" aria-pressed="false"
                    title="${t('tasks.filterLabel')}">
              <i data-lucide="filter" style="width:18px;height:18px" aria-hidden="true"></i>
            </button>
            <div class="filter-dropdown__menu" id="personal-filter-menu"></div>
          </div>
          <button class="btn btn--ghost btn--icon tasks-toolbar__select-btn" id="personal-btn-select"
                  aria-label="${t('tasks.selectMode')}" aria-pressed="false"
                  title="${t('tasks.selectMode')}">
            <i data-lucide="check-square" style="width:18px;height:18px" aria-hidden="true"></i>
          </button>
          <span class="bulk-bar__count tasks-toolbar__bulk-count" id="personal-bulk-count" hidden></span>
          <button class="btn btn--danger tasks-toolbar__bulk-btn" id="personal-btn-bulk-delete" hidden>${t('tasks.bulkDelete')}</button>
          ${ownerActions}
        </div>
      </div>

      <form class="personal-list__add" data-action="add-personal-item" novalidate autocomplete="off">
        <input class="personal-list__add-input" type="text" name="title"
               placeholder="${t('tasks.personalListAddPlaceholder')}"
               maxlength="600" autocomplete="off">
        <button class="personal-list__add-btn" type="submit"
                aria-label="${t('tasks.personalListAdd')}">
          <i data-lucide="plus" style="width:20px;height:20px;pointer-events:none" aria-hidden="true"></i>
        </button>
      </form>

      <div id="personal-items-container"></div>
    </div>
    <button class="page-fab" id="fab-new-personal-item" aria-label="${t('tasks.personalListAdd')}">
      <i data-lucide="plus" style="width:24px;height:24px" aria-hidden="true"></i>
    </button>
  `;

  if (window.lucide) window.lucide.createIcons();
  renderPersonalFilters(container);
  wirePersonalFilterDropdownToggle(container);
  refreshPersonalItems(container);
  wirePersonalView(container);

  if (window.matchMedia('(min-width: 1024px)').matches) {
    content.querySelector('.personal-list__add-input')?.focus();
  }
}

function updatePersonalBulkBar(container) {
  const view = container.querySelector('.personal-list');
  if (!view) return;
  const inSelect = state.personalSelectMode;
  view.classList.toggle('personal-list--select-mode', inSelect);
  const viewToggle = view.querySelector('#personal-view-toggle');
  const search = view.querySelector('[data-search-scope="personal"]');
  if (viewToggle) viewToggle.hidden = inSelect;
  if (search) search.hidden = inSelect;
  const countEl   = view.querySelector('#personal-bulk-count');
  const deleteBtn = view.querySelector('#personal-btn-bulk-delete');
  if (countEl)   { countEl.hidden   = !inSelect; countEl.textContent = t('tasks.selectedCount', { count: state.personalSelectedIds.size }); }
  if (deleteBtn)  deleteBtn.hidden  = !inSelect;
}

function refreshPersonalItems(container) {
  if (state.personalViewMode === 'kanban') {
    renderPersonalKanban(container);
  } else {
    const wrap = container.querySelector('#personal-items-container');
    if (wrap) wrap.innerHTML = renderPersonalItems();
    if (window.lucide) window.lucide.createIcons();
  }
}

function wirePersonalFilterDropdownToggle(container) {
  const dropdown = container.querySelector('#personal-filter-dropdown');
  const btn = container.querySelector('#personal-btn-filter');
  const menu = container.querySelector('#personal-filter-menu');
  if (!dropdown || !btn || !menu) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = menu.classList.contains('filter-dropdown__menu--open');
    menu.classList.toggle('filter-dropdown__menu--open', !isOpen);
    btn.setAttribute('aria-pressed', !isOpen);
  });

  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target)) {
      menu.classList.remove('filter-dropdown__menu--open');
      btn.setAttribute('aria-pressed', 'false');
    }
  });
}

function openFabListMenu(container) {
  container.querySelector('#fab-list-menu')?.remove();

  const el = document.createElement('div');
  el.id = 'fab-list-menu';
  el.innerHTML = `
    <div class="fab-list-menu__backdrop"></div>
    <div class="fab-list-menu__panel">
      ${state.taskLists.map((l) => `
        <button class="fab-list-menu__item" data-list-id="${l.id}">
          <span class="fab-list-menu__dot" style="background:${esc(l.color)}"></span>
          <span class="fab-list-menu__name">${esc(l.name)}</span>
          ${l.pending_count > 0 ? `<span class="fab-list-menu__count">${l.pending_count}</span>` : ''}
        </button>
      `).join('')}
      <button class="fab-list-menu__item fab-list-menu__new" data-action="new-list">
        <span class="fab-list-menu__dot fab-list-menu__dot--new">
          <i data-lucide="plus" style="width:12px;height:12px" aria-hidden="true"></i>
        </span>
        <span class="fab-list-menu__name">${t('tasks.newPersonalList')}</span>
      </button>
    </div>
  `;

  container.appendChild(el);
  if (window.lucide) window.lucide.createIcons({ nodes: [el] });

  el.querySelector('.fab-list-menu__backdrop').addEventListener('click', () => el.remove());

  el.querySelectorAll('[data-list-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      el.remove();
      const listId = parseInt(btn.dataset.listId, 10);
      openItemEditDialog({
        item: {},
        container,
        listId,
        onSaved: async () => {
          const lst = state.taskLists.find((l) => l.id === listId);
          if (state.activeTab !== listId) {
            state.activeTab = listId;
            state.personalFilters = { status: '', priority: '', assigned_to: '' };
            localStorage.setItem('tasks-active-tab', String(listId));
            renderTaskTabsBar(container);
            await loadPersonalItems(listId);
            renderPersonalView(container);
          } else {
            refreshPersonalItems(container);
          }
          if (lst) renderTaskTabsBar(container);
        },
      });
    });
  });

  el.querySelector('[data-action="new-list"]')?.addEventListener('click', () => {
    el.remove();
    openListDialog({ container });
  });
}

function wirePersonalView(container) {
  const view = container.querySelector('.personal-list');
  if (!view) return;

  wireToolbarSearch(container, {
    scope: 'personal',
    valueKey: 'personalSearch',
    openKey: 'personalSearchOpen',
    refresh: () => refreshPersonalItems(container),
  });

  // View toggle
  const toggle = view.querySelector('#personal-view-toggle');
  toggle?.querySelectorAll('[data-personal-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.personalViewMode = btn.dataset.personalView;
      localStorage.setItem('personal-view', state.personalViewMode);
      toggle.querySelectorAll('[data-personal-view]').forEach((b) => {
        b.classList.toggle('group-toggle__btn--active', b.dataset.personalView === state.personalViewMode);
      });
      refreshPersonalItems(container);
    });
  });

  // Select mode toggle
  const selectBtn = view.querySelector('#personal-btn-select');
  selectBtn?.addEventListener('click', () => {
    state.personalSelectMode = !state.personalSelectMode;
    if (!state.personalSelectMode) state.personalSelectedIds.clear();
    selectBtn.classList.toggle('btn--primary', state.personalSelectMode);
    selectBtn.setAttribute('aria-pressed', String(state.personalSelectMode));
    refreshPersonalItems(container);
    updatePersonalBulkBar(container);
  });

  // Bulk delete
  view.querySelector('#personal-btn-bulk-delete')?.addEventListener('click', async () => {
    const count = state.personalSelectedIds.size;
    if (!count) return;
    if (!await showConfirm(t('tasks.bulkDeleteConfirm', { count }), { danger: true })) return;
    const ids = [...state.personalSelectedIds];
    try {
      await Promise.all(ids.map((id) => api.delete(`/personal-lists/${state.activeTab}/items/${id}`)));
      const removedItems = state.personalItems.filter((i) => ids.includes(i.id));
      const pendingRemoved = removedItems.filter((i) => getPersonalItemStatus(i) !== 'done').length;
      state.personalItems = state.personalItems.filter((i) => !ids.includes(i.id));
      state.personalSelectedIds.clear();
      state.personalSelectMode = false;
      if (selectBtn) { selectBtn.classList.remove('btn--primary'); selectBtn.setAttribute('aria-pressed', 'false'); }
      const list = state.taskLists.find((l) => l.id === state.activeTab);
      if (list) {
        list.pending_count = Math.max(0, list.pending_count - pendingRemoved);
        list.total_count   = Math.max(0, list.total_count - ids.length);
        renderTaskTabsBar(container);
      }
      refreshPersonalItems(container);
      updatePersonalBulkBar(container);
      window.planium.showToast(t('tasks.bulkDeletedToast', { count }), 'default');
    } catch (err) {
      window.planium.showToast(err.message, 'danger');
    }
  });

  // Quick-add form
  view.querySelector('.personal-list__add')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.currentTarget.querySelector('.personal-list__add-input');
    const title = input.value.trim();
    if (!title) return;
    const listId = state.activeTab;
    input.value = '';
    try {
      const res = await api.post(`/personal-lists/${listId}/items`, { title });
      state.personalItems.push(res.data);
      refreshPersonalItems(container);
      const list = state.taskLists.find((l) => l.id === listId);
      if (list) { list.pending_count++; list.total_count++; renderTaskTabsBar(container); }
      input.focus();
    } catch (err) {
      window.planium.showToast(err.message, 'danger');
    }
  });

  // FAB — opens list picker menu
  container.querySelector('#fab-new-personal-item')?.addEventListener('click', () => {
    openFabListMenu(container);
  });

  // Delegated click handler
  view.addEventListener('click', async (e) => {
    if (e.target.closest('a[href]')) return;

    const target = e.target.closest('[data-action]');
    const action = target?.dataset.action;

    // In select mode: clicking a card row toggles selection
    if (state.personalSelectMode && !action) {
      const card = e.target.closest('.task-card[data-item-id]');
      if (card) {
        const itemId = parseInt(card.dataset.itemId, 10);
        if (state.personalSelectedIds.has(itemId)) state.personalSelectedIds.delete(itemId);
        else state.personalSelectedIds.add(itemId);
        refreshPersonalItems(container);
        updatePersonalBulkBar(container);
      }
      return;
    }

    // Kanban card body click (no action button) → open edit dialog
    if (!action) {
      const kanbanCard = e.target.closest('.kanban-card[data-item-id]');
      if (kanbanCard) {
        const itemId = parseInt(kanbanCard.dataset.itemId, 10);
        const item = state.personalItems.find((i) => i.id === itemId);
        if (item) openItemEditDialog({ item, container });
      }
      return;
    }

    if (action === 'toggle-personal-select') {
      const itemId = parseInt(target.dataset.itemId, 10);
      if (state.personalSelectedIds.has(itemId)) state.personalSelectedIds.delete(itemId);
      else state.personalSelectedIds.add(itemId);
      refreshPersonalItems(container);
      updatePersonalBulkBar(container);
      return;
    }

    if (state.personalSelectMode) return; // block all other actions in select mode

    if (action === 'edit-list') {
      const list = state.taskLists.find((l) => l.id === state.activeTab);
      if (list && list.is_owner) openListDialog({ list, container });
      return;
    }
    if (action === 'share-list') {
      const list = state.taskLists.find((l) => l.id === state.activeTab);
      if (list && list.is_owner) openShareDialog({ list, container });
      return;
    }
    if (action === 'delete-list') {
      const ok = await showConfirm(t('tasks.deletePersonalListConfirm'), { danger: true });
      if (!ok) return;
      try {
        await api.delete(`/personal-lists/${state.activeTab}`);
        state.taskLists = state.taskLists.filter((l) => l.id !== state.activeTab);
        const householdList = state.taskLists.find((l) => l.is_household) ?? state.taskLists[0];
        state.activeTab = householdList?.id ?? null;
        localStorage.setItem('tasks-active-tab', String(state.activeTab));
        renderTaskTabsBar(container);
        if (state.activeTab) await loadPersonalItems(state.activeTab);
        renderPersonalView(container);
        window.planium.showToast(t('tasks.personalListDeletedToast'), 'default');
      } catch (err) {
        window.planium.showToast(err.message, 'danger');
      }
      return;
    }
    if (action === 'clear-done-items') {
      const ok = await showConfirm(t('tasks.personalListClearDoneConfirm'), { danger: true });
      if (!ok) return;
      try {
        await api.post(`/personal-lists/${state.activeTab}/clear-done`, {});
        state.personalItems = state.personalItems.filter((i) => getPersonalItemStatus(i) !== 'done');
        refreshPersonalItems(container);
      } catch (err) {
        window.planium.showToast(err.message, 'danger');
      }
      return;
    }

    // Item-level actions — find item ID from closest [data-item-id] container
    const row = target.closest('[data-item-id]');
    const itemId = row ? parseInt(row.dataset.itemId, 10) : null;
    if (!itemId) return;

    if (action === 'cycle-personal-item') {
      const item = state.personalItems.find((i) => i.id === itemId);
      if (!item) return;
      const currentStatus = getPersonalItemStatus(item);
      const newStatus = target.dataset.nextStatus || PERSONAL_STATUS_CYCLE[currentStatus] || 'open';
      const wasRecurring = item.is_recurring && item.recurrence_rule;
      const wasDone = currentStatus === 'done';
      setPersonalItemStatus(item, newStatus);
      refreshPersonalItems(container);
      const list = state.taskLists.find((l) => l.id === state.activeTab);
      if (list && wasDone !== (newStatus === 'done')) {
        list.pending_count += newStatus === 'done' ? -1 : 1;
        renderTaskTabsBar(container);
      }
      try {
        const res = await api.patch(`/personal-lists/${state.activeTab}/items/${itemId}`, { status: newStatus });
        // Server may have rescheduled a recurring item — sync state
        const resStatus = res.data?.status ?? (res.data?.done ? 'done' : 'open');
        if (wasRecurring && newStatus === 'done' && resStatus !== 'done') {
          Object.assign(item, res.data);
          if (list) {
            list.pending_count++;
            renderTaskTabsBar(container);
          }
          refreshPersonalItems(container);
        }
      } catch (err) {
        setPersonalItemStatus(item, currentStatus);
        if (list && wasDone !== (newStatus === 'done')) {
          list.pending_count += newStatus === 'done' ? 1 : -1;
          renderTaskTabsBar(container);
        }
        refreshPersonalItems(container);
        window.planium.showToast(err.message, 'danger');
      }
      return;
    }
    if (action === 'delete-personal-item') {
      try {
        await api.delete(`/personal-lists/${state.activeTab}/items/${itemId}`);
        const removed = state.personalItems.find((i) => i.id === itemId);
        state.personalItems = state.personalItems.filter((i) => i.id !== itemId);
        refreshPersonalItems(container);
        const list = state.taskLists.find((l) => l.id === state.activeTab);
        if (list) {
          if (removed && getPersonalItemStatus(removed) !== 'done') list.pending_count = Math.max(0, list.pending_count - 1);
          list.total_count = Math.max(0, list.total_count - 1);
          renderTaskTabsBar(container);
        }
      } catch (err) {
        window.planium.showToast(err.message, 'danger');
      }
      return;
    }
    if (action === 'open-personal-item') {
      const card = target.closest('.task-card[data-item-id]');
      if (card && selectionIsInsideElement(card)) return;
      const item = state.personalItems.find((i) => i.id === itemId);
      if (item) openItemEditDialog({ item, container });
      return;
    }
    if (action === 'edit-personal-item') {
      const item = state.personalItems.find((i) => i.id === itemId);
      if (item) openItemEditDialog({ item, container });
      return;
    }
    if (action === 'set-personal-priority') {
      const priority = target.dataset.priority;
      const item = state.personalItems.find((i) => i.id === itemId);
      if (!item || !priority) return;
      item.priority = priority;
      refreshPersonalItems(container);
      try {
        await api.patch(`/personal-lists/${state.activeTab}/items/${itemId}`, { priority });
      } catch (err) {
        item.priority = 'none';
        refreshPersonalItems(container);
        window.planium.showToast(err.message, 'danger');
      }
      return;
    }
  });
}

// --------------------------------------------------------
// New / Rename Personal List Dialog
// --------------------------------------------------------

function openHouseholdDialog({ container } = {}) {
  const currentName  = state.householdName || t('tasks.tabHousehold');
  const currentColor = state.householdColor;

  const swatches = PERSONAL_LIST_COLORS.map((c) => `
    <button type="button" class="color-swatch ${c === currentColor ? 'color-swatch--active' : ''}"
            data-color="${c}" style="background-color:${c}" aria-label="${c}"></button>
  `).join('');

  openSharedModal({
    title: t('tasks.renameHousehold'),
    size: 'sm',
    content: `
      <form id="household-form" novalidate autocomplete="off">
        <div class="form-group">
          <label class="label" for="household-name">${t('tasks.personalListNameLabel')}</label>
          <input class="input" type="text" id="household-name" name="name"
                 value="${esc(currentName)}"
                 required maxlength="600" autocomplete="off">
        </div>

        <div class="form-group">
          <label class="label">${t('tasks.personalListColorLabel')}</label>
          <div class="color-swatches" id="household-swatches">${swatches}</div>
          <input type="hidden" id="household-color" value="${esc(currentColor)}">
        </div>

        <div class="form-group" style="margin-bottom:0">
          <label class="label" style="display:flex;align-items:center;gap:var(--space-3);cursor:pointer">
            <input type="checkbox" id="household-show-priority" ${state.householdShowPriority ? 'checked' : ''}>
            ${t('tasks.personalListShowPriority')}
          </label>
        </div>

        <div id="household-form-error" class="login-error" hidden></div>
        <div class="modal-panel__footer" style="padding:0;border:none;margin-top:var(--space-6);display:flex;justify-content:space-between;align-items:center;gap:var(--space-3)">
          <button type="button" class="btn btn--ghost" id="household-delete-btn"
                  style="color:var(--color-danger)">${t('common.delete')}</button>
          <button type="submit" class="btn btn--primary">${t('common.save')}</button>
        </div>
      </form>
    `,
    onSave(panel) {
      // Color swatches
      const swatchesEl = panel.querySelector('#household-swatches');
      const colorInput = panel.querySelector('#household-color');
      swatchesEl?.addEventListener('click', (e) => {
        const swatch = e.target.closest('.color-swatch');
        if (!swatch) return;
        swatchesEl.querySelectorAll('.color-swatch--active')
          .forEach((s) => s.classList.remove('color-swatch--active'));
        swatch.classList.add('color-swatch--active');
        colorInput.value = swatch.dataset.color;
      });

      // Delete all tasks
      panel.querySelector('#household-delete-btn')?.addEventListener('click', async () => {
        const ok = await showConfirm(
          t('tasks.deleteHouseholdConfirm') ?? 'Delete ALL household tasks permanently? This cannot be undone.',
          { danger: true }
        );
        if (!ok) return;
        try {
          await api.delete('/tasks');
          state.tasks = [];
          closeModal();
          renderTaskList(container);
          window.planium.showToast(t('tasks.deletedToast'), 'default');
        } catch (err) {
          panel.querySelector('#household-form-error').textContent = err.message;
          panel.querySelector('#household-form-error').hidden = false;
        }
      });

      panel.querySelector('#household-form')
        ?.addEventListener('submit', (e) => {
          e.preventDefault();
          const errEl = panel.querySelector('#household-form-error');
          const name  = panel.querySelector('#household-name').value.trim();
          if (!name) {
            errEl.textContent = t('common.required');
            errEl.hidden = false;
            return;
          }
          const color        = colorInput.value;
          const showPriority = panel.querySelector('#household-show-priority').checked;
          state.householdName         = name;
          state.householdColor        = color;
          state.householdShowPriority = showPriority;
          localStorage.setItem('household-name',          name);
          localStorage.setItem('household-color',         color);
          localStorage.setItem('household-show-priority', showPriority ? '1' : '0');
          renderTaskTabsBar(container);
          renderHouseholdView(container);
          closeModal();
          window.planium.showToast(t('tasks.savedToast'), 'success');
        });
    },
  });
}

function openHouseholdShareDialog({ container } = {}) {
  const userRows = (state.users || []).map((u) => `
    <div class="share-user-row">
      <span class="share-user-row__avatar" style="background-color:${esc(u.avatar_color || '#888')}">
        ${esc(initials(u.display_name || ''))}
      </span>
      <span class="share-user-row__name">${esc(u.display_name)}</span>
    </div>`).join('') || `<div class="share-empty">${t('tasks.shareDialogEmpty')}</div>`;

  openSharedModal({
    title: t('tasks.sharePersonalList'),
    size: 'sm',
    content: `
      <p class="share-help">${t('tasks.shareDialogHelp')}</p>
      <div class="share-user-list">${userRows}</div>
      <div class="modal-panel__footer" style="padding:0;border:none;margin-top:var(--space-6)">
        <button type="button" class="btn btn--primary" id="household-share-close">${t('common.close') ?? 'Close'}</button>
      </div>
    `,
    onSave(panel) {
      panel.querySelector('#household-share-close')?.addEventListener('click', () => closeModal());
      if (window.lucide) window.lucide.createIcons();
    },
  });
}

function openListDialog({ list = null, container } = {}) {
  const isEdit = !!list;
  const currentColor = list?.color ?? PERSONAL_LIST_COLORS[0];

  const swatches = PERSONAL_LIST_COLORS.map((c) => `
    <button type="button" class="color-swatch ${c === currentColor ? 'color-swatch--active' : ''}"
            data-color="${c}" style="background-color:${c}"
            aria-label="${c}"></button>
  `).join('');

  openSharedModal({
    title: isEdit ? t('tasks.renamePersonalList') : t('tasks.newPersonalListTitle'),
    size: 'sm',
    content: `
      <form id="personal-list-form" novalidate autocomplete="off">
        <div class="form-group">
          <label class="label" for="personal-list-name">${t('tasks.personalListNameLabel')}</label>
          <input class="input" type="text" id="personal-list-name" name="name"
                 value="${esc(list?.name ?? '')}"
                 placeholder="${t('tasks.personalListNamePlaceholder')}"
                 required maxlength="600" autocomplete="off">
        </div>

        <div class="form-group">
          <label class="label">${t('tasks.personalListColorLabel')}</label>
          <div class="color-swatches" id="color-swatches">${swatches}</div>
          <input type="hidden" id="personal-list-color" value="${currentColor}">
        </div>

        <div class="form-group" style="margin-bottom:0">
          <label class="label" style="display:flex;align-items:center;gap:var(--space-3);cursor:pointer">
            <input type="checkbox" id="personal-list-show-priority" ${(list?.show_priority ?? 1) ? 'checked' : ''}>
            ${t('tasks.personalListShowPriority')}
          </label>
        </div>

        <div id="personal-list-form-error" class="login-error" hidden></div>

        <div class="modal-panel__footer" style="padding:0;border:none;margin-top:var(--space-6)">
          <button type="submit" class="btn btn--primary" id="personal-list-submit">
            ${isEdit ? t('common.save') : t('common.create')}
          </button>
        </div>
      </form>
    `,
    onSave(panel) {
      // Color swatch picker
      const swatchesEl = panel.querySelector('#color-swatches');
      const colorInput = panel.querySelector('#personal-list-color');
      swatchesEl?.addEventListener('click', (e) => {
        const swatch = e.target.closest('.color-swatch');
        if (!swatch) return;
        swatchesEl.querySelectorAll('.color-swatch--active')
          .forEach((s) => s.classList.remove('color-swatch--active'));
        swatch.classList.add('color-swatch--active');
        colorInput.value = swatch.dataset.color;
      });

      // Form submit
      panel.querySelector('#personal-list-form')
        ?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const errEl = panel.querySelector('#personal-list-form-error');
          const btn   = panel.querySelector('#personal-list-submit');
          errEl.hidden = true;
          btn.disabled = true;

          const name          = panel.querySelector('#personal-list-name').value.trim();
          const color         = colorInput.value;
          const show_priority = panel.querySelector('#personal-list-show-priority').checked ? 1 : 0;
          if (!name) {
            errEl.textContent = t('common.required');
            errEl.hidden = false;
            btn.disabled = false;
            return;
          }

          try {
            if (isEdit) {
              const res = await api.put(`/personal-lists/${list.id}`, { name, color, show_priority });
              const idx = state.taskLists.findIndex((l) => l.id === list.id);
              if (idx >= 0) state.taskLists[idx] = { ...state.taskLists[idx], ...res.data };
              renderTaskTabsBar(container);
              renderPersonalView(container);
              window.planium.showToast(t('tasks.savedToast'), 'success');
            } else {
              const res = await api.post('/personal-lists', { name, color, show_priority });
              state.taskLists.push(res.data);
              state.activeTab = res.data.id;
              localStorage.setItem('tasks-active-tab', String(res.data.id));
              state.personalItems = [];
              renderTaskTabsBar(container);
              renderPersonalView(container);
              window.planium.showToast(t('tasks.personalListCreatedToast'), 'success');
            }
            closeModal();
          } catch (err) {
            errEl.textContent = err.message;
            errEl.hidden = false;
            btn.disabled = false;
          }
        });
    },
  });
}

// --------------------------------------------------------
// Edit Personal Item Dialog (title + optional priority + due date)
// --------------------------------------------------------

export function openItemEditDialog({ item, container, listId = null, onSaved = null, onDeleted = null }) {
  const targetListId = listId ?? state.activeTab;
  const list = state.taskLists.find((l) => l.id === targetListId);
  const isShared = list && (!list.is_owner || (list.shared_user_ids?.length > 0));

  const priorityOptions = PRIORITIES().map((p) =>
    `<option value="${p.value}" ${(item.priority ?? 'none') === p.value ? 'selected' : ''}>${p.label}</option>`
  ).join('');

  const assignedOptions = (state.users || []).map((u) =>
    `<option value="${u.id}" ${item.assigned_to === u.id ? 'selected' : ''}>${esc(u.display_name)}</option>`
  ).join('');

  openSharedModal({
    title: t('tasks.editPersonalItemTitle'),
    size: 'lg',
    content: `
      <form id="personal-item-form" novalidate autocomplete="off">
        <div class="form-group">
          <label class="label" for="pi-title">${t('tasks.titleLabel')}</label>
          <input class="input" type="text" id="pi-title" name="title"
                 value="${esc(item.title)}" required maxlength="600" autocomplete="off">
        </div>

        <div class="form-group">
          <label class="label" for="pi-description">${t('tasks.descriptionLabel')}</label>
          <textarea class="input" id="pi-description" name="description"
                    rows="2" style="resize:vertical"
                    placeholder="${t('tasks.descriptionPlaceholder')}">${esc(item.description || '')}</textarea>
        </div>

        <div class="form-group" style="margin-bottom:0">
          <label class="label" for="pi-priority">${t('tasks.priorityLabel')}</label>
          <select class="input" id="pi-priority" name="priority" style="min-height:44px">
            ${priorityOptions}
          </select>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3);margin-top:var(--space-4)">
          <div class="form-group" style="margin-bottom:0">
            <label class="label" for="pi-due">${t('tasks.dueDateLabel')}</label>
            <input class="input" type="date" id="pi-due" name="due_date"
                   value="${esc(item.due_date || '')}">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="label" for="pi-due-time">${t('tasks.dueTimeLabel')}</label>
            <input class="input" type="time" id="pi-due-time" name="due_time"
                   value="${esc(item.due_time || '')}">
          </div>
        </div>
        <div style="margin-top:var(--space-2)">
          <button type="button" class="btn btn--ghost" id="pi-due-clear"
                  ${item.due_date ? '' : 'hidden'}>
            ${t('common.clear') ?? 'Clear'}
          </button>
        </div>

        <div class="form-group" style="margin-top:var(--space-4)">
          <label class="label" for="pi-alarm-at">${t('tasks.alarmLabel')}</label>
          <input class="input" type="datetime-local" id="pi-alarm-at" name="alarm_at"
                 value="${item.alarm_at ?? ''}">
        </div>

        ${isShared ? `
        <div class="form-group" style="margin-top:var(--space-4)">
          <label class="label" for="pi-assigned">${t('tasks.assignedLabel')}</label>
          <select class="input" id="pi-assigned" name="assigned_to" style="min-height:44px">
            <option value="">${t('tasks.assignedNobody')}</option>
            ${assignedOptions}
          </select>
        </div>` : ''}

        ${renderRRuleFields('pi', item.recurrence_rule)}

        <div id="pi-form-error" class="login-error" hidden></div>

        <div class="modal-panel__footer" style="padding:0;border:none;margin-top:var(--space-6);display:flex;justify-content:space-between;align-items:center;gap:var(--space-3)">
          ${item.id ? `<button type="button" class="btn btn--ghost" id="pi-delete-btn"
                  style="color:var(--color-danger)">${t('common.delete')}</button>` : '<span></span>'}
          <button type="submit" class="btn btn--primary" id="pi-submit">
            ${item.id ? t('common.save') : (t('common.add') ?? 'Add')}
          </button>
        </div>
      </form>
    `,
    onSave(panel) {
      bindRRuleEvents(document, 'pi');

      const dueInput = panel.querySelector('#pi-due');
      const dueClear = panel.querySelector('#pi-due-clear');
      dueInput?.addEventListener('input', () => {
        dueClear.hidden = !dueInput.value;
      });
      dueClear?.addEventListener('click', () => {
        dueInput.value = '';
        dueClear.hidden = true;
      });

      panel.querySelector('#pi-delete-btn')?.addEventListener('click', async () => {
        const ok = await showConfirm(t('tasks.deleteItemConfirm') ?? 'Delete this item?',
          { danger: true });
        if (!ok) return;
        try {
          await api.delete(`/personal-lists/${targetListId}/items/${item.id}`);
          if (onDeleted) {
            onDeleted();
          } else {
            state.personalItems = state.personalItems.filter((i) => i.id !== item.id);
            const lst = state.taskLists.find((l) => l.id === targetListId);
            if (lst) {
              if (getPersonalItemStatus(item) !== 'done') lst.pending_count = Math.max(0, lst.pending_count - 1);
              lst.total_count = Math.max(0, lst.total_count - 1);
              renderTaskTabsBar(container);
            }
            refreshPersonalItems(container);
          }
          closeModal();
        } catch (err) {
          const errEl = panel.querySelector('#pi-form-error');
          errEl.textContent = err.message;
          errEl.hidden = false;
        }
      });

      panel.querySelector('#personal-item-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errEl = panel.querySelector('#pi-form-error');
        const btn   = panel.querySelector('#pi-submit');
        errEl.hidden = true;
        btn.disabled = true;

        const title = panel.querySelector('#pi-title').value.trim();
        const priority = panel.querySelector('#pi-priority')?.value ?? 'none';
        const due = dueInput.value || null;
        const dueTime = panel.querySelector('#pi-due-time')?.value || null;
        const alarmAt = panel.querySelector('#pi-alarm-at')?.value || null;
        const description = panel.querySelector('#pi-description')?.value.trim() || null;
        const rrule = getRRuleValues(document, 'pi');

        if (!title) {
          errEl.textContent = t('common.required');
          errEl.hidden = false;
          btn.disabled = false;
          return;
        }

        const payload = {
          title, priority, due_date: due, due_time: dueTime, alarm_at: alarmAt, description,
          is_recurring: rrule.is_recurring ? 1 : 0,
          recurrence_rule: rrule.recurrence_rule || null,
        };
        if (isShared) {
          const assignedVal = panel.querySelector('#pi-assigned')?.value;
          payload.assigned_to = assignedVal ? parseInt(assignedVal, 10) : null;
        }

        try {
          let res;
          if (item.id) {
            res = await api.patch(`/personal-lists/${targetListId}/items/${item.id}`, payload);
            Object.assign(item, res.data);
          } else {
            res = await api.post(`/personal-lists/${targetListId}/items`, payload);
            const lst = state.taskLists.find((l) => l.id === targetListId);
            if (lst) { lst.pending_count++; lst.total_count++; renderTaskTabsBar(container); }
            if (state.activeTab === targetListId) {
              state.personalItems.push(res.data);
            }
          }
          if (onSaved) onSaved(res.data);
          else refreshPersonalItems(container);
          closeModal();
        } catch (err) {
          errEl.textContent = err.message;
          errEl.hidden = false;
          btn.disabled = false;
        }
      });
    },
  });
}

// --------------------------------------------------------
// Share Personal List Dialog (owner-only)
// --------------------------------------------------------

function openShareDialog({ list, container }) {
  const me = state.currentUser?.id;
  const candidates = (state.users || []).filter((u) => u.id !== list.owner_id && u.id !== me);
  const initial = new Set(list.shared_user_ids || []);

  const userRows = candidates.length
    ? candidates.map((u) => {
        const checked = initial.has(u.id) ? 'checked' : '';
        return `
          <label class="share-user-row">
            <input type="checkbox" class="share-user-row__cb" data-user-id="${u.id}" ${checked}>
            <span class="share-user-row__avatar"
                  style="background-color:${esc(u.avatar_color || '#888')}">
              ${esc(initials(u.display_name || ''))}
            </span>
            <span class="share-user-row__name">${esc(u.display_name)}</span>
          </label>`;
      }).join('')
    : `<div class="share-empty">${t('tasks.shareDialogEmpty')}</div>`;

  openSharedModal({
    title: t('tasks.shareDialogTitle', { name: esc(list.name) }),
    size: 'sm',
    content: `
      <form id="share-list-form" novalidate autocomplete="off">
        <p class="share-help">${t('tasks.shareDialogHelp')}</p>
        <div class="share-user-list" id="share-user-list">${userRows}</div>
        <div id="share-form-error" class="login-error" hidden></div>
        <div class="modal-panel__footer" style="padding:0;border:none;margin-top:var(--space-6)">
          <button type="submit" class="btn btn--primary" id="share-submit"
                  ${candidates.length ? '' : 'disabled'}>
            ${t('common.save')}
          </button>
        </div>
      </form>
    `,
    onSave(panel) {
      panel.querySelector('#share-list-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errEl = panel.querySelector('#share-form-error');
        const btn   = panel.querySelector('#share-submit');
        errEl.hidden = true;
        btn.disabled = true;

        const ids = [...panel.querySelectorAll('.share-user-row__cb:checked')]
          .map((cb) => Number(cb.dataset.userId));

        try {
          await api.put(`/personal-lists/${list.id}/shares`, { user_ids: ids });
          // Update local state and re-render
          const idx = state.taskLists.findIndex((l) => l.id === list.id);
          if (idx >= 0) state.taskLists[idx].shared_user_ids = ids;
          window.planium.showToast(t('tasks.shareSavedToast'), 'success');
          closeModal();
        } catch (err) {
          errEl.textContent = err.message;
          errEl.hidden = false;
          btn.disabled = false;
        }
      });
    },
  });

  if (window.lucide) window.lucide.createIcons();
}

// --------------------------------------------------------
// Tab-Bar wiring (clicks on tab + new-list button)
// --------------------------------------------------------

function wireTaskTabsBar(container) {
  const bar = container.querySelector('#task-tabs-bar');
  if (!bar) return;

  bar.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;

    if (action === 'new-list') {
      openListDialog({ container });
      return;
    }

    if (action === 'switch-tab') {
      const tab = parseInt(target.dataset.tab, 10);
      if (tab === state.activeTab) return;
      state.activeTab = tab;
      state.personalFilters     = { status: '', priority: '', assigned_to: '' };
      state.personalSelectMode  = false;
      state.personalSelectedIds = new Set();
      localStorage.setItem('tasks-active-tab', String(tab));
      renderTaskTabsBar(container);
      await loadPersonalItems(tab);
      renderPersonalView(container);
    }
  });
}

// --------------------------------------------------------
// Drag-reorder for personal list tabs (owner-only).
// Mirrors wireHeadTabDragReorder in lists.js.
// Only tabs the current user owns are draggable; the household
// tab, the new-list button and shared (non-owned) tabs stay put.
// --------------------------------------------------------
function wirePersonalTabsReorder(container) {
  const bar = container.querySelector('#task-tabs-bar');
  if (!bar) return;

  let dragging  = null;
  let dragPtrId = null;
  let didDrag   = false;
  let startX = 0, startY = 0;

  const getOwnedTabs = () => [...bar.querySelectorAll('.task-tab[data-owned="1"]')];

  bar.addEventListener('pointerdown', (e) => {
    const tab = e.target.closest('.task-tab[data-owned="1"]');
    if (!tab) return;
    dragging  = tab;
    dragPtrId = e.pointerId;
    didDrag   = false;
    startX = e.clientX; startY = e.clientY;
  });

  bar.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== dragPtrId) return;
    const dx = e.clientX - startX;
    const dy = Math.abs(e.clientY - startY);
    if (!didDrag && dy > Math.abs(dx) + 5) { dragging = null; dragPtrId = null; return; }
    if (!didDrag) {
      if (Math.abs(dx) < 8) return;
      didDrag = true;
      dragging.classList.add('task-tab--dragging');
      try { bar.setPointerCapture(e.pointerId); } catch {}
    }
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.task-tab[data-owned="1"]');
    if (!over || over === dragging) return;
    const tabs = getOwnedTabs();
    const dragIdx = tabs.indexOf(dragging);
    const overIdx = tabs.indexOf(over);
    if (dragIdx === -1 || overIdx === -1) return;
    if (dragIdx < overIdx) over.after(dragging); else over.before(dragging);
  });

  const onPointerUp = async (e) => {
    if (!dragging || e.pointerId !== dragPtrId) return;
    const wasDragged = didDrag;
    dragging.classList.remove('task-tab--dragging');
    const newOwnedOrder = getOwnedTabs().map((el) => Number(el.dataset.listId));
    const oldOwnedOrder = state.taskLists.filter((l) => l.is_owner).map((l) => l.id);
    dragging = null; dragPtrId = null; didDrag = false;
    if (!wasDragged) return;
    bar.addEventListener('click', (ev) => ev.stopImmediatePropagation(), { once: true, capture: true });
    if (JSON.stringify(newOwnedOrder) === JSON.stringify(oldOwnedOrder)) return;

    // Reorder owned lists in state by the new sequence; shared lists keep their position
    const ownedById = new Map(state.taskLists.filter((l) => l.is_owner).map((l) => [l.id, l]));
    const sharedLists = state.taskLists.filter((l) => !l.is_owner);
    const reorderedOwned = newOwnedOrder.map((id) => ownedById.get(id)).filter(Boolean);
    const oldList = state.taskLists.slice();
    state.taskLists = [...reorderedOwned, ...sharedLists];

    try {
      await api.patch('/personal-lists/reorder', { ids: newOwnedOrder });
      vibrate(15);
    } catch (err) {
      window.planium?.showToast(err.message, 'danger');
      state.taskLists = oldList;
      renderTaskTabsBar(container);
    }
  };

  bar.addEventListener('pointerup', onPointerUp);
  bar.addEventListener('pointercancel', (e) => {
    if (!dragging || e.pointerId !== dragPtrId) return;
    dragging.classList.remove('task-tab--dragging');
    dragging = null; dragPtrId = null; didDrag = false;
    renderTaskTabsBar(container);
  });
}

// --------------------------------------------------------
// Haupt-Render
// --------------------------------------------------------

export async function render(container, { user }) {
  state.activeTab = readActiveTab();
  state.currentUser = user || null;

  // Skeleton: shared tabs bar + content slot (filled per-tab)
  container.innerHTML = `
    <div class="tasks-page">
      <div class="task-tabs-bar" id="task-tabs-bar"></div>
      <div id="tasks-content">
        ${[1,2,3].map(() => `
          <div class="widget-skeleton" style="margin-bottom:var(--space-2)">
            <div class="skeleton skeleton-line skeleton-line--medium" style="height:18px;margin-bottom:var(--space-3)"></div>
            <div class="skeleton skeleton-line skeleton-line--full" style="height:14px;margin-bottom:var(--space-2)"></div>
            <div class="skeleton skeleton-line skeleton-line--short" style="height:12px"></div>
          </div>`).join('')}
      </div>
    </div>
  `;

  if (window.lucide) window.lucide.createIcons();

  // Daten laden (parallel)
  try {
    const [metaData, listsData] = await Promise.all([
      api.get('/personal-lists/users'),
      api.get('/personal-lists'),
    ]);
    state.users     = metaData.users ?? [];
    state.taskLists = listsData.data ?? [];
  } catch (err) {
    console.error('[Tasks] Ladefehler:', err.message);
    window.planium.showToast(t('tasks.loadError'), 'danger');
    state.users     = [];
    state.taskLists = [];
  }

  // Resolve missing or unknown tab → first available list
  if (!state.activeTab || !state.taskLists.some((l) => l.id === state.activeTab)) {
    state.activeTab = state.taskLists[0]?.id ?? null;
    localStorage.setItem('tasks-active-tab', String(state.activeTab));
  }

  if (state.activeTab) {
    await loadPersonalItems(state.activeTab);
  }

  // Reset select state on page load
  state.personalSelectMode  = false;
  state.personalSelectedIds = new Set();

  renderTaskTabsBar(container);
  wireTaskTabsBar(container);
  wirePersonalTabsReorder(container);

  renderPersonalView(container);

  // Clean up stale dashboard hints
  localStorage.removeItem('tasks-create-new');
  localStorage.removeItem('tasks-open-task');

}
