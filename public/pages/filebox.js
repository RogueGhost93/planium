/**
 * Modul: Filebox
 * Zweck: Einfacher Datei-Ablage: Global (geteilt) + Privat (pro Nutzer)
 * Abhängigkeiten: /api.js, /components/modal.js
 */

import { api } from '/api.js';
import { esc } from '/utils/html.js';
import { showConfirm } from '/components/modal.js';

// --------------------------------------------------------
// State
// --------------------------------------------------------
let state = {
  scope: 'global', // 'global' | 'private'
  files: [],
  loading: false,
};
let _container = null;

// --------------------------------------------------------
// Utilities
// --------------------------------------------------------

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let b = bytes / 1024;
  let u = 0;
  while (b >= 1024 && u < units.length - 1) { b /= 1024; u++; }
  return `${b.toFixed(b < 10 ? 1 : 0)} ${units[u]}`;
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function fileIconFor(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['jpg','jpeg','png','gif','webp','svg','bmp','ico'].includes(ext)) return 'image';
  if (['mp4','mov','webm','mkv','avi'].includes(ext)) return 'video';
  if (['mp3','wav','flac','ogg','m4a'].includes(ext)) return 'music';
  if (['pdf'].includes(ext)) return 'file-text';
  if (['zip','tar','gz','7z','rar'].includes(ext)) return 'archive';
  if (['doc','docx','odt'].includes(ext)) return 'file-text';
  if (['xls','xlsx','csv','ods'].includes(ext)) return 'table';
  if (['md','txt','log','json','yaml','yml','xml'].includes(ext)) return 'file-text';
  return 'file';
}

function getCsrfToken() {
  return document.cookie.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('csrf-token='))
    ?.slice('csrf-token='.length) ?? '';
}

// --------------------------------------------------------
// API
// --------------------------------------------------------

async function loadFiles() {
  state.loading = true;
  renderAll();
  try {
    const res = await api.get(`/filebox/files?scope=${state.scope}`);
    state.files = res.files || [];
  } catch (err) {
    window.planium.showToast(err.message || 'Failed to load files', 'danger');
    state.files = [];
  } finally {
    state.loading = false;
    renderAll();
  }
}

async function uploadOneRaw(file) {
  const url = `/api/v1/filebox/upload-raw?scope=${encodeURIComponent(state.scope)}&filename=${encodeURIComponent(file.name)}`;
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'X-CSRF-Token': getCsrfToken(),
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Upload failed (${res.status})`);
  return data;
}

async function uploadFiles(fileList) {
  if (!fileList?.length) return;
  const files = Array.from(fileList);

  // First attempt: standard multipart upload (one request, all files).
  const form = new FormData();
  for (const file of files) form.append('file', file);

  try {
    const res = await fetch(`/api/v1/filebox/upload?scope=${state.scope}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': getCsrfToken() },
      body: form,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      console.error('[filebox] multipart upload failed', res.status, data);
      throw new Error(data?.error || `Upload failed (${res.status})`);
    }
    const n = data.files?.length || 0;
    window.planium.showToast(`Uploaded ${n} file${n === 1 ? '' : 's'}`, 'success');
    await loadFiles();
    return;
  } catch (err) {
    const isNetworkErr = err.name === 'TypeError' && /fetch|load/i.test(err.message);
    if (!isNetworkErr) {
      console.error('[filebox] upload error', err);
      window.planium.showToast(err.message || 'Upload failed', 'danger');
      return;
    }
    // Fallback path: raw binary, one file at a time. Bypasses any
    // multipart-related issues in some browsers (Brave Android).
    console.warn('[filebox] multipart failed, falling back to raw upload', err);
  }

  let ok = 0;
  let lastError = null;
  for (const file of files) {
    try {
      await uploadOneRaw(file);
      ok++;
    } catch (err) {
      console.error('[filebox] raw upload failed for', file.name, err);
      lastError = err;
    }
  }
  if (ok > 0) {
    window.planium.showToast(`Uploaded ${ok} of ${files.length} file${files.length === 1 ? '' : 's'}`, ok === files.length ? 'success' : 'danger');
    await loadFiles();
  } else {
    const detail = lastError?.message || 'Failed to fetch';
    window.planium.showToast(`Upload failed: ${detail}. Check Brave Shields or try Chrome.`, 'danger');
  }
}

