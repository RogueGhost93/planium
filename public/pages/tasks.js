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
import { esc } from '/utils/html.js';

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

const STATUSES = () => [
  { value: 'open', label: t('tasks.statusOpen') },
  { value: 'done', label: t('tasks.statusDone') },
];

const CATEGORIES = [
  'Household', 'School', 'Shopping', 'Repairs',
  'Health', 'Finance', 'Leisure', 'Other',
];

const CATEGORY_LABELS = () => ({
  'Household': t('tasks.categoryHousehold'),
  'School':    t('tasks.categorySchool'),
  'Shopping':  t('tasks.categoryShopping'),
  'Repairs':   t('tasks.categoryRepair'),
  'Health':    t('tasks.categoryHealth'),
  'Finance':   t('tasks.categoryFinance'),
  'Leisure':   t('tasks.categoryLeisure'),
  'Other':     t('tasks.categoryMisc'),
});

const PRIORITY_LABELS = () => Object.fromEntries(PRIORITIES().map((p) => [p.value, p.label]));
const STATUS_LABELS   = () => Object.fromEntries(STATUSES().map((s)  => [s.value, s.label]));

// --------------------------------------------------------
// Hilfsfunktionen
// --------------------------------------------------------

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
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

// Sort tasks like personal lists do: pending first (urgent → soonest due),
// then by due date / id. Done items are listed separately after.
function sortTasksForList(tasks) {
  const today = new Date().setHours(0, 0, 0, 0);
  return tasks.slice().sort((a, b) => {
    if ((a.priority === 'urgent') !== (b.priority === 'urgent')) {
      return a.priority === 'urgent' ? -1 : 1;
    }
    const ad = a.due_date ? new Date(a.due_date).setHours(0, 0, 0, 0) : Infinity;
    const bd = b.due_date ? new Date(b.due_date).setHours(0, 0, 0, 0) : Infinity;
    if (ad !== bd) return ad - bd;
    // Stable-ish: overdue ahead of future when same date is impossible here, so fall back to id
    if (ad === today && bd === today) return 0;
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

function renderDueDate(dateStr) {
  const d = formatDueDate(dateStr);
  if (!d) return '';
  return `<span class="due-date ${d.cls}">
    <i data-lucide="clock" style="width:11px;height:11px" aria-hidden="true"></i> ${d.label}
  </span>`;
}

function renderSwipeRow(task, innerHtml) {
  const isDone = task.status === 'done';
  return `
    <div class="swipe-row" data-swipe-id="${task.id}" data-swipe-status="${task.status}">
      <div class="swipe-reveal swipe-reveal--done" aria-hidden="true">
        <i data-lucide="${isDone ? 'rotate-ccw' : 'check'}" style="width:22px;height:22px" aria-hidden="true"></i>
        <span>${isDone ? t('tasks.swipeOpen') : t('tasks.swipeDone')}</span>
      </div>
      <div class="swipe-reveal swipe-reveal--edit" aria-hidden="true">
        <i data-lucide="pencil" style="width:22px;height:22px" aria-hidden="true"></i>
        <span>${t('tasks.swipeEdit')}</span>
      </div>
      ${innerHtml}
    </div>`;
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
    <div class="task-card ${isDone ? 'task-card--done' : ''} ${isSelected ? 'task-card--selected' : ''}" data-task-id="${task.id}">
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
          <div class="task-card__title" data-action="open-task" data-id="${task.id}">
            ${esc(task.title)}
          </div>
          <div class="task-card__meta">
            ${renderPriorityBadge(task.priority)}
            ${renderDueDate(task.due_date)}
            ${task.is_recurring ? `<span class="due-date" aria-label="${t('tasks.recurring')}"><i data-lucide="repeat" style="width:12px;height:12px" aria-hidden="true"></i></span>` : ''}
            ${task.category !== 'Other' ? `<span class="due-date">${CATEGORY_LABELS()[task.category] ?? task.category}</span>` : ''}
          </div>
        </div>

        ${task.assigned_color ? `
          <div class="task-avatar" style="background-color:${esc(task.assigned_color)}"
               title="${esc(task.assigned_name)}">
            ${esc(initials(task.assigned_name ?? ''))}
          </div>` : ''}

        <button class="btn btn--ghost btn--icon" data-action="edit-task" data-id="${task.id}"
                aria-label="${t('tasks.editButton')}" style="min-height:unset;width:36px;height:36px">
          <i data-lucide="pencil" style="width:16px;height:16px" aria-hidden="true"></i>
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
  const pending = sortTasksForList(tasks.filter((t) => t.status !== 'done'));
  const done    = sortTasksForList(tasks.filter((t) => t.status === 'done'));

  if (!pending.length && !done.length) {
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
        ${pending.map((tk) => renderSwipeRow(tk, renderTaskCard(tk))).join('')}
      </div>`;
  }

  if (done.length) {
    html += `
      <div class="task-group task-group--done">
        <div class="task-group__divider">
          <span>${t('tasks.statusDone')} (${done.length})</span>
        </div>
        ${done.map((tk) => renderSwipeRow(tk, renderTaskCard(tk))).join('')}
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

  const catLabels = CATEGORY_LABELS();
  const categoryOptions = CATEGORIES.map((c) =>
    `<option value="${c}" ${(task?.category ?? 'Other') === c ? 'selected' : ''}>${catLabels[c] ?? c}</option>`
  ).join('');

  const current = task?.priority ?? 'none';
  const priorityOptions = PRIORITIES()
    .filter((p) => p.value === 'none' || p.value === 'urgent')
    .map((p) =>
      `<option value="${p.value}" ${current === p.value ? 'selected' : ''}>${p.label}</option>`
    ).join('');

  return `
    <form id="task-form" novalidate>
      <input type="hidden" id="task-id" value="${task?.id ?? ''}">

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

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
        <div class="form-group" style="margin-bottom:0">
          <label class="label" for="task-priority">${t('tasks.priorityLabel')}</label>
          <select class="input" id="task-priority" name="priority" style="min-height:44px">
            ${priorityOptions}
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label class="label" for="task-category">${t('tasks.categoryLabel')}</label>
          <select class="input" id="task-category" name="category" style="min-height:44px">
            ${categoryOptions}
          </select>
        </div>
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
            ${STATUSES().map((s) =>
              `<option value="${s.value}" ${task.status === s.value ? 'selected' : ''}>${s.label}</option>`
            ).join('')}
          </select>
        </div>` : ''}

      ${renderRRuleFields('task', task?.recurrence_rule)}

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
  tasks:         [],
  users:         [],
  filters:       { status: '', priority: '', assigned_to: '' },
  viewMode:      localStorage.getItem('tasks-view') || 'list',  // 'list' | 'kanban'
  expandedTasks: new Set(),
  dragTaskId:    null,
  selectMode:    false,
  selectedIds:   new Set(),
  // Personal lists (solo todos, scoped to current user)
  taskLists:     [],            // [{ id, name, color, pending_count, total_count }]
  activeTab:     'household',   // 'household' | <list_id:number>
  personalItems: [],            // items for the currently active personal list
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

function openTaskModal({ task = null, users = [] } = {}, container) {
  const isEdit = !!task;
  openSharedModal({
    title: isEdit ? t('tasks.editTask') : t('tasks.newTask'),
    content: renderModalContent({ task, users }),
    size: 'lg',
    onSave(panel) {
      // RRULE-Events binden
      bindRRuleEvents(document, 'task');

      // Blur-Validierung für required-Felder aktivieren
      wireBlurValidation(panel);

      // Form-Events
      panel.querySelector('#task-form')
        ?.addEventListener('submit', (e) => handleFormSubmit(e, container));

      panel.querySelector('[data-action="delete-task"]')
        ?.addEventListener('click', (e) => handleDeleteTask(e.currentTarget.dataset.id, container));
    },
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

  errorEl.hidden = true;
  submitBtn.disabled = true;
  submitBtn.textContent = t('common.saving');

  const originalLabel = taskId ? t('common.save') : t('common.create');

  const rrule = getRRuleValues(document, 'task');
  const body = {
    title:           form.title.value.trim(),
    description:     form.description.value.trim() || null,
    priority:        form.priority.value,
    category:        form.category.value,
    due_date:        form.due_date?.value || null,
    due_time:        form.due_time?.value || null,
    assigned_to:     form.assigned_to.value ? Number(form.assigned_to.value) : null,
    is_recurring:    rrule.is_recurring ? 1 : 0,
    recurrence_rule: rrule.recurrence_rule,
  };
  if (form.status) body.status = form.status.value;

  try {
    if (taskId) {
      await api.put(`/tasks/${taskId}`, body);
      window.planner.showToast(t('tasks.savedToast'), 'success');
    } else {
      await api.post('/tasks', body);
      window.planner.showToast(t('tasks.createdToast'), 'success');
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
    window.planner.showToast(t('tasks.deletedToast'), 'default');
    await loadTasks(container);
  } catch (err) {
    window.planner.showToast(err.message, 'danger');
  }
}

async function handleAddSubtask(parentId, container) {
  const title = await showPrompt(t('tasks.subtaskPrompt'));
  if (!title?.trim()) return;
  try {
    await api.post('/tasks', { title: title.trim(), parent_task_id: parentId });
    await loadTasks(container);
  } catch (err) {
    window.planner.showToast(err.message, 'danger');
  }
}

// --------------------------------------------------------
// Kanban-Ansicht
// --------------------------------------------------------

const KANBAN_COLS = () => [
  { status: 'open', label: t('tasks.kanbanOpen'), colorVar: '--color-text-secondary' },
  { status: 'done', label: t('tasks.kanbanDone'), colorVar: '--color-success'        },
];

const KANBAN_STATUS_CYCLE = { open: 'done', done: 'open' };
const KANBAN_STATUS_ICON  = { open: 'circle', done: 'check-circle' };

function renderKanbanCard(task) {
  const due = formatDueDate(task.due_date);
  const nextStatus = KANBAN_STATUS_CYCLE[task.status] ?? 'open';
  const icon = KANBAN_STATUS_ICON[task.status] ?? 'circle';
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
                title="Move to ${nextStatus.replace('_', ' ')}" aria-label="Cycle status">
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
  for (const t of state.tasks) {
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
      window.planner.showToast(err.message, 'danger');
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
        window.planner.showToast(err.message, 'danger');
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
      window.planner.showToast(t('tasks.loadError'), 'danger');
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
  listEl.innerHTML = renderTaskGroups(state.tasks);
  listEl.classList.toggle('task-list--select-mode', state.selectMode);
  if (window.lucide) window.lucide.createIcons();
  stagger(listEl.querySelectorAll('.swipe-row, .kanban-card'));
  updateOverdueBadge();
  wireSwipeGestures(container);
}

function renderFilters(container) {
  const bar = container.querySelector('#filter-bar');
  if (!bar) return;

  const chips = [];
  const statusLabels   = STATUS_LABELS();
  const priorityLabels = PRIORITY_LABELS();
  if (state.filters.status) {
    chips.push(`<span class="filter-chip filter-chip--active" data-filter="status">
      ${statusLabels[state.filters.status]}
      <span class="filter-chip__remove" aria-hidden="true">×</span>
    </span>`);
  }
  if (state.filters.priority) {
    chips.push(`<span class="filter-chip filter-chip--active" data-filter="priority">
      ${priorityLabels[state.filters.priority]}
      <span class="filter-chip__remove" aria-hidden="true">×</span>
    </span>`);
  }
  if (state.filters.assigned_to) {
    const u = state.users.find((u) => u.id === Number(state.filters.assigned_to));
    chips.push(`<span class="filter-chip filter-chip--active" data-filter="assigned_to">
      ${u?.display_name ?? 'Person'}
      <span class="filter-chip__remove" aria-hidden="true">×</span>
    </span>`);
  }

  // Inaktive Filter-Chips (zum Aktivieren)
  if (!state.filters.status) {
    STATUSES().forEach((s) => {
      chips.push(`<span class="filter-chip" data-filter="status" data-value="${s.value}">${s.label}</span>`);
    });
  }
  if (!state.filters.priority) {
    PRIORITIES().forEach((p) => {
      chips.push(`<span class="filter-chip" data-filter="priority" data-value="${p.value}">${p.label}</span>`);
    });
  }
  if (!state.filters.assigned_to && state.users.length > 1) {
    state.users.forEach((u) => {
      chips.push(`<span class="filter-chip" data-filter="assigned_to" data-value="${u.id}">${u.display_name}</span>`);
    });
  }

  bar.innerHTML = chips.join('');
  wireFilterChips(container);
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
// Swipe-Gesten (Mobil: links = erledigt, rechts = bearbeiten)
// --------------------------------------------------------

const SWIPE_THRESHOLD    = 80;   // px - Mindestweg für Aktion
const SWIPE_MAX_VERT     = 12;   // px - vertikaler Bewegungs-Toleranzbereich (darunter: kein Scroll-Abbruch)
const SWIPE_LOCK_VERT    = 30;   // px - ab diesem Weg gilt es als Scroll (Swipe abgebrochen)

function wireSwipeGestures(container) {
  const listEl = container.querySelector('#task-list');
  if (!listEl) return;

  listEl.querySelectorAll('.swipe-row').forEach((row) => {
    let startX = 0, startY = 0;
    let dx = 0;
    let locked = false;    // false = unentschieden, 'swipe' | 'scroll'
    let thresholdHit = false; // Haptic-Feedback am Threshold nur einmal
    const card = row.querySelector('.task-card');
    if (!card) return;

    function resetCard(animate = true) {
      card.style.transition = animate ? 'transform 0.25s ease' : '';
      card.style.transform  = '';
      row.classList.remove('swipe-row--swiping');
      // Reveal-Panels zurücksetzen
      row.querySelector('.swipe-reveal--done').style.opacity = '0';
      row.querySelector('.swipe-reveal--edit').style.opacity = '0';
    }

    row.addEventListener('touchstart', (e) => {
      // Geste ignorieren wenn Modal offen oder Select-Modus aktiv
      if (document.getElementById('shared-modal-overlay')) return;
      if (state.selectMode) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dx     = 0;
      locked = false;
      thresholdHit = false;
      card.style.transition = '';
    }, { passive: true });

    row.addEventListener('touchmove', (e) => {
      if (locked === 'scroll') return;

      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      dx = currentX - startX;
      const dy = Math.abs(currentY - startY);

      // Scroll-Richtung früh erkennen
      if (locked === false) {
        if (dy > SWIPE_MAX_VERT && Math.abs(dx) < dy) {
          locked = 'scroll';
          resetCard(false);
          return;
        }
        if (Math.abs(dx) > SWIPE_MAX_VERT) {
          locked = 'swipe';
        }
      }

      if (locked !== 'swipe') return;

      // Vertikalen Scroll verhindern sobald Swipe erkannt
      if (dy < SWIPE_LOCK_VERT) e.preventDefault();

      // Karte verschieben (gedämpft nach THRESHOLD)
      const dampened = dx > 0
        ? Math.min(dx, SWIPE_THRESHOLD + (dx - SWIPE_THRESHOLD) * 0.2)
        : Math.max(dx, -(SWIPE_THRESHOLD + (-dx - SWIPE_THRESHOLD) * 0.2));

      card.style.transform = `translateX(${dampened}px)`;
      row.classList.add('swipe-row--swiping');

      // Reveal-Panels einblenden (0 → 1 über Threshold)
      const progress = Math.min(Math.abs(dx) / SWIPE_THRESHOLD, 1);
      if (dx < 0) {
        row.querySelector('.swipe-reveal--done').style.opacity = String(progress);
        row.querySelector('.swipe-reveal--edit').style.opacity = '0';
      } else {
        row.querySelector('.swipe-reveal--edit').style.opacity = String(progress);
        row.querySelector('.swipe-reveal--done').style.opacity = '0';
      }

      // Haptic-Feedback beim Erreichen des Schwellwerts
      if (!thresholdHit && Math.abs(dx) >= SWIPE_THRESHOLD) {
        thresholdHit = true;
        vibrate(15);
      }
    }, { passive: false });

    row.addEventListener('touchend', async () => {
      if (locked !== 'swipe') { resetCard(false); return; }

      const taskId = row.dataset.swipeId;
      const status = row.dataset.swipeStatus;

      if (dx < -SWIPE_THRESHOLD) {
        // Swipe links → Status-Toggle (offen ↔ erledigt)
        card.style.transition = 'transform 0.2s ease';
        card.style.transform  = 'translateX(-110%)';
        vibrate(40);
        setTimeout(async () => {
          resetCard(false);
          try {
            await toggleTaskStatus(taskId, status);
            await loadTasks(container);
          } catch (err) {
            window.planner.showToast(err.message, 'danger');
            await loadTasks(container);
          }
        }, 200);

      } else if (dx > SWIPE_THRESHOLD) {
        // Swipe rechts → Bearbeiten-Modal
        resetCard(true);
        vibrate(20);
        try {
          const task = await loadTaskForEdit(taskId);
          openTaskModal({ task, users: state.users }, container);
        } catch (err) {
          window.planner.showToast(t('tasks.loadError'), 'danger');
        }

      } else {
        resetCard(true);
      }
    }, { passive: true });
  });
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
  if (newBtn)    newBtn.hidden    = inSelect;
  if (viewToggle) viewToggle.hidden = inSelect;
  if (groupToggle) groupToggle.hidden = inSelect;
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
      window.planner.showToast(t('tasks.bulkDeletedToast', { count }), 'default');
      await loadTasks(container);
    } catch (err) {
      window.planner.showToast(err.message, 'danger');
    }
  });
}

function wireFilterChips(container) {
  container.querySelectorAll('[data-filter]').forEach((chip) => {
    chip.addEventListener('click', async () => {
      const filter = chip.dataset.filter;
      if (chip.classList.contains('filter-chip--active')) {
        state.filters[filter] = '';
      } else {
        state.filters[filter] = chip.dataset.value;
      }
      renderFilters(container);
      await loadTasks(container);
    });
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
    const row = e.target.closest('.swipe-row[data-swipe-id]');
    if (!row) return;
    e.stopImmediatePropagation();
    const taskId = parseInt(row.dataset.swipeId, 10);
    toggleSelectId(taskId, row.querySelector('.task-card'));
    updateBulkBar(container);
  });

  listEl.addEventListener('click', async (e) => {
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
        window.planner.showToast(err.message, 'danger');
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
        window.planner.showToast(err.message, 'danger');
      }
    }

    if (action === 'edit-task' || action === 'open-task') {
      try {
        const task = await loadTaskForEdit(id);
        openTaskModal({ task, users: state.users }, container);
      } catch (err) {
        window.planner.showToast(t('tasks.loadError'), 'danger');
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
    window.planner.showToast(t('tasks.personalListLoadError'), 'danger');
  }
}

function renderTaskTabsBar(container) {
  const bar = container.querySelector('#task-tabs-bar');
  if (!bar) return;

  const householdTab = `
    <button class="task-tab ${state.activeTab === 'household' ? 'task-tab--active' : ''}"
            data-action="switch-tab" data-tab="household">
      <i data-lucide="users" style="width:14px;height:14px;pointer-events:none" aria-hidden="true"></i>
      ${t('tasks.tabHousehold')}
    </button>`;

  const personalTabs = state.taskLists.map((l) => {
    const isActive = state.activeTab === l.id;
    const sharedIcon = !l.is_owner
      ? '<i data-lucide="users" style="width:12px;height:12px;pointer-events:none;opacity:0.75" aria-hidden="true"></i>'
      : '';
    return `
      <button class="task-tab ${isActive ? 'task-tab--active' : ''}"
              data-action="switch-tab" data-tab="${l.id}"
              data-list-id="${l.id}" data-owned="${l.is_owner ? '1' : '0'}"
              style="--tab-color: ${esc(l.color)}"
              title="${!l.is_owner && l.owner_name ? esc(t('tasks.sharedByLabel', { name: l.owner_name })) : esc(l.name)}">
        <span class="task-tab__color-dot" aria-hidden="true"></span>
        ${esc(l.name)}
        ${sharedIcon}
        ${l.pending_count > 0 ? `<span class="task-tab__count">${l.pending_count}</span>` : ''}
      </button>`;
  }).join('');

  bar.innerHTML = householdTab + personalTabs + `
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
  const isUrgent = item.priority === 'urgent';
  const due = formatPersonalDueDate(item.due_date);
  const hasMeta = isUrgent || due;
  const metaHtml = hasMeta ? `
    <div class="personal-item__meta">
      ${isUrgent ? `<span class="personal-item__priority" title="${t('tasks.priorityUrgent')}">
                      <span class="priority-dot priority-dot--urgent" aria-hidden="true"></span>
                      ${t('tasks.priorityUrgent')}
                    </span>` : ''}
      ${due ? `<span class="personal-item__due ${due.cls}">
                 <i data-lucide="calendar" style="width:11px;height:11px" aria-hidden="true"></i>
                 ${esc(due.label)}
               </span>` : ''}
    </div>` : '';

  return `
    <div class="personal-item ${item.done ? 'personal-item--done' : ''} ${isUrgent && !item.done ? 'personal-item--urgent' : ''}"
         data-item-id="${item.id}">
      <button class="personal-item__check ${item.done ? 'personal-item__check--checked' : ''}"
              data-action="toggle-personal-item"
              aria-label="${item.done ? 'Mark as not done' : 'Mark as done'}">
        ${item.done ? '<i data-lucide="check" style="width:12px;height:12px;color:#fff;pointer-events:none" aria-hidden="true"></i>' : ''}
      </button>
      <div class="personal-item__body" data-action="edit-personal-item"
           role="button" tabindex="0">
        <span class="personal-item__title">${esc(item.title)}</span>
        ${metaHtml}
      </div>
      <button class="personal-item__edit" data-action="edit-personal-item"
              aria-label="${t('tasks.editPersonalItemTitle') ?? 'Edit'}"
              title="${t('tasks.editPersonalItemTitle') ?? 'Edit'}">
        <i data-lucide="pencil" style="width:14px;height:14px;pointer-events:none" aria-hidden="true"></i>
      </button>
      <button class="personal-item__delete" data-action="delete-personal-item"
              aria-label="Delete">
        <i data-lucide="x" style="width:14px;height:14px;pointer-events:none" aria-hidden="true"></i>
      </button>
    </div>`;
}

function renderPersonalItems() {
  const pending = state.personalItems.filter((i) => !i.done);
  const done    = state.personalItems.filter((i) =>  i.done);

  if (!pending.length && !done.length) {
    return `<div class="personal-list__empty">${t('tasks.personalListEmpty')}</div>`;
  }

  let html = `<div class="personal-list__items">${pending.map(renderPersonalItemRow).join('')}</div>`;

  if (done.length) {
    html += `
      <div class="personal-list__divider">
        <span>${t('tasks.personalListDoneSection')} (${done.length})</span>
        <button class="btn btn--ghost personal-list__clear-btn" data-action="clear-done-items">
          <i data-lucide="trash-2" style="width:14px;height:14px" aria-hidden="true"></i>
          ${t('tasks.personalListClearDone')}
        </button>
      </div>
      <div class="personal-list__items personal-list__items--done">
        ${done.map(renderPersonalItemRow).join('')}
      </div>`;
  }
  return html;
}

function renderPersonalView(container) {
  const list = state.taskLists.find((l) => l.id === state.activeTab);
  const content = container.querySelector('#tasks-content');
  if (!content) return;
  if (!list) {
    state.activeTab = 'household';
    localStorage.setItem('tasks-active-tab', 'household');
    renderTaskTabsBar(container);
    renderHouseholdView(container);
    return;
  }

  const isOwner = !!list.is_owner;
  const titleHtml = isOwner
    ? `<h1 class="personal-list__title" data-action="edit-list" role="button" tabindex="0"
           title="${t('tasks.renamePersonalList')}">
         ${esc(list.name)}
         <i data-lucide="pencil" class="personal-list__title-icon" aria-hidden="true"></i>
       </h1>`
    : `<h1 class="personal-list__title personal-list__title--readonly">
         ${esc(list.name)}
       </h1>`;

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
    <div class="personal-list" style="--list-color: ${esc(list.color)}">
      <div class="personal-list__header">
        <div class="personal-list__title-wrap">
          <span class="personal-list__color-dot" aria-hidden="true"></span>
          ${titleHtml}
          ${sharedByBadge}
        </div>
        <div class="personal-list__header-actions">
          ${ownerActions}
        </div>
      </div>

      <form class="personal-list__add" data-action="add-personal-item" novalidate autocomplete="off">
        <input class="personal-list__add-input" type="text" name="title"
               placeholder="${t('tasks.personalListAddPlaceholder')}"
               maxlength="200" autocomplete="off">
        <button class="personal-list__add-btn" type="submit"
                aria-label="${t('tasks.personalListAdd')}">
          <i data-lucide="plus" style="width:20px;height:20px;pointer-events:none" aria-hidden="true"></i>
        </button>
      </form>

      <div id="personal-items-container">
        ${renderPersonalItems()}
      </div>
    </div>
  `;
  if (window.lucide) window.lucide.createIcons();
  wirePersonalView(container);

  // Auto-focus add input on desktop only (avoids mobile keyboard popping up unexpectedly)
  if (window.matchMedia('(min-width: 1024px)').matches) {
    content.querySelector('.personal-list__add-input')?.focus();
  }
}

function refreshPersonalItems(container) {
  const wrap = container.querySelector('#personal-items-container');
  if (wrap) wrap.innerHTML = renderPersonalItems();
  if (window.lucide) window.lucide.createIcons();
}

function wirePersonalView(container) {
  const view = container.querySelector('.personal-list');
  if (!view) return;

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
      // Update tab badge count
      const list = state.taskLists.find((l) => l.id === listId);
      if (list) { list.pending_count++; list.total_count++; renderTaskTabsBar(container); }
      input.focus();
    } catch (err) {
      window.planner.showToast(err.message, 'danger');
    }
  });

  // Delegated clicks for items + header actions
  view.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;

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
        state.activeTab = 'household';
        localStorage.setItem('tasks-active-tab', 'household');
        renderTaskTabsBar(container);
        await loadTasks(container);
        renderHouseholdView(container);
        window.planner.showToast(t('tasks.personalListDeletedToast'), 'default');
      } catch (err) {
        window.planner.showToast(err.message, 'danger');
      }
      return;
    }

    if (action === 'clear-done-items') {
      const ok = await showConfirm(t('tasks.personalListClearDoneConfirm'), { danger: true });
      if (!ok) return;
      try {
        await api.post(`/personal-lists/${state.activeTab}/clear-done`, {});
        state.personalItems = state.personalItems.filter((i) => !i.done);
        refreshPersonalItems(container);
      } catch (err) {
        window.planner.showToast(err.message, 'danger');
      }
      return;
    }

    const row = target.closest('.personal-item');
    const itemId = row ? parseInt(row.dataset.itemId, 10) : null;

    if (action === 'toggle-personal-item' && itemId) {
      const item = state.personalItems.find((i) => i.id === itemId);
      if (!item) return;
      const newDone = !item.done;
      // Optimistic update
      item.done = newDone;
      refreshPersonalItems(container);
      const list = state.taskLists.find((l) => l.id === state.activeTab);
      if (list) {
        list.pending_count += newDone ? -1 : 1;
        renderTaskTabsBar(container);
      }
      try {
        await api.patch(`/personal-lists/${state.activeTab}/items/${itemId}`, { done: newDone });
      } catch (err) {
        // Rollback
        item.done = !newDone;
        if (list) { list.pending_count += newDone ? 1 : -1; renderTaskTabsBar(container); }
        refreshPersonalItems(container);
        window.planner.showToast(err.message, 'danger');
      }
      return;
    }

    if (action === 'delete-personal-item' && itemId) {
      try {
        await api.delete(`/personal-lists/${state.activeTab}/items/${itemId}`);
        const removed = state.personalItems.find((i) => i.id === itemId);
        state.personalItems = state.personalItems.filter((i) => i.id !== itemId);
        refreshPersonalItems(container);
        const list = state.taskLists.find((l) => l.id === state.activeTab);
        if (list) {
          if (removed && !removed.done) list.pending_count = Math.max(0, list.pending_count - 1);
          list.total_count = Math.max(0, list.total_count - 1);
          renderTaskTabsBar(container);
        }
      } catch (err) {
        window.planner.showToast(err.message, 'danger');
      }
      return;
    }

    if (action === 'edit-personal-item' && itemId) {
      const item = state.personalItems.find((i) => i.id === itemId);
      if (item) openItemEditDialog({ item, container });
      return;
    }
  });
}

