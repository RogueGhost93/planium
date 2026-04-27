import { api, ApiError } from '/api.js';
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
    api.get('/personal-lists'),
    api.get('/linkding/status'),
  ]);

  const lists             = listsResult.status === 'fulfilled' ? (listsResult.value.data ?? []) : [];
  const linkdingAvailable = linkdingResult.status === 'fulfilled' && linkdingResult.value?.configured;
  const displayLabel      = sharedTitle || sharedUrl;

  const listOptions = lists.map(l =>
    `<option value="${esc(String(l.id))}">${esc(l.name)}</option>`
  ).join('');

  container.innerHTML = `
    <div style="max-width:480px;margin:0 auto;padding:var(--space-4) var(--space-4) var(--space-8)">

      <div style="padding:var(--space-3);background:var(--color-surface-secondary);
                  border-radius:var(--radius-sm);margin-bottom:var(--space-5)">
        <p style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;
                  color:var(--color-text-secondary);margin:0 0 4px">Sharing</p>
        <p style="font-size:14px;color:var(--color-text-primary);
                  word-break:break-all;line-height:1.4;margin:0">${esc(displayLabel)}</p>
      </div>

      <!-- Task form -->
      <section style="margin-bottom:var(--space-6)">
        <h3 style="font-size:14px;font-weight:600;margin:0 0 var(--space-3)">Add as Task</h3>
        <form id="task-form" novalidate>
          <div class="form-group">
            <label class="label" for="task-title">Title</label>
            <input id="task-title" class="input" type="text"
                   value="${esc(sharedTitle || sharedUrl)}" autocomplete="off" required>
          </div>
          <div class="form-group">
            <label class="label" for="task-desc">Description</label>
            <textarea id="task-desc" class="input" rows="2"
                      style="resize:vertical">${esc(sharedUrl)}</textarea>
          </div>
          ${lists.length > 1 ? `
          <div class="form-group">
            <label class="label" for="task-list">List</label>
            <select id="task-list" class="input" style="min-height:44px">${listOptions}</select>
          </div>` : ''}
          <div id="task-error" class="login-error" hidden></div>
          <button type="submit" class="btn btn--primary" style="width:100%;margin-top:var(--space-2)">
            Add Task
          </button>
        </form>
      </section>

      ${linkdingAvailable ? `
      <!-- Bookmark form -->
      <section style="border-top:1px solid var(--color-border);padding-top:var(--space-5)">
        <h3 style="font-size:14px;font-weight:600;margin:0 0 var(--space-3)">Save as Bookmark</h3>
        <form id="bookmark-form" novalidate>
          <div class="form-group">
            <label class="label" for="bm-title">Title</label>
            <input id="bm-title" class="input" type="text"
                   value="${esc(sharedTitle)}" autocomplete="off">
          </div>
          <div class="form-group">
            <label class="label" for="bm-desc">Description</label>
            <textarea id="bm-desc" class="input" rows="2" style="resize:vertical"></textarea>
          </div>
          <div class="form-group">
            <label class="label" for="bm-tags">Tags <span style="font-weight:400;color:var(--color-text-secondary)">(comma-separated)</span></label>
            <input id="bm-tags" class="input" type="text"
                   placeholder="e.g. dev, tools" autocomplete="off">
          </div>
          <label style="display:flex;align-items:center;gap:var(--space-2);
                        font-size:14px;cursor:pointer;margin-bottom:var(--space-4)">
            <input type="checkbox" id="bm-unread" checked style="width:16px;height:16px">
            Mark as unread
          </label>
          <div id="bm-error" class="login-error" hidden></div>
          <button type="submit" class="btn btn--primary" style="width:100%">
            Save Bookmark
          </button>
        </form>
      </section>` : ''}

    </div>
  `;

  // ── Task submit ──────────────────────────────────────────
  container.querySelector('#task-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn   = e.target.querySelector('[type=submit]');
    const errEl = container.querySelector('#task-error');
    errEl.hidden = true;

    const title  = container.querySelector('#task-title').value.trim();
    const desc   = container.querySelector('#task-desc').value.trim();
    const listEl = container.querySelector('#task-list');
    const listId = listEl ? listEl.value : String(lists[0]?.id ?? '');

    if (!title) {
      errEl.textContent = 'Title is required';
      errEl.hidden = false;
      return;
    }
    if (!listId) {
      errEl.textContent = 'No task list available';
      errEl.hidden = false;
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await api.post(`/personal-lists/${listId}/items`, {
        title,
        description: desc || null,
      });
      window.planium.showToast('Task added', 'success');
      window.planium.navigate('/tasks');
    } catch (err) {
      errEl.textContent = err.message || 'Could not save task';
      errEl.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Add Task';
    }
  });

  // ── Bookmark submit ──────────────────────────────────────
  if (linkdingAvailable) {
    container.querySelector('#bookmark-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn   = e.target.querySelector('[type=submit]');
      const errEl = container.querySelector('#bm-error');
      errEl.hidden = true;

      const title  = container.querySelector('#bm-title').value.trim();
      const desc   = container.querySelector('#bm-desc').value.trim();
      const tags   = container.querySelector('#bm-tags').value
        .split(',').map(t => t.trim()).filter(Boolean);
      const unread = container.querySelector('#bm-unread').checked;

      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        await api.post('/linkding/bookmarks', {
          url: sharedUrl,
          title,
          ...(desc  && { description: desc }),
          ...(tags.length && { tag_names: tags }),
          unread,
        });
        window.planium.showToast('Bookmark saved', 'success');
        window.planium.navigate('/bookmarks');
      } catch (err) {
        const msg = err instanceof ApiError && err.status === 503
          ? 'Bookmarks not configured — check Settings'
          : 'Could not save bookmark';
        errEl.textContent = msg;
        errEl.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Save Bookmark';
      }
    });
  }
}
