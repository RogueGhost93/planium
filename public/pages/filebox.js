/**
 * Modul: Filebox
 * Zweck: Einfacher Datei-Ablage: Global (geteilt) + Privat (pro Nutzer)
 * Abhängigkeiten: /api.js, /components/modal.js
 */

import { api } from '/api.js';
import { esc } from '/utils/html.js';
import { showConfirm } from '/components/modal.js';

const PREVIEW_THUMBNAIL_EXTS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'ico', 'avif', 'heic', 'heif', 'tif', 'tiff', 'svg',
  'pdf', 'mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', 'ogv',
]);

// --------------------------------------------------------
// State
// --------------------------------------------------------
let state = {
  scope: 'global', // 'global' | 'private'
  files: [],
  loading: false,
  upload: null, // { label, loaded, total } while an upload is in progress
  selectMode: false,
  selectedNames: new Set(),
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
  if (['jpg','jpeg','png','gif','webp','svg','bmp','ico','avif','heic','heif','tif','tiff'].includes(ext)) return 'image';
  if (['mp4','mov','webm','mkv','avi','m4v','ogv'].includes(ext)) return 'video';
  if (['mp3','wav','flac','ogg','m4a'].includes(ext)) return 'music';
  if (['pdf'].includes(ext)) return 'file-text';
  if (['zip','tar','gz','7z','rar'].includes(ext)) return 'archive';
  if (['doc','docx','odt'].includes(ext)) return 'file-text';
  if (['xls','xlsx','csv','ods'].includes(ext)) return 'table';
  if (['md','txt','log','json','yaml','yml','xml'].includes(ext)) return 'file-text';
  return 'file';
}

function isPreviewFile(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return PREVIEW_THUMBNAIL_EXTS.has(ext);
}

function useThumbnailPreviews() {
  return !window.matchMedia('(max-width: 767px)').matches;
}

function thumbFallbackIconFor(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['mp4','mov','webm','mkv','avi','m4v','ogv'].includes(ext)) return 'video';
  if (['pdf'].includes(ext)) return 'file-text';
  if (['jpg','jpeg','png','gif','webp','bmp','ico','avif','heic','heif','tif','tiff','svg'].includes(ext)) return 'image';
  return fileIconFor(name);
}

function thumbnailUrlFor(name) {
  return `/api/v1/filebox/thumbnail/${encodeURIComponent(state.scope)}/${encodeURIComponent(name)}?size=160`;
}

function downloadUrlFor(name) {
  return `/api/v1/filebox/download/${encodeURIComponent(state.scope)}/${encodeURIComponent(name)}`;
}

function scopeLabel(scope) {
  return scope === 'global' ? 'Global files' : 'Private files';
}

function syncSelectedNames() {
  const valid = new Set(state.files.map((f) => f.name));
  for (const name of [...state.selectedNames]) {
    if (!valid.has(name)) state.selectedNames.delete(name);
  }
}

function setSelectMode(next) {
  state.selectMode = next;
  if (!next) state.selectedNames.clear();
  renderToolbarState();
  renderList();
}

function toggleSelected(name) {
  if (state.selectedNames.has(name)) state.selectedNames.delete(name);
  else state.selectedNames.add(name);
  renderToolbarState();
  renderList();
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
    syncSelectedNames();
  } catch (err) {
    window.planium.showToast(err.message || 'Failed to load files', 'danger');
    state.files = [];
  } finally {
    state.loading = false;
    renderAll();
  }
}

function xhrUpload({ url, headers = {}, body, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      });
    }
    xhr.addEventListener('load', () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch (_) {}
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, data });
    });
    xhr.addEventListener('error', () => reject(new TypeError('Network error during upload')));
    xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));
    xhr.send(body);
  });
}