async function deleteFile(name) {
  const ok = await showConfirm({
    title: 'Delete file?',
    message: `"${name}" will be permanently deleted.`,
    confirmText: 'Delete',
    danger: true,
  });
  if (!ok) return;

  try {
    await api.delete(`/filebox/${state.scope}/${encodeURIComponent(name)}`);
    window.planium.showToast('Deleted', 'success');
    await loadFiles();
  } catch (err) {
    window.planium.showToast(err.message || 'Delete failed', 'danger');
  }
}

// --------------------------------------------------------
// Rendering
// --------------------------------------------------------

function renderStats() {
  const statsEl = _container?.querySelector('#filebox-stats');
  if (!statsEl) return;
  const n = state.files.length;
  const total = state.files.reduce((sum, f) => sum + (f.size || 0), 0);
  if (!n) { statsEl.innerHTML = ''; return; }
  statsEl.innerHTML = `
    <span>${n} file${n === 1 ? '' : 's'}</span>
    <span class="filebox-stats__dot" aria-hidden="true"></span>
    <span>${formatBytes(total)}</span>
  `;
}

function renderDropzone() {
  const dz = _container?.querySelector('#filebox-dropzone');
  if (!dz) return;
  const empty = state.files.length === 0;
  dz.classList.toggle('filebox-dropzone--empty', empty);
  if (empty) {
    dz.innerHTML = `
      <i data-lucide="upload-cloud" class="filebox-dropzone__icon" aria-hidden="true"></i>
      <div class="filebox-dropzone__text"><strong>Drop files here</strong> or click to browse</div>
      <div class="filebox-dropzone__hint">Files in this folder will be visible to ${state.scope === 'global' ? 'everyone' : 'only you'}.</div>
    `;
  } else {
    dz.innerHTML = `
      <i data-lucide="upload-cloud" class="filebox-dropzone__icon" aria-hidden="true"></i>
      <div class="filebox-dropzone__text"><strong>Drop files</strong> here or click to add</div>
    `;
  }
  window.lucide?.createIcons();
}

function renderList() {
  const listEl = _container?.querySelector('#filebox-list');
  if (!listEl) return;

  if (state.loading) {
    listEl.innerHTML = `
      <div class="filebox-loading">
        <i data-lucide="loader-2" aria-hidden="true"></i>
        <span>Loading…</span>
      </div>
    `;
    window.lucide?.createIcons();
    return;
  }
  if (!state.files.length) {
    listEl.innerHTML = `
      <div class="filebox-empty">
        <span class="filebox-empty__icon-wrap" aria-hidden="true">
          <i data-lucide="folder-open"></i>
        </span>
        <div class="filebox-empty__title">No files in ${state.scope === 'global' ? 'the global folder' : 'your private folder'}</div>
        <div class="filebox-empty__hint">Drag files onto the drop zone above, or click it to pick from your device.</div>
      </div>
    `;
    window.lucide?.createIcons();
    return;
  }

  listEl.innerHTML = state.files.map(f => `
    <div class="filebox-item" data-name="${esc(f.name)}">
      <span class="filebox-item__icon-wrap" aria-hidden="true">
        <i data-lucide="${fileIconFor(f.name)}"></i>
      </span>
      <div class="filebox-item__body">
        <div class="filebox-item__name" title="${esc(f.name)}">${esc(f.name)}</div>
        <div class="filebox-item__meta">
          <span>${formatBytes(f.size)}</span>
          <span class="filebox-item__meta-dot" aria-hidden="true"></span>
          <span>${formatDate(f.modifiedAt)}</span>
        </div>
      </div>
      <div class="filebox-item__actions">
        <a class="filebox-item__btn" href="/api/v1/filebox/download/${encodeURIComponent(state.scope)}/${encodeURIComponent(f.name)}" title="Download" aria-label="Download">
          <i data-lucide="download" aria-hidden="true"></i>
        </a>
        <button class="filebox-item__btn filebox-item__btn--danger" data-action="delete" title="Delete" aria-label="Delete">
          <i data-lucide="trash-2" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  `).join('');
  window.lucide?.createIcons();

  listEl.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const name = e.currentTarget.closest('.filebox-item')?.dataset.name;
      if (name) deleteFile(name);
    });
  });
}

function renderAll() {
  renderDropzone();
  renderStats();
  renderList();
}

function switchScope(scope) {
  if (scope === state.scope) return;
  state.scope = scope;
  _container.querySelectorAll('[data-scope]').forEach(btn => {
    btn.classList.toggle('filebox-scope__btn--active', btn.dataset.scope === scope);
    btn.setAttribute('aria-pressed', btn.dataset.scope === scope ? 'true' : 'false');
  });
  loadFiles();
}

