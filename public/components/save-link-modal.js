/**
 * Modul: Save Link Modal
 * Zweck: Modal zum Speichern von Links in Linkding oder als Task
 * Abhängigkeiten: /api.js, /components/modal.js
 */

import { api, ApiError } from '/api.js';
import { openModal, closeModal } from '/components/modal.js';
import { esc } from '/utils/html.js';

/**
 * Opens a modal to save a link to Linkding or as a task.
 * @param {string} initialUrl - Pre-fill URL field (optional)
 * @param {string} initialTitle - Pre-fill title field (optional)
 */
export async function openSaveLinkModal(initialUrl = '', initialTitle = '') {
  let taskLists = [];
  let selectedTarget = 'linkding';
  let linkdingConfigured = false;

  try {
    const [listsRes, statusRes] = await Promise.allSettled([
      api.get('/task-lists'),
      api.get('/linkding/status'),
    ]);
    if (listsRes.status === 'fulfilled') {
      taskLists = listsRes.value.data ?? [];
    }
    if (statusRes.status === 'fulfilled') {
      linkdingConfigured = statusRes.value.configured ?? false;
    }
  } catch (_) {
    /* non-critical */
  }

  const html = `
    <form id="save-link-form" style="display:flex;flex-direction:column;gap:var(--space-3)">
      <div class="form-group">
        <label class="form-label" for="save-link-url">URL <span class="form-hint" style="display:inline">(required)</span></label>
        <input
          class="form-input"
          type="url"
          id="save-link-url"
          placeholder="https://example.com"
          value="${esc(initialUrl)}"
          required
          style="font-size:16px"
        />
      </div>

      <div class="form-group">
        <label class="form-label" for="save-link-title">Title <span class="form-hint" style="display:inline">(optional)</span></label>
        <input
          class="form-input"
          type="text"
          id="save-link-title"
          placeholder="Article Title"
          value="${esc(initialTitle)}"
          maxlength="500"
          style="font-size:16px"
        />
      </div>

      <div class="form-group">
        <label class="form-label">Destination</label>
        <div style="display:flex;gap:var(--space-3)">
          ${linkdingConfigured ? `
            <label class="settings-toggle-label" style="cursor:pointer;display:flex;align-items:center;gap:var(--space-2);margin:0">
              <input
                type="radio"
                name="save-link-target"
                value="linkding"
                checked
                style="cursor:pointer"
              />
              <span>Linkding</span>
            </label>
          ` : ''}
          ${taskLists.length > 0 ? `
            <label class="settings-toggle-label" style="cursor:pointer;display:flex;align-items:center;gap:var(--space-2);margin:0">
              <input
                type="radio"
                name="save-link-target"
                value="task"
                style="cursor:pointer"
              />
              <span>Task</span>
            </label>
          ` : ''}
        </div>
        ${!linkdingConfigured && taskLists.length === 0 ? `
          <span class="form-hint" style="color:var(--color-danger)">No destinations configured. Set up Linkding or task lists in Settings.</span>
        ` : ''}
      </div>

      ${taskLists.length > 0 ? `
        <div class="form-group" id="task-list-group" style="display:none">
          <label class="form-label" for="save-link-task-list">Task List</label>
          <select class="form-input" id="save-link-task-list">
            ${taskLists.map((list) => `<option value="${list.id}">${esc(list.name)}</option>`).join('')}
          </select>
        </div>
      ` : ''}

      ${linkdingConfigured ? `
        <div class="form-group" id="linkding-options-group">
          <label class="settings-toggle-label" for="save-link-mark-read">
            <input type="checkbox" id="save-link-mark-read" />
            <span>Mark as read</span>
          </label>
        </div>
      ` : ''}

      <div id="save-link-error" class="form-error" hidden></div>

      <button type="submit" class="btn btn--primary" style="align-self:flex-end">Save Link</button>
    </form>
  `;

  openModal({
    title: 'Save Link',
    content: html,
    onSave: null,
    size: 'small',
  });

  const form = document.querySelector('#save-link-form');
  if (!form) return;

  const urlInput = form.querySelector('#save-link-url');
  const titleInput = form.querySelector('#save-link-title');
  const targetRadios = form.querySelectorAll('input[name="save-link-target"]');
  const taskListGroup = form.querySelector('#task-list-group');
  const taskListSelect = form.querySelector('#save-link-task-list');
  const linkdingGroup = form.querySelector('#linkding-options-group');
  const markReadCheck = form.querySelector('#save-link-mark-read');
  const errorEl = form.querySelector('#save-link-error');

  // Show/hide task list select based on target
  targetRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      selectedTarget = radio.value;
      if (taskListGroup) {
        taskListGroup.style.display = selectedTarget === 'task' ? 'block' : 'none';
      }
      if (linkdingGroup) {
        linkdingGroup.style.display = selectedTarget === 'linkding' ? 'block' : 'none';
      }
    });
  });

  // Set initial visibility
  if (taskListGroup) {
    taskListGroup.style.display = selectedTarget === 'task' ? 'block' : 'none';
  }
  if (linkdingGroup) {
    linkdingGroup.style.display = selectedTarget === 'linkding' ? 'block' : 'none';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;

    const url = urlInput.value.trim();
    const title = titleInput.value.trim() || null;

    if (!url) {
      errorEl.textContent = 'URL is required';
      errorEl.hidden = false;
      return;
    }

    const target = selectedTarget;
    if (!target || !['linkding', 'task'].includes(target)) {
      errorEl.textContent = 'Invalid destination';
      errorEl.hidden = false;
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      const payload = {
        url,
        title,
        target,
        markAsRead: markReadCheck?.checked ?? false,
      };

      if (target === 'task') {
        payload.taskListId = parseInt(taskListSelect.value, 10);
      }

      await api.post('/save-link', payload);

      const message = target === 'linkding'
        ? 'Link saved to Linkding'
        : 'Task created successfully';

      window.planium?.showToast(message, 'success');
      closeModal();
    } catch (err) {
      if (err instanceof ApiError) {
        errorEl.textContent = err.data?.error ?? err.message;
      } else {
        errorEl.textContent = err.message || 'Failed to save link';
      }
      errorEl.hidden = false;
      submitBtn.disabled = false;
    }
  });

  urlInput.focus();
}

export default { openSaveLinkModal };
