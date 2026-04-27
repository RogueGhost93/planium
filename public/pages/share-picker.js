import { api, ApiError } from '/api.js';
import { esc } from '/utils/html.js';

export async function render(container) {
  const params      = new URLSearchParams(window.location.search);
  const sharedUrl   = params.get('shared_url') || '';
  const sharedTitle = params.get('shared_title') || '';

  // Nothing to share — go home.
  if (!sharedUrl) {
    window.planium.navigate('/');
    return;
  }

  // Clean the URL so a back-nav doesn't re-trigger the picker.
  history.replaceState({}, '', '/share-picker');

  const displayLabel = sharedTitle || sharedUrl;

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                min-height:60vh;padding:var(--space-6)">
      <div style="max-width:420px;width:100%">
        <p style="font-size:13px;font-weight:600;color:var(--color-text-secondary);
                  text-transform:uppercase;letter-spacing:.05em;margin-bottom:var(--space-2)">
          Save to Planium
        </p>
        <p style="font-size:15px;color:var(--color-text-primary);margin-bottom:var(--space-6);
                  word-break:break-all;line-height:1.4">
          ${esc(displayLabel)}
        </p>
        <div style="display:flex;flex-direction:column;gap:var(--space-3)">
          <button id="pick-task" class="btn btn--primary"
                  style="padding:var(--space-4);font-size:16px;justify-content:center">
            Add as Task
          </button>
          <button id="pick-bookmark" class="btn btn--secondary"
                  style="padding:var(--space-4);font-size:16px;justify-content:center">
            Save as Bookmark
          </button>
        </div>
      </div>
    </div>
  `;

  const taskParams = new URLSearchParams();
  taskParams.set('shared_url', sharedUrl);
  if (sharedTitle) taskParams.set('shared_title', sharedTitle);

  container.querySelector('#pick-task').addEventListener('click', () => {
    window.planium.navigate(`/tasks?${taskParams.toString()}`);
  });

  container.querySelector('#pick-bookmark').addEventListener('click', async () => {
    const btn = container.querySelector('#pick-bookmark');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await api.post('/linkding/bookmarks', { url: sharedUrl, title: sharedTitle });
      window.planium.showToast('Bookmark saved', 'success');
      window.planium.navigate('/bookmarks');
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Save as Bookmark';
      const msg = err instanceof ApiError && err.status === 503
        ? 'Bookmarks not configured — check Settings'
        : 'Could not save bookmark';
      window.planium.showToast(msg, 'danger');
    }
  });
}
