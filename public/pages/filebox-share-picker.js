import { api, ApiError } from '/api.js';
import { openModal, closeModal } from '/components/modal.js';
import { esc } from '/utils/html.js';

export async function render(container) {
  const params = new URLSearchParams(window.location.search);
  const batch = params.get('batch') || '';
  const count = parseInt(params.get('count') || '0', 10) || 0;

  if (!batch) {
    window.planium.navigate('/filebox');
    return;
  }

  history.replaceState({}, '', '/filebox-share-picker');
  container.innerHTML = `<div style="padding:var(--space-6);color:var(--color-text-secondary);font-size:14px">Opening…</div>`;
  let handled = false;

  const finish = async (scope) => {
    handled = true;
    const btns = [...document.querySelectorAll('#filebox-share-private, #filebox-share-global, #filebox-share-cancel')];
    btns.forEach((btn) => { btn.disabled = true; });
    try {
      const res = await api.post(`/filebox/share-batches/${encodeURIComponent(batch)}/commit`, { scope });
      const files = res.files || [];
      closeModal();
      window.planium.navigate(`/filebox?scope=${encodeURIComponent(res.scope || scope)}&shared=${files.length || count}`);
    } catch (err) {
      const message = err instanceof ApiError ? (err.data?.error || err.message) : (err.message || 'Could not finalize shared files');
      window.planium.showToast(message, 'danger');
      btns.forEach((btn) => { btn.disabled = false; });
    }
  };

  const cancel = async () => {
    handled = true;
    try {
      await api.delete(`/filebox/share-batches/${encodeURIComponent(batch)}`);
    } catch (_) {
      /* best-effort cleanup */
    } finally {
      closeModal();
      window.planium.navigate('/filebox');
    }
  };

  openModal({
    title: 'Shared Files',
    size: 'sm',
    content: `
      <div style="display:grid;gap:var(--space-4)">
        <div>
          <h1 style="margin:0 0 var(--space-2);font-size:20px;line-height:1.2">Where should these files go?</h1>
          <p style="margin:0;font-size:14px;line-height:1.5;color:var(--color-text-secondary)">
            ${count > 0 ? esc(`${count} shared file${count === 1 ? '' : 's'} received`) : 'Shared files received'}
          </p>
        </div>

        <div style="display:grid;gap:var(--space-3)">
          <button type="button" id="filebox-share-global" class="btn btn--primary" style="justify-content:center;min-height:48px">
            Global tab
          </button>
          <button type="button" id="filebox-share-private" class="btn btn--secondary" style="justify-content:center;min-height:48px">
            Private tab
          </button>
        </div>

        <div style="display:flex;justify-content:flex-end">
          <button type="button" id="filebox-share-cancel" class="btn btn--ghost">Cancel</button>
        </div>
      </div>
    `,
    onClose() {
      if (handled) return;
      void api.delete(`/filebox/share-batches/${encodeURIComponent(batch)}`).catch(() => {}).finally(() => {
        window.planium.navigate('/filebox');
      });
    },
    onSave(panel) {
      panel.querySelector('#filebox-share-global')?.addEventListener('click', () => finish('global'));
      panel.querySelector('#filebox-share-private')?.addEventListener('click', () => finish('private'));
      panel.querySelector('#filebox-share-cancel')?.addEventListener('click', () => cancel());
    },
  });
}
