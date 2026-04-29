import { api } from '/api.js';
import { openModal, closeModal } from '/components/modal.js';
import { openNewBookmarkModal } from '/pages/bookmarks.js';
import { openItemEditDialog } from '/pages/tasks.js';
import { esc } from '/utils/html.js';

export async function render(container) {
  const params      = new URLSearchParams(window.location.search);
  const sharedUrl   = params.get('shared_url') || '';
  const sharedTitle = params.get('shared_title') || '';

  if (!sharedUrl) {
    window.planium.navigate('/');
    return;
  }

  history.replaceState({}, '', '/share-picker');

  container.innerHTML = `<div style="padding:var(--space-6);color:var(--color-text-secondary);font-size:14px">Loading…</div>`;

  const [listsResult, linkdingResult] = await Promise.allSettled([
    api.get('/task-lists'),
    api.get('/linkding/status'),
  ]);

  const taskLists         = listsResult.status === 'fulfilled' ? (listsResult.value.data ?? []) : [];
  const linkdingAvailable = linkdingResult.status === 'fulfilled' && linkdingResult.value?.configured;
  const displayLabel = sharedTitle || sharedUrl;

  const taskAvailable = taskLists.length > 0;
  const chooserState = [
    !taskAvailable ? 'No task list available' : null,
    !linkdingAvailable ? 'Bookmarks are not configured' : null,
  ].filter(Boolean).join(' • ');

  container.innerHTML = `<div style="padding:var(--space-6);color:var(--color-text-secondary);font-size:14px">Opening…</div>`;
  let handled = false;

  const openBookmarkEditor = () => {
    handled = true;
    closeModal();
    setTimeout(() => {
      openNewBookmarkModal(null, {
        url: sharedUrl,
        title: sharedTitle || '',
        description: '',
        tags: [],
        unread: true,
      }, () => {
        window.planium.navigate('/');
      });
    }, 0);
  };

  openModal({
    title: 'Shared Link',
    size: 'sm',
    content: `
      <div style="display:grid;gap:var(--space-4)">
        <div>
          <h1 style="margin:0 0 var(--space-2);font-size:20px;line-height:1.2">What do you want to do with this link?</h1>
          <p style="margin:0;font-size:14px;line-height:1.5;color:var(--color-text-secondary);word-break:break-word">${esc(displayLabel)}</p>
        </div>

        ${chooserState ? `
          <div style="padding:var(--space-3);border-radius:var(--radius-md);background:var(--color-surface-secondary);font-size:13px;color:var(--color-text-secondary)">
            ${esc(chooserState)}
          </div>
        ` : ''}

        <div style="display:grid;gap:var(--space-3)">
          <button type="button" id="share-as-task" class="btn btn--primary" style="justify-content:center;min-height:48px" ${taskAvailable ? '' : 'disabled'}>
            Save as Task
          </button>
          <button type="button" id="share-as-bookmark" class="btn btn--secondary" style="justify-content:center;min-height:48px" ${linkdingAvailable ? '' : 'disabled'}>
            Save as Bookmark
          </button>
        </div>

        <div style="display:flex;justify-content:flex-end">
          <button type="button" id="share-cancel" class="btn btn--ghost">Cancel</button>
        </div>
      </div>
    `,
    onClose() {
      if (!handled) window.planium.navigate('/');
    },
    onSave(panel) {
      panel.querySelector('#share-as-task')?.addEventListener('click', () => {
        if (!taskAvailable) return;
        handled = true;
        closeModal();
        setTimeout(() => {
          openItemEditDialog({
            item: {
              title: sharedTitle || sharedUrl,
              description: sharedUrl,
              labels: [],
              priority: 'none',
              due_date: '',
              due_time: '',
              alarm_at: null,
              recurrence_rule: null,
            },
            showListPicker: true,
            listId: null,
            container: document.createElement('div'),
            onSaved: () => {
              window.planium.showToast('Task added', 'success');
              window.planium.navigate('/tasks');
            },
            onClose: () => {
              window.planium.navigate('/');
            },
          });
        }, 0);
      });

      panel.querySelector('#share-as-bookmark')?.addEventListener('click', () => {
        if (!linkdingAvailable) return;
        openBookmarkEditor();
      });

      panel.querySelector('#share-cancel')?.addEventListener('click', () => {
        handled = true;
        closeModal();
        window.planium.navigate('/');
      });
    },
  });
}