function setUploadProgress(label, loaded, total) {
  const first = !state.upload;
  state.upload = { label, loaded, total };
  const dz = _container?.querySelector('#filebox-dropzone');
  if (!dz) return;
  const prog = dz.querySelector('.filebox-dropzone__progress');
  if (first || !prog) {
    renderDropzone();
    return;
  }
  const percent = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  prog.querySelector('.filebox-dropzone__progress-label').textContent =
    `${label} — ${formatBytes(loaded)} / ${formatBytes(total)} (${percent}%)`;
  prog.querySelector('.filebox-dropzone__progress-bar > div').style.width = `${percent}%`;
}

function clearUploadProgress() {
  state.upload = null;
  renderDropzone();
}

async function uploadOneRaw(file, onProgress) {
  const url = `/api/v1/filebox/upload-raw?scope=${encodeURIComponent(state.scope)}&filename=${encodeURIComponent(file.name)}`;
  const result = await xhrUpload({
    url,
    headers: {
      'X-CSRF-Token': getCsrfToken(),
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
    onProgress,
  });
  if (!result.ok) throw new Error(result.data?.error || `Upload failed (${result.status})`);
  return result.data;
}

async function uploadFiles(fileList) {
  if (!fileList?.length) return;
  if (state.upload) return;
  const files = Array.from(fileList);
  const totalBytes = files.reduce((sum, f) => sum + (f.size || 0), 0);
  const label = files.length === 1 ? `Uploading ${files[0].name}` : `Uploading ${files.length} files`;

  setUploadProgress(label, 0, totalBytes);

  // First attempt: standard multipart upload (one request, all files).
  const form = new FormData();
  for (const file of files) form.append('file', file);

  try {
    const result = await xhrUpload({
      url: `/api/v1/filebox/upload?scope=${state.scope}`,
      headers: { 'X-CSRF-Token': getCsrfToken() },
      body: form,
      onProgress: (loaded, total) => setUploadProgress(label, loaded, total),
    });
    if (!result.ok) {
      console.error('[filebox] multipart upload failed', result.status, result.data);
      throw new Error(result.data?.error || `Upload failed (${result.status})`);
    }
    const n = result.data?.files?.length || 0;
    clearUploadProgress();
    window.planium.showToast(`Uploaded ${n} file${n === 1 ? '' : 's'}`, 'success');
    await loadFiles();
    return;
  } catch (err) {
    const isNetworkErr = err.name === 'TypeError' && /fetch|load|network/i.test(err.message);
    if (!isNetworkErr) {
      console.error('[filebox] upload error', err);
      clearUploadProgress();
      window.planium.showToast(err.message || 'Upload failed', 'danger');
      return;
    }
    // Fallback path: raw binary, one file at a time. Bypasses any
    // multipart-related issues in some browsers (Brave Android).
    console.warn('[filebox] multipart failed, falling back to raw upload', err);
  }

  let ok = 0;
  let lastError = null;
  let cumulative = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const perFileLabel = files.length === 1
      ? `Uploading ${file.name}`
      : `Uploading ${file.name} (${i + 1}/${files.length})`;
    try {
      await uploadOneRaw(file, (loaded) => {
        setUploadProgress(perFileLabel, cumulative + loaded, totalBytes);
      });
      cumulative += file.size || 0;
      ok++;
    } catch (err) {
      console.error('[filebox] raw upload failed for', file.name, err);
      lastError = err;
    }
  }
  clearUploadProgress();
  if (ok > 0) {
    window.planium.showToast(`Uploaded ${ok} of ${files.length} file${files.length === 1 ? '' : 's'}`, ok === files.length ? 'success' : 'danger');
    await loadFiles();
  } else {
    const detail = lastError?.message || 'Failed to fetch';
    window.planium.showToast(`Upload failed: ${detail}. Check Brave Shields or try Chrome.`, 'danger');
  }
}