// --------------------------------------------------------
// Entry point
// --------------------------------------------------------

export async function render(container, _context) {
  _container = container;

  // Web Share Target landing — toast for files shared from another app.
  const shared = new URLSearchParams(window.location.search).get('shared');
  if (shared) {
    if (shared === 'disabled') {
      window.planium.showToast('Enable Filebox in Settings to receive shared files', 'danger');
    } else if (shared === 'error') {
      window.planium.showToast('Sharing failed. Please try again.', 'danger');
    } else {
      const n = parseInt(shared, 10) || 0;
      if (n > 0) {
        window.planium.showToast(`Received ${n} shared file${n === 1 ? '' : 's'}`, 'success');
        state.scope = 'private'; // shared files land in private
      }
    }
    // Clean URL so refresh doesn't repeat the toast
    window.history.replaceState({}, '', '/filebox');
  }

  // Status check — if disabled, show the opt-in card instead.
  let status = { enabled: false };
  try { status = await api.get('/filebox/status'); } catch (_) { /* ignore */ }

  if (!status.enabled) {
    container.innerHTML = `
      <div class="filebox-page">
        <div class="filebox-optin">
          <span class="filebox-optin__icon-wrap" aria-hidden="true">
            <i data-lucide="folder-lock"></i>
          </span>
          <h2 class="filebox-optin__title">Filebox is disabled</h2>
          <p class="filebox-optin__hint">
            Enable it in Settings to upload and share files via a global folder
            or your own private folder. Host operators can bind-mount the folders
            so files dropped on the server also appear here.
          </p>
          <a href="/settings" data-route="/settings" class="btn btn--primary">Go to Settings</a>
        </div>
      </div>
    `;
    container.querySelector('[data-route]')?.addEventListener('click', (e) => {
      e.preventDefault();
      window.planium.navigate('/settings');
    });
    window.lucide?.createIcons();
    return;
  }

  container.innerHTML = `
    <div class="filebox-page">
      <div class="filebox-toolbar">
        <h1 class="filebox-toolbar__title">Filebox</h1>
        <div class="filebox-scope" role="tablist" aria-label="Scope">
          <button type="button" class="filebox-scope__btn ${state.scope === 'global' ? 'filebox-scope__btn--active' : ''}" data-scope="global" aria-pressed="${state.scope === 'global'}">
            <i data-lucide="users" aria-hidden="true"></i><span>Global</span>
          </button>
          <button type="button" class="filebox-scope__btn ${state.scope === 'private' ? 'filebox-scope__btn--active' : ''}" data-scope="private" aria-pressed="${state.scope === 'private'}">
            <i data-lucide="user" aria-hidden="true"></i><span>Private</span>
          </button>
        </div>
        <div class="filebox-toolbar__actions">
          <button type="button" class="btn btn--primary filebox-toolbar__btn" id="filebox-upload-btn">
            <i data-lucide="upload" aria-hidden="true"></i><span>Upload</span>
          </button>
          <input type="file" id="filebox-file-input" multiple hidden
                 accept="image/*,video/*,audio/*,application/*,text/*,font/*,.iso,.kdbx,.dmg,.apk,.epub,.mobi" />
        </div>
      </div>

      <div class="filebox-stats" id="filebox-stats" aria-live="polite"></div>

      <div class="filebox-dropzone" id="filebox-dropzone" role="button" tabindex="0" aria-label="Upload files"></div>

      <div class="filebox-list" id="filebox-list"></div>
    </div>
  `;

  window.lucide?.createIcons();

  // Scope toggle
  container.querySelectorAll('[data-scope]').forEach(btn => {
    btn.addEventListener('click', () => switchScope(btn.dataset.scope));
  });

  // Upload button + file input
  const fileInput = container.querySelector('#filebox-file-input');
  container.querySelector('#filebox-upload-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    uploadFiles(fileInput.files);
    fileInput.value = '';
  });

  // Drag-and-drop (and click to upload)
  const dz = container.querySelector('#filebox-dropzone');
  dz.addEventListener('click', () => fileInput.click());
  dz.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  ['dragenter', 'dragover'].forEach(ev => {
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.add('filebox-dropzone--active');
    });
  });
  ['dragleave', 'drop'].forEach(ev => {
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      if (ev === 'dragleave' && dz.contains(e.relatedTarget)) return;
      dz.classList.remove('filebox-dropzone--active');
    });
  });
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
  });

  await loadFiles();
}