// --------------------------------------------------------
// New / Rename Personal List Dialog
// --------------------------------------------------------

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
                 required maxlength="200" autocomplete="off">
        </div>

        <div class="form-group">
          <label class="label">${t('tasks.personalListColorLabel')}</label>
          <div class="color-swatches" id="color-swatches">${swatches}</div>
          <input type="hidden" id="personal-list-color" value="${currentColor}">
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

          const name  = panel.querySelector('#personal-list-name').value.trim();
          const color = colorInput.value;
          if (!name) {
            errEl.textContent = t('common.required');
            errEl.hidden = false;
            btn.disabled = false;
            return;
          }

          try {
            if (isEdit) {
              const res = await api.put(`/personal-lists/${list.id}`, { name, color });
              const idx = state.taskLists.findIndex((l) => l.id === list.id);
              if (idx >= 0) state.taskLists[idx] = { ...state.taskLists[idx], ...res.data };
              renderTaskTabsBar(container);
              renderPersonalView(container);
              window.planner.showToast(t('tasks.savedToast'), 'success');
            } else {
              const res = await api.post('/personal-lists', { name, color });
              state.taskLists.push(res.data);
              state.activeTab = res.data.id;
              localStorage.setItem('tasks-active-tab', String(res.data.id));
              state.personalItems = [];
              renderTaskTabsBar(container);
              renderPersonalView(container);
              window.planner.showToast(t('tasks.personalListCreatedToast'), 'success');
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

function openItemEditDialog({ item, container }) {
  const isUrgent = item.priority === 'urgent';
  openSharedModal({
    title: t('tasks.editPersonalItemTitle'),
    size: 'sm',
    content: `
      <form id="personal-item-form" novalidate autocomplete="off">
        <div class="form-group">
          <label class="label" for="pi-title">${t('tasks.titleLabel')}</label>
          <input class="input" type="text" id="pi-title" name="title"
                 value="${esc(item.title)}" required maxlength="200" autocomplete="off">
        </div>

        <div class="form-group">
          <label class="label">${t('tasks.priorityLabel')}</label>
          <div class="priority-toggle">
            <label class="priority-toggle__opt ${!isUrgent ? 'priority-toggle__opt--active' : ''}">
              <input type="radio" name="priority" value="none" ${!isUrgent ? 'checked' : ''}>
              <span>${t('tasks.priorityNone')}</span>
            </label>
            <label class="priority-toggle__opt priority-toggle__opt--urgent ${isUrgent ? 'priority-toggle__opt--active' : ''}">
              <input type="radio" name="priority" value="urgent" ${isUrgent ? 'checked' : ''}>
              <span class="priority-dot priority-dot--urgent" aria-hidden="true"></span>
              <span>${t('tasks.priorityUrgent')}</span>
            </label>
          </div>
        </div>

        <div class="form-group">
          <label class="label" for="pi-due">${t('tasks.dueDateLabel')}</label>
          <div class="pi-due-row">
            <input class="input" type="date" id="pi-due" name="due_date"
                   value="${esc(item.due_date || '')}">
            <button type="button" class="btn btn--ghost" id="pi-due-clear"
                    ${item.due_date ? '' : 'hidden'}>
              ${t('common.clear') ?? 'Clear'}
            </button>
          </div>
        </div>

        <div id="pi-form-error" class="login-error" hidden></div>

        <div class="modal-panel__footer" style="padding:0;border:none;margin-top:var(--space-6);display:flex;justify-content:space-between;align-items:center;gap:var(--space-3)">
          <button type="button" class="btn btn--ghost" id="pi-delete-btn"
                  style="color:var(--color-danger)">
            ${t('common.delete')}
          </button>
          <button type="submit" class="btn btn--primary" id="pi-submit">
            ${t('common.save')}
          </button>
        </div>
      </form>
    `,
    onSave(panel) {
      // Visual radio selection (highlight active option)
      panel.querySelectorAll('input[name="priority"]').forEach((rb) => {
        rb.addEventListener('change', () => {
          panel.querySelectorAll('.priority-toggle__opt').forEach((el) => {
            el.classList.toggle('priority-toggle__opt--active',
              el.querySelector('input').checked);
          });
        });
      });

      // Date clear button
      const dueInput = panel.querySelector('#pi-due');
      const dueClear = panel.querySelector('#pi-due-clear');
      dueInput?.addEventListener('input', () => {
        dueClear.hidden = !dueInput.value;
      });
      dueClear?.addEventListener('click', () => {
        dueInput.value = '';
        dueClear.hidden = true;
      });

      // Delete button
      panel.querySelector('#pi-delete-btn')?.addEventListener('click', async () => {
        const ok = await showConfirm(t('tasks.deleteItemConfirm') ?? 'Delete this item?',
          { danger: true });
        if (!ok) return;
        try {
          await api.delete(`/personal-lists/${state.activeTab}/items/${item.id}`);
          state.personalItems = state.personalItems.filter((i) => i.id !== item.id);
          const list = state.taskLists.find((l) => l.id === state.activeTab);
          if (list) {
            if (!item.done) list.pending_count = Math.max(0, list.pending_count - 1);
            list.total_count = Math.max(0, list.total_count - 1);
            renderTaskTabsBar(container);
          }
          refreshPersonalItems(container);
          closeModal();
        } catch (err) {
          const errEl = panel.querySelector('#pi-form-error');
          errEl.textContent = err.message;
          errEl.hidden = false;
        }
      });

      // Form submit
      panel.querySelector('#personal-item-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errEl = panel.querySelector('#pi-form-error');
        const btn   = panel.querySelector('#pi-submit');
        errEl.hidden = true;
        btn.disabled = true;

        const title = panel.querySelector('#pi-title').value.trim();
        const priority = panel.querySelector('input[name="priority"]:checked')?.value ?? 'none';
        const due = dueInput.value || null;
        if (!title) {
          errEl.textContent = t('common.required');
          errEl.hidden = false;
          btn.disabled = false;
          return;
        }
        try {
          const res = await api.patch(
            `/personal-lists/${state.activeTab}/items/${item.id}`,
            { title, priority, due_date: due }
          );
          Object.assign(item, res.data);
          refreshPersonalItems(container);
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
          window.planner.showToast(t('tasks.shareSavedToast'), 'success');
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
      const tab = target.dataset.tab === 'household' ? 'household' : parseInt(target.dataset.tab, 10);
      if (tab === state.activeTab) return;
      state.activeTab = tab;
      localStorage.setItem('tasks-active-tab', String(tab));
      renderTaskTabsBar(container);
      if (tab === 'household') {
        renderHouseholdView(container);
        await loadTasks(container);
      } else {
        await loadPersonalItems(tab);
        renderPersonalView(container);
      }
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
      window.planner?.showToast(err.message, 'danger');
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
// Household View (the original full-featured tasks UI)
// Extracted so we can swap between household and personal views.
// --------------------------------------------------------

function renderHouseholdView(container) {
  const content = container.querySelector('#tasks-content');
  if (!content) return;

  content.innerHTML = `
    <div class="tasks-toolbar">
      <h1 class="tasks-toolbar__title">${t('tasks.title')}</h1>
      <div class="tasks-toolbar__actions">
        <div class="group-toggle" id="view-toggle">
          <button class="group-toggle__btn group-toggle__btn--active" data-view="list"
                  title="${t('tasks.listView')}" aria-label="${t('tasks.listView')}">
            <i data-lucide="list" style="width:14px;height:14px;pointer-events:none" aria-hidden="true"></i>
          </button>
          <button class="group-toggle__btn" data-view="kanban"
                  title="${t('tasks.kanbanView')}" aria-label="${t('tasks.kanbanView')}">
            <i data-lucide="columns" style="width:14px;height:14px;pointer-events:none" aria-hidden="true"></i>
          </button>
        </div>
        <button class="btn btn--ghost btn--icon tasks-toolbar__select-btn" id="btn-select"
                aria-label="${t('tasks.selectMode')}" aria-pressed="false"
                title="${t('tasks.selectMode')}">
          <i data-lucide="check-square" style="width:18px;height:18px" aria-hidden="true"></i>
        </button>
        <button class="btn btn--primary tasks-toolbar__new-btn" id="btn-new-task" style="gap:var(--space-1)">
          <i data-lucide="plus" style="width:18px;height:18px" aria-hidden="true"></i> ${t('tasks.newTask')}
        </button>
        <span class="bulk-bar__count tasks-toolbar__bulk-count" id="bulk-count" hidden></span>
        <button class="btn btn--danger tasks-toolbar__bulk-btn" id="btn-bulk-delete" hidden>${t('tasks.bulkDelete')}</button>
      </div>
    </div>

    <div class="tasks-filters" id="filter-bar"></div>

    <div id="task-list"></div>
    <button class="page-fab" id="fab-new-task" aria-label="${t('tasks.newTask')}">
      <i data-lucide="plus" style="width:24px;height:24px" aria-hidden="true"></i>
    </button>
  `;

  if (window.lucide) window.lucide.createIcons();

  // Reset select state when entering household view
  state.selectMode = false;
  state.selectedIds.clear();

  wireViewToggle(container);
  wireNewTaskBtn(container);
  wireSelectMode(container);
  wireTaskList(container);
  renderFilters(container);
  renderTaskList(container);
}

// --------------------------------------------------------
// Haupt-Render
// --------------------------------------------------------

export async function render(container, { user }) {
  // Re-read view preference on each render (handles "All" button from dashboard)
  state.viewMode  = localStorage.getItem('tasks-view') || 'list';
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
    const [tasksData, metaData, listsData] = await Promise.all([
      api.get('/tasks'),
      api.get('/tasks/meta/options'),
      api.get('/personal-lists'),
    ]);
    state.tasks     = tasksData.data ?? [];
    state.users     = metaData.users ?? [];
    state.taskLists = listsData.data ?? [];
  } catch (err) {
    console.error('[Tasks] Ladefehler:', err.message);
    window.planner.showToast(t('tasks.loadError'), 'danger');
    state.tasks     = [];
    state.users     = [];
    state.taskLists = [];
  }

  // Validate active tab — fall back to household if list no longer exists
  if (state.activeTab !== 'household'
      && !state.taskLists.some((l) => l.id === state.activeTab)) {
    state.activeTab = 'household';
    localStorage.setItem('tasks-active-tab', 'household');
  }

  // Pre-load items for active personal list
  if (state.activeTab !== 'household') {
    await loadPersonalItems(state.activeTab);
  }

  // Reset select state on page load
  state.selectMode = false;
  state.selectedIds.clear();

  renderTaskTabsBar(container);
  wireTaskTabsBar(container);
  wirePersonalTabsReorder(container);

  // Dashboard hints force the household view
  const forceHousehold = localStorage.getItem('tasks-create-new')
                       || localStorage.getItem('tasks-open-task');
  if (forceHousehold && state.activeTab !== 'household') {
    state.activeTab = 'household';
    localStorage.setItem('tasks-active-tab', 'household');
    renderTaskTabsBar(container);
  }

  if (state.activeTab === 'household') {
    renderHouseholdView(container);
  } else {
    renderPersonalView(container);
  }

  // Dashboard FAB → open new task modal immediately (household only)
  if (localStorage.getItem('tasks-create-new')) {
    localStorage.removeItem('tasks-create-new');
    openTaskModal({ users: state.users }, container);
  }

  // Dashboard task widget → open the specific task that was clicked
  const pendingTaskId = localStorage.getItem('tasks-open-task');
  if (pendingTaskId) {
    localStorage.removeItem('tasks-open-task');
    const task = state.tasks.find((t) => t.id === parseInt(pendingTaskId, 10));
    if (task) openTaskModal({ task, users: state.users }, container);
  }
}