async function deleteFile(name) {
  const ok = await showConfirm(`"${name}" will be permanently deleted.`, {
    title: 'Delete file?',
    okLabel: 'Delete',
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

async function deleteSelectedFiles() {
  const names = [...state.selectedNames];
  if (!names.length) return;

  const ok = await showConfirm(
    `Delete ${names.length} selected file${names.length === 1 ? '' : 's'}?`,
    {
      title: 'Delete files?',
      okLabel: 'Delete',
      danger: true,
    },
  );
  if (!ok) return;

  try {
    const results = await Promise.allSettled(names.map((name) => api.delete(`/filebox/${state.scope}/${encodeURIComponent(name)}`)));
    const deleted = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - deleted;

    state.selectedNames.clear();
    state.selectMode = false;
    renderToolbarState();
    await loadFiles();

    if (failed === 0) {
      window.planium.showToast(`Deleted ${deleted} file${deleted === 1 ? '' : 's'}`, 'success');
    } else {
      window.planium.showToast(`Deleted ${deleted} file${deleted === 1 ? '' : 's'}; ${failed} failed`, 'danger');
    }
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

function renderToolbarState() {
  const selectBtn = _container?.querySelector('#filebox-select-btn');
  const bulkDeleteBtn = _container?.querySelector('#filebox-bulk-delete-btn');
  const subtitle = _container?.querySelector('#filebox-toolbar-subtitle');
  const listEl = _container?.querySelector('#filebox-list');
  if (selectBtn) {
    selectBtn.classList.toggle('btn--primary', state.selectMode);
    selectBtn.classList.toggle('btn--ghost', !state.selectMode);
    selectBtn.setAttribute('aria-pressed', String(state.selectMode));
    selectBtn.setAttribute('aria-label', state.selectMode ? 'Exit select mode' : 'Enter select mode');
  }
  if (bulkDeleteBtn) {
    bulkDeleteBtn.hidden = !state.selectMode || state.selectedNames.size === 0;
    const label = bulkDeleteBtn.querySelector('span');
    if (label) {
      label.textContent = state.selectedNames.size
        ? `Delete ${state.selectedNames.size}`
        : 'Delete selected';
    }
    bulkDeleteBtn.setAttribute('aria-label', state.selectedNames.size
      ? `Delete ${state.selectedNames.size} selected files`
      : 'Delete selected files');
  }
  if (subtitle) {
    subtitle.textContent = state.selectMode
      ? (state.selectedNames.size ? `${state.selectedNames.size} selected` : 'Tap files to select')
      : scopeLabel(state.scope);
  }
  if (listEl) {
    listEl.classList.toggle('filebox-list--select-mode', state.selectMode);
  }
}

function renderDropzone() {
  const dz = _container?.querySelector('#filebox-dropzone');
  if (!dz) return;

  if (state.upload) {
    const { label, loaded, total } = state.upload;
    const percent = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
    dz.classList.add('filebox-dropzone--uploading');
    dz.classList.remove('filebox-dropzone--empty', 'filebox-dropzone--active');
    dz.innerHTML = `
      <div class="filebox-dropzone__progress">
        <div class="filebox-dropzone__progress-label">${esc(label)} — ${formatBytes(loaded)} / ${formatBytes(total)} (${percent}%)</div>
        <div class="filebox-dropzone__progress-bar"><div style="width: ${percent}%"></div></div>
      </div>
    `;
    return;
  }

  dz.classList.remove('filebox-dropzone--uploading');
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
  const showThumbnails = useThumbnailPreviews();
  renderToolbarState();

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
    <div class="filebox-item${state.selectedNames.has(f.name) ? ' filebox-item--selected' : ''}" data-name="${esc(f.name)}">
      ${state.selectMode ? `
        <button type="button" class="filebox-item__select" data-action="toggle-select" aria-pressed="${state.selectedNames.has(f.name)}" aria-label="Select ${esc(f.name)}">
          ${state.selectedNames.has(f.name) ? '<i data-lucide="check" aria-hidden="true"></i>' : ''}
        </button>
      ` : ''}
      ${showThumbnails && isPreviewFile(f.name) ? `
        <span class="filebox-item__thumb filebox-item__thumb--image" aria-hidden="true">
          <img class="filebox-item__thumb-img" src="${thumbnailUrlFor(f.name)}" alt="" loading="lazy" decoding="async">
          <i data-lucide="${thumbFallbackIconFor(f.name)}" class="filebox-item__thumb-fallback" aria-hidden="true"></i>
        </span>
      ` : `
        <span class="filebox-item__thumb filebox-item__thumb--icon" aria-hidden="true">
          <i data-lucide="${fileIconFor(f.name)}"></i>
        </span>
      `}
      <div class="filebox-item__body">
        <div class="filebox-item__name" title="${esc(f.name)}">${esc(f.name)}</div>
        <div class="filebox-item__meta">
          <span>${formatBytes(f.size)}</span>
          <span class="filebox-item__meta-dot" aria-hidden="true"></span>
          <span>${formatDate(f.modifiedAt)}</span>
        </div>
      </div>
      ${state.selectMode ? '' : `
        <div class="filebox-item__actions">
          <a class="filebox-item__btn" href="${downloadUrlFor(f.name)}" title="Download" aria-label="Download">
            <i data-lucide="download" aria-hidden="true"></i>
          </a>
          <button class="filebox-item__btn filebox-item__btn--danger" data-action="delete" title="Delete" aria-label="Delete">
            <i data-lucide="trash-2" aria-hidden="true"></i>
          </button>
        </div>
      `}
    </div>
  `).join('');
  window.lucide?.createIcons();

  listEl.querySelectorAll('.filebox-item__thumb-img').forEach((img) => {
    img.addEventListener('error', () => {
      const thumb = img.closest('.filebox-item__thumb');
      if (thumb) thumb.classList.add('filebox-item__thumb--broken');
      img.hidden = true;
    }, { once: true });
  });

  listEl.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const name = e.currentTarget.closest('.filebox-item')?.dataset.name;
      if (name) deleteFile(name);
    });
  });

  listEl.querySelectorAll('[data-action="toggle-select"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const name = e.currentTarget.closest('.filebox-item')?.dataset.name;
      if (name) toggleSelected(name);
    });
  });

  listEl.querySelectorAll('.filebox-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      if (!state.selectMode) return;
      if (e.target.closest('button,a,input,label')) return;
      const name = item.dataset.name;
      if (name) toggleSelected(name);
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
  state.selectedNames.clear();
  state.selectMode = false;
  _container.querySelectorAll('[data-scope]').forEach(btn => {
    btn.classList.toggle('filebox-scope__btn--active', btn.dataset.scope === scope);
    btn.setAttribute('aria-pressed', btn.dataset.scope === scope ? 'true' : 'false');
  });
  renderToolbarState();
  loadFiles();
}

// --------------------------------------------------------
// Entry point
// --------------------------------------------------------

export async function render(container, _context) {
  _container = container;

  // Web Share Target landing — toast for files shared from another app.
  const params = new URLSearchParams(window.location.search);
  const shared = params.get('shared');
  const sharedScope = params.get('scope');
  if (shared) {
    if (shared === 'disabled') {
      window.planium.showToast('Enable Filebox in Settings to receive shared files', 'danger');
    } else if (shared === 'error') {
      window.planium.showToast('Sharing failed. Please try again.', 'danger');
    } else {
      const n = parseInt(shared, 10) || 0;
      if (n > 0) {
        window.planium.showToast(`Received ${n} shared file${n === 1 ? '' : 's'}`, 'success');
        state.scope = sharedScope === 'private' ? 'private' : sharedScope === 'global' ? 'global' : 'private';
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
        <div class="filebox-toolbar__heading">
          <h1 class="filebox-toolbar__title">Filebox</h1>
          <div class="filebox-toolbar__subtitle" id="filebox-toolbar-subtitle">${scopeLabel(state.scope)}</div>
        </div>
        <div class="filebox-scope" role="tablist" aria-label="Scope">
          <button type="button" class="filebox-scope__btn ${state.scope === 'global' ? 'filebox-scope__btn--active' : ''}" data-scope="global" aria-pressed="${state.scope === 'global'}" aria-label="Show global files" title="Global">
            <i data-lucide="users" aria-hidden="true"></i><span>Global</span>
          </button>
          <button type="button" class="filebox-scope__btn ${state.scope === 'private' ? 'filebox-scope__btn--active' : ''}" data-scope="private" aria-pressed="${state.scope === 'private'}" aria-label="Show private files" title="Private">
            <i data-lucide="user" aria-hidden="true"></i><span>Private</span>
          </button>
        </div>
        <div class="filebox-toolbar__actions">
          <button type="button" class="btn btn--ghost filebox-toolbar__btn" id="filebox-select-btn" aria-pressed="false" aria-label="Enter select mode" title="Select files">
            <i data-lucide="check-square" aria-hidden="true"></i><span>Select</span>
          </button>
          <button type="button" class="btn btn--danger filebox-toolbar__btn" id="filebox-bulk-delete-btn" hidden aria-label="Delete selected files" title="Delete selected files">
            <i data-lucide="trash-2" aria-hidden="true"></i><span>Delete selected</span>
          </button>
          <input type="file" id="filebox-file-input" multiple hidden
                 accept=".iso,.kdbx,.kdb,.dmg,.apk,.epub,.mobi,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.ods,.zip,.tar,.gz,.7z,.rar,.txt,.log,.json,.xml,.yaml,.yml,.md,.ics,.vcf,.mp3,.mp4,.mov,.webm,.mkv,.avi,.wav,.flac,.ogg,.m4a,.jpg,.jpeg,.png,.gif,.webp,.svg,.bmp,.ico,.ttf,.otf,.woff,.woff2,.key,.pem,.der,.p12,.pfx,.p8,.gpg,.asc,.crt,.cer,.jks,.keystore,.1pif,.opvault,.psafe3,.psafe,.rfo,.enpass,.lpass,.dcvault" />
        </div>
      </div>

      <div class="filebox-stats" id="filebox-stats" aria-live="polite"></div>

      <div class="filebox-dropzone" id="filebox-dropzone" role="button" tabindex="0" aria-label="Upload files"></div>

      <div class="filebox-list" id="filebox-list"></div>
      <button type="button" class="page-fab filebox-fab" id="filebox-upload-fab" aria-label="Upload files" title="Upload files" style="--module-accent: var(--module-filebox);">
          <i data-lucide="upload" aria-hidden="true"></i>
      </button>
    </div>
  `;

  window.lucide?.createIcons();

  // Scope toggle
  container.querySelectorAll('[data-scope]').forEach(btn => {
    btn.addEventListener('click', () => switchScope(btn.dataset.scope));
  });

  container.querySelector('#filebox-select-btn')?.addEventListener('click', () => {
    setSelectMode(!state.selectMode);
  });
  container.querySelector('#filebox-bulk-delete-btn')?.addEventListener('click', () => {
    deleteSelectedFiles();
  });

  // Upload button + file input
  const fileInput = container.querySelector('#filebox-file-input');
  container.querySelector('#filebox-upload-fab')?.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    uploadFiles(fileInput.files);
    fileInput.value = '';
  });

  // Drag-and-drop (and click to upload)
  const dz = container.querySelector('#filebox-dropzone');
  dz.addEventListener('click', () => { if (!state.upload) fileInput.click(); });
  dz.addEventListener('keydown', (e) => {
    if (state.upload) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  ['dragenter', 'dragover'].forEach(ev => {
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      if (!state.upload) dz.classList.add('filebox-dropzone--active');
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
    if (state.upload) return;
    if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
  });

  renderToolbarState();
  await loadFiles();
}
