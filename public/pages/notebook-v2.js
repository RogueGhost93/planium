/**
 * Module: Notebook
 * Purpose: Hierarchical markdown notes with a Joplin-style tree/editor layout.
 */

import { api } from '/api.js';
import { showConfirm } from '/components/modal.js';
import { t } from '/i18n.js';
import { esc } from '/utils/html.js';
import { marked } from '/vendor/marked.esm.js';

marked.setOptions({ breaks: true, gfm: true });

const STORAGE_KEYS = {
  collapsed: 'planium-notebook-collapsed-v2',
  layout: 'planium-notebook-layout-v2',
};

const state = {
  notes: [],
  noteMap: new Map(),
  childrenMap: new Map(),
  activeNoteId: null,
  collapsed: loadCollapsed(),
  layout: loadLayout(),
  sidebarOpen: false,
  searchQuery: '',
  searchResults: [],
  dirty: false,
  saving: false,
  saveTimer: null,
  savePromise: null,
  pendingFocus: null,
  searchTimer: null,
  notice: '',
};

let rootEl = null;
let sidebarBodyEl = null;
let searchInputEl = null;
let editorHostEl = null;
let editorTitleEl = null;
let editorContentEl = null;
let editorPreviewEl = null;
let editorStatusEl = null;

function loadCollapsed() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.collapsed) || '[]');
    return new Set(Array.isArray(raw) ? raw.filter((id) => Number.isInteger(id)) : []);
  } catch {
    return new Set();
  }
}

function saveCollapsed() {
  try {
    localStorage.setItem(STORAGE_KEYS.collapsed, JSON.stringify([...state.collapsed]));
  } catch {
    // ignore
  }
}

function loadLayout() {
  const saved = localStorage.getItem(STORAGE_KEYS.layout);
  if (saved === 'split' || saved === 'editor' || saved === 'preview') return saved;
  return window.matchMedia('(min-width: 1200px)').matches ? 'split' : 'editor';
}

function saveLayout() {
  try {
    localStorage.setItem(STORAGE_KEYS.layout, state.layout);
  } catch {
    // ignore
  }
}

function parentKey(parentId) {
  return parentId == null ? 'root' : `parent:${parentId}`;
}

function sortNotes(notes) {
  return [...notes].sort((a, b) => (
    (a.sort_order ?? 0) - (b.sort_order ?? 0)
    || String(a.created_at || '').localeCompare(String(b.created_at || ''))
    || a.id - b.id
  ));
}

function syncIndexes(notes) {
  state.notes = notes.map((note) => ({ ...note }));
  state.noteMap = new Map();
  state.childrenMap = new Map();

  for (const note of state.notes) {
    state.noteMap.set(note.id, note);
    const key = parentKey(note.parent_id);
    if (!state.childrenMap.has(key)) state.childrenMap.set(key, []);
    state.childrenMap.get(key).push(note);
  }

  for (const [key, list] of state.childrenMap.entries()) {
    state.childrenMap.set(key, sortNotes(list));
  }

  if (!state.activeNoteId || !state.noteMap.has(state.activeNoteId)) {
    state.activeNoteId = pickDefaultNoteId();
  }
}

function getNote(noteId) {
  return state.noteMap.get(noteId) || null;
}

function getChildren(parentId) {
  return state.childrenMap.get(parentKey(parentId)) || [];
}

function pickDefaultNoteId() {
  const roots = getChildren(null);
  if (roots.length) return roots[0].id;
  return state.notes[0]?.id ?? null;
}

function getBreadcrumb(noteId) {
  const path = [];
  let current = getNote(noteId);
  while (current) {
    path.unshift(current);
    current = current.parent_id == null ? null : getNote(current.parent_id);
  }
  return path;
}

function expandAncestors(noteId) {
  let current = getNote(noteId);
  while (current?.parent_id != null) {
    state.collapsed.delete(current.parent_id);
    current = getNote(current.parent_id);
  }
  saveCollapsed();
}

function renderBreadcrumb(note) {
  const crumbs = getBreadcrumb(note.id);
  if (!crumbs.length) return `<span>${esc(t('notebook.rootLabel'))}</span>`;

  return crumbs.map((crumb, index) => {
    const isLast = index === crumbs.length - 1;
    const label = esc(crumb.title || t('notebook.untitled'));
    return isLast
      ? `<span class="notebook-breadcrumbs__current">${label}</span>`
      : `<span class="notebook-breadcrumbs__crumb">${label}</span>`;
  }).join('<span class="notebook-breadcrumbs__sep">/</span>');
}

function renderEditorStatus() {
  if (!editorStatusEl) return;
  let text = '';
  let cls = '';

  if (state.saving) {
    text = t('notebook.saving');
    cls = 'is-saving';
  } else if (state.dirty) {
    text = t('notebook.unsaved');
    cls = 'is-dirty';
  } else if (state.notice) {
    text = state.notice;
  }

  editorStatusEl.className = `notebook-editor__status ${cls}`.trim();
  editorStatusEl.textContent = text;
}

function renderSidebar() {
  if (!sidebarBodyEl) return;

  if (state.searchQuery) {
    renderSearchResults();
    return;
  }

  const roots = getChildren(null);
  if (!roots.length) {
    sidebarBodyEl.innerHTML = `
      <div class="notebook-empty-sidebar">
        <i data-lucide="book-open" aria-hidden="true"></i>
        <h2>${esc(t('notebook.empty'))}</h2>
        <p>${esc(t('notebook.emptyHint'))}</p>
        <button class="btn btn--primary notebook-new-root-btn">${esc(t('notebook.newRoot'))}</button>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  const treeHtml = renderTreeNodes(roots, 0);
  sidebarBodyEl.innerHTML = `
    <div class="notebook-tree" role="tree" aria-label="${esc(t('notebook.title'))}">
      <ul class="notebook-tree__list">${treeHtml}</ul>
    </div>
  `;
  if (window.lucide) window.lucide.createIcons();
}

function renderTreeNodes(nodes, depth) {
  return nodes.map((node) => {
    const children = getChildren(node.id);
    const collapsed = state.collapsed.has(node.id);
    const active = node.id === state.activeNoteId ? 'is-active' : '';
    const hasChildren = children.length > 0;
    const childCount = hasChildren ? `<span class="notebook-tree__count">${children.length}</span>` : '';
    const toggleIcon = collapsed ? 'chevron-right' : 'chevron-down';

    return `
      <li class="notebook-tree__node" style="--depth:${depth}">
        <div class="notebook-tree__row ${active}">
          <button class="notebook-tree__toggle" data-action="toggle" data-note-id="${node.id}" ${hasChildren ? '' : 'disabled'}>
            <i data-lucide="${hasChildren ? toggleIcon : 'dot'}" aria-hidden="true"></i>
          </button>
          <button class="notebook-tree__item" data-action="select" data-note-id="${node.id}" title="${esc(node.title || t('notebook.untitled'))}">
            <span class="notebook-tree__title">${esc(node.title || t('notebook.untitled'))}</span>
            ${childCount}
          </button>
          <button class="notebook-tree__child" data-action="new-child" data-note-id="${node.id}" aria-label="${esc(t('notebook.newChild'))}">
            <i data-lucide="plus" aria-hidden="true"></i>
          </button>
          <button class="notebook-tree__delete" data-action="delete" data-note-id="${node.id}" aria-label="${esc(t('notebook.deleteLabel'))}">
            <i data-lucide="trash-2" aria-hidden="true"></i>
          </button>
        </div>
        ${hasChildren && !collapsed ? `<ul class="notebook-tree__list">${renderTreeNodes(children, depth + 1)}</ul>` : ''}
      </li>
    `;
  }).join('');
}

function renderSearchResults() {
  const query = state.searchQuery;
  const results = state.searchResults;

  if (!results.length) {
    sidebarBodyEl.innerHTML = `
      <div class="notebook-empty-sidebar">
        <i data-lucide="search-x" aria-hidden="true"></i>
        <h2>${esc(t('notebook.noResultsTitle'))}</h2>
        <p>${esc(t('notebook.noResultsHint', { query }))}</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  sidebarBodyEl.innerHTML = `
    <div class="notebook-search-results">
      <div class="notebook-search-results__meta">
        ${esc(t('notebook.searchSummary', { count: results.length }))}
      </div>
      <div class="notebook-search-results__list">
        ${results.map(renderSearchResult).join('')}
      </div>
    </div>
  `;
  if (window.lucide) window.lucide.createIcons();
}

function renderSearchResult(result) {
  const breadcrumb = getBreadcrumb(result.id).map((crumb) => esc(crumb.title || t('notebook.untitled'))).join(' / ');
  return `
    <button class="notebook-search-result" data-action="select-search" data-note-id="${result.id}">
      <div class="notebook-search-result__title">${esc(result.title || t('notebook.untitled'))}</div>
      <div class="notebook-search-result__path">${breadcrumb || esc(t('notebook.rootLabel'))}</div>
      ${result.excerpt ? `<div class="notebook-search-result__excerpt">${result.excerpt}</div>` : ''}
    </button>
  `;
}

function renderEmptyEditor() {
  if (!editorHostEl) return;

  editorHostEl.innerHTML = `
    <div class="notebook-empty-editor">
      <i data-lucide="book-open-text" aria-hidden="true"></i>
      <h2>${esc(t('notebook.emptyEditorTitle'))}</h2>
      <p>${esc(t('notebook.emptyEditorHint'))}</p>
      <button class="btn btn--primary notebook-new-root-btn">${esc(t('notebook.newRoot'))}</button>
    </div>
  `;

  if (window.lucide) window.lucide.createIcons();
}

function renderEditor() {
  if (!editorHostEl) return;
  const note = getNote(state.activeNoteId);

  if (!note) {
    renderEmptyEditor();
    return;
  }

  const breadcrumb = renderBreadcrumb(note);
  const noteChildren = getChildren(note.id);

  editorHostEl.innerHTML = `
    <section class="notebook-editor-card">
      <div class="notebook-editor__header">
        <div class="notebook-editor__title-wrap">
          <input
            type="text"
            class="notebook-title"
            value="${esc(note.title || '')}"
            placeholder="${esc(t('notebook.untitled'))}"
            autocomplete="off"
          />
          <div class="notebook-breadcrumbs">${breadcrumb}</div>
        </div>

        <div class="notebook-editor__actions">
          <button class="btn btn--sm btn--icon notebook-editor-action" data-action="new-child" title="${esc(t('notebook.newChild'))}">
            <i data-lucide="folder-plus" aria-hidden="true"></i>
          </button>
          <button class="btn btn--sm btn--icon notebook-editor-action" data-action="move-up" title="${esc(t('notebook.moveUp'))}">
            <i data-lucide="arrow-up" aria-hidden="true"></i>
          </button>
          <button class="btn btn--sm btn--icon notebook-editor-action" data-action="move-down" title="${esc(t('notebook.moveDown'))}">
            <i data-lucide="arrow-down" aria-hidden="true"></i>
          </button>
          <button class="btn btn--sm btn--icon notebook-editor-action" data-action="indent" title="${esc(t('notebook.indent'))}">
            <i data-lucide="arrow-right-to-line" aria-hidden="true"></i>
          </button>
          <button class="btn btn--sm btn--icon notebook-editor-action" data-action="outdent" title="${esc(t('notebook.outdent'))}">
            <i data-lucide="arrow-left-to-line" aria-hidden="true"></i>
          </button>
          <button class="btn btn--sm btn--icon notebook-editor-action" data-action="delete" title="${esc(t('notebook.deleteLabel'))}">
            <i data-lucide="trash-2" aria-hidden="true"></i>
          </button>
        </div>
      </div>

      <div class="notebook-editor__toolbar">
        <div class="notebook-editor__toolbar-group">
          <button class="btn btn--sm btn--icon notebook-format" data-format="bold" title="${esc(t('notebook.bold'))}">
            <i data-lucide="bold" aria-hidden="true"></i>
          </button>
          <button class="btn btn--sm btn--icon notebook-format" data-format="italic" title="${esc(t('notebook.italic'))}">
            <i data-lucide="italic" aria-hidden="true"></i>
          </button>
          <button class="btn btn--sm btn--icon notebook-format" data-format="heading" title="${esc(t('notebook.heading'))}">
            <strong>H</strong>
          </button>
          <button class="btn btn--sm btn--icon notebook-format" data-format="list" title="${esc(t('notebook.list'))}">
            <i data-lucide="list" aria-hidden="true"></i>
          </button>
          <button class="btn btn--sm btn--icon notebook-format" data-format="quote" title="${esc(t('notebook.quote'))}">
            <i data-lucide="quote" aria-hidden="true"></i>
          </button>
          <button class="btn btn--sm btn--icon notebook-format" data-format="link" title="${esc(t('notebook.link'))}">
            <i data-lucide="link" aria-hidden="true"></i>
          </button>
          <button class="btn btn--sm btn--icon notebook-format" data-format="code" title="${esc(t('notebook.code'))}">
            <i data-lucide="code-2" aria-hidden="true"></i>
          </button>
          <button class="btn btn--sm btn--icon notebook-format" data-format="divider" title="${esc(t('notebook.divider'))}">
            <i data-lucide="minus" aria-hidden="true"></i>
          </button>
        </div>

        <div class="notebook-editor__toolbar-group notebook-editor__layout-group">
          <button class="btn btn--sm btn--toggle notebook-layout-btn ${state.layout === 'editor' ? 'is-active' : ''}" data-layout="editor">${esc(t('notebook.layoutEditor'))}</button>
          <button class="btn btn--sm btn--toggle notebook-layout-btn ${state.layout === 'split' ? 'is-active' : ''}" data-layout="split">${esc(t('notebook.layoutSplit'))}</button>
          <button class="btn btn--sm btn--toggle notebook-layout-btn ${state.layout === 'preview' ? 'is-active' : ''}" data-layout="preview">${esc(t('notebook.layoutPreview'))}</button>
        </div>

        <span class="notebook-editor__status" aria-live="polite"></span>
      </div>

      <div class="notebook-editor__panes notebook-editor__panes--${esc(state.layout)}">
        <section class="notebook-pane notebook-pane--editor">
          <textarea
            class="notebook-content"
            spellcheck="true"
            placeholder="${esc(t('notebook.contentPlaceholder'))}"
          >${esc(note.content || '')}</textarea>
        </section>
        <section class="notebook-pane notebook-pane--preview">
          <div class="notebook-preview"></div>
        </section>
      </div>

      <div class="notebook-editor__footer">
        <span>${esc(t('notebook.childrenCount', { count: noteChildren.length }))}</span>
        <span>${esc(t('notebook.updatedAt', { value: formatDate(note.updated_at) }))}</span>
      </div>
    </section>
  `;

  editorTitleEl = editorHostEl.querySelector('.notebook-title');
  editorContentEl = editorHostEl.querySelector('.notebook-content');
  editorPreviewEl = editorHostEl.querySelector('.notebook-preview');
  editorStatusEl = editorHostEl.querySelector('.notebook-editor__status');

  renderPreviewFromDraft();
  renderEditorStatus();
  if (window.lucide) window.lucide.createIcons();

  if (state.pendingFocus === 'title' && editorTitleEl) {
    requestAnimationFrame(() => {
      editorTitleEl.focus();
      editorTitleEl.select();
    });
  } else if (state.pendingFocus === 'content' && editorContentEl) {
    requestAnimationFrame(() => editorContentEl.focus());
  }
  state.pendingFocus = null;
}

function formatDate(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function renderPreviewFromDraft() {
  if (!editorPreviewEl || !editorContentEl) return;
  if (state.layout === 'editor') {
    editorPreviewEl.innerHTML = '';
    return;
  }

  editorPreviewEl.innerHTML = marked.parse(editorContentEl.value || '');
}

function updateEditorStatus(text = '') {
  state.notice = text;
  renderEditorStatus();
}

async function loadNotes() {
  const res = await api.get('/notebook');
  syncIndexes(Array.isArray(res.data) ? res.data : []);
}

async function runSearch(query) {
  state.searchQuery = query;

  if (!query) {
    state.searchResults = [];
    renderSidebar();
    return;
  }

  const res = await api.get(`/notebook/search?q=${encodeURIComponent(query)}`);
  state.searchResults = Array.isArray(res.data) ? res.data : [];
  renderSidebar();
}

async function refreshNotebook({ selectId = null, focus = null } = {}) {
  const previousActive = state.activeNoteId;
  await loadNotes();

  if (selectId != null && state.noteMap.has(selectId)) {
    state.activeNoteId = selectId;
  } else if (state.activeNoteId == null || !state.noteMap.has(state.activeNoteId)) {
    state.activeNoteId = pickDefaultNoteId();
  }

  if (state.activeNoteId != null) {
    expandAncestors(state.activeNoteId);
  }

  state.pendingFocus = focus;
  renderSidebar();
  renderEditor();

  if (focus == null && previousActive !== state.activeNoteId) {
    state.pendingFocus = null;
  }

  if (state.searchQuery) {
    await runSearch(state.searchQuery);
  }
}

function ensureSidebarVisible(visible) {
  state.sidebarOpen = visible;
  rootEl?.classList.toggle('is-sidebar-open', visible);
}

function selectNote(noteId, { keepSidebar = false, focus = null } = {}) {
  if (!noteId || noteId === state.activeNoteId) {
    ensureSidebarVisible(keepSidebar ? state.sidebarOpen : false);
    return;
  }

  state.activeNoteId = noteId;
  state.dirty = false;
  state.savePromise = null;
  clearTimeout(state.saveTimer);
  state.saveTimer = null;

  expandAncestors(noteId);
  renderSidebar();
  renderEditor();
  ensureSidebarVisible(keepSidebar ? state.sidebarOpen : false);
  if (focus) state.pendingFocus = focus;
}

function updateNoteInState(updated) {
  const idx = state.notes.findIndex((note) => note.id === updated.id);
  if (idx >= 0) {
    state.notes[idx] = { ...state.notes[idx], ...updated };
  }
  state.noteMap.set(updated.id, { ...state.noteMap.get(updated.id), ...updated });

  const parentId = state.noteMap.get(updated.id)?.parent_id ?? null;
  syncIndexes(state.notes);
  if (parentId != null) state.collapsed.delete(parentId);
}

async function saveCurrentNote() {
  if (!state.activeNoteId || state.saving) {
    return state.savePromise || Promise.resolve();
  }

  const note = getNote(state.activeNoteId);
  if (!note || !editorTitleEl || !editorContentEl) {
    return Promise.resolve();
  }

  const title = (editorTitleEl.value || '').trim() || t('notebook.untitled');
  const content = editorContentEl.value || '';

  if (title === note.title && content === note.content) {
    state.dirty = false;
    updateEditorStatus('');
    return Promise.resolve();
  }

  state.saving = true;
  state.savePromise = (async () => {
    updateEditorStatus(t('notebook.saving'));
    try {
      const res = await api.put(`/notebook/${note.id}`, { title, content });
      updateNoteInState(res.data);
      state.dirty = false;
      updateEditorStatus(t('notebook.saved'));
      if (state.searchQuery) {
        await runSearch(state.searchQuery);
      } else {
        renderSidebar();
      }

      window.setTimeout(() => {
        if (!state.dirty && !state.saving) updateEditorStatus('');
      }, 1600);
    } catch (err) {
      console.error('Failed to save notebook note:', err);
      state.dirty = true;
      updateEditorStatus(t('notebook.failed'));
      throw err;
    } finally {
      state.saving = false;
      state.savePromise = null;
    }
  })();

  return state.savePromise;
}

function scheduleSave() {
  state.dirty = true;
  updateEditorStatus(t('notebook.unsaved'));
  clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(() => {
    saveCurrentNote().catch(() => {});
  }, 850);
}

async function createNote(parentId = null) {
  await saveCurrentNote().catch(() => {});
  const payload = {
    title: t('notebook.untitled'),
    content: '',
    parent_id: parentId,
  };

  const res = await api.post('/notebook', payload);
  state.searchQuery = '';
  state.searchResults = [];
  if (searchInputEl) searchInputEl.value = '';
  state.pendingFocus = 'title';
  await refreshNotebook({ selectId: res.data.id, focus: 'title' });
}

async function deleteNote(noteId) {
  const note = getNote(noteId);
  if (!note) return;

  const confirmed = await showConfirm(t('notebook.deleteConfirm'), { danger: true });
  if (!confirmed) return;

  await api.delete(`/notebook/${noteId}`);
  const fallback = note.parent_id ?? getChildren(null).find((item) => item.id !== noteId)?.id ?? null;
  if (state.activeNoteId === noteId) {
    state.activeNoteId = null;
  }
  await refreshNotebook({ selectId: fallback });
}

async function moveCurrentNote(kind) {
  const note = getNote(state.activeNoteId);
  if (!note) return;

  const siblings = getChildren(note.parent_id);
  const index = siblings.findIndex((sibling) => sibling.id === note.id);

  if (kind === 'move-up') {
    if (index <= 0) return;
    const target = siblings[index - 1];
    await api.put(`/notebook/${note.id}`, { sort_order: Math.max(0, (target.sort_order ?? 0) - 1) });
  } else if (kind === 'move-down') {
    if (index < 0 || index >= siblings.length - 1) return;
    const target = siblings[index + 1];
    await api.put(`/notebook/${note.id}`, { sort_order: (target.sort_order ?? 0) + 1 });
  } else if (kind === 'indent') {
    if (index <= 0) return;
    const newParent = siblings[index - 1];
    await api.put(`/notebook/${note.id}`, {
      parent_id: newParent.id,
      sort_order: getChildren(newParent.id).length,
    });
  } else if (kind === 'outdent') {
    if (note.parent_id == null) return;
    const parent = getNote(note.parent_id);
    const grandParentId = parent?.parent_id ?? null;
    await api.put(`/notebook/${note.id}`, {
      parent_id: grandParentId,
      sort_order: getChildren(grandParentId).length,
    });
  }

  await refreshNotebook({ selectId: note.id });
}

function applyFormatting(kind) {
  if (!editorContentEl) return;

  const textarea = editorContentEl;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  const selected = text.slice(start, end);

  const apply = (value, cursorStart, cursorEnd) => {
    textarea.value = value;
    textarea.selectionStart = cursorStart;
    textarea.selectionEnd = cursorEnd;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
  };

  if (kind === 'bold') {
    const insert = selected || t('notebook.sampleText');
    apply(`${text.slice(0, start)}**${insert}**${text.slice(end)}`, start + 2, start + 2 + insert.length);
    return;
  }

  if (kind === 'italic') {
    const insert = selected || t('notebook.sampleText');
    apply(`${text.slice(0, start)}*${insert}*${text.slice(end)}`, start + 1, start + 1 + insert.length);
    return;
  }

  if (kind === 'code') {
    const insert = selected || 'code';
    apply(`${text.slice(0, start)}\`${insert}\`${text.slice(end)}`, start + 1, start + 1 + insert.length);
    return;
  }

  if (kind === 'link') {
    const insert = selected || t('notebook.linkText');
    apply(`${text.slice(0, start)}[${insert}](https://)${text.slice(end)}`, start + 1, start + 1 + insert.length);
    return;
  }

  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = text.indexOf('\n', end) === -1 ? text.length : text.indexOf('\n', end);
  const before = text.slice(0, lineStart);
  const line = text.slice(lineStart, lineEnd);
  const after = text.slice(lineEnd);

  if (kind === 'heading') {
    const prefix = line.startsWith('# ') ? '## ' : '# ';
    apply(`${before}${prefix}${line.replace(/^#+\s*/, '')}${after}`, lineStart + prefix.length, lineStart + prefix.length + line.replace(/^#+\s*/, '').length);
    return;
  }

  if (kind === 'list') {
    const lines = (selected || line).split('\n').map((value) => (value.startsWith('- ') ? value : `- ${value}`));
    const replacement = lines.join('\n');
    const value = selected
      ? `${text.slice(0, start)}${replacement}${text.slice(end)}`
      : `${before}${replacement}${after}`;
    const cursorStart = selected ? start + 2 : lineStart + 2;
    apply(value, cursorStart, cursorStart + replacement.length - 2);
    return;
  }

  if (kind === 'quote') {
    const lines = (selected || line).split('\n').map((value) => (value.startsWith('> ') ? value : `> ${value}`));
    const replacement = lines.join('\n');
    const value = selected
      ? `${text.slice(0, start)}${replacement}${text.slice(end)}`
      : `${before}${replacement}${after}`;
    const cursorStart = selected ? start + 2 : lineStart + 2;
    apply(value, cursorStart, cursorStart + replacement.length - 2);
    return;
  }

  if (kind === 'divider') {
    apply(`${text.slice(0, start)}\n---\n${text.slice(end)}`, start + 5, start + 5);
  }
}

function renderShell(container) {
  container.innerHTML = `
    <div class="notebook-page">
      <div class="notebook-page__overlay"></div>
      <header class="notebook-topbar">
        <div class="notebook-topbar__brand">
          <button class="btn btn--sm btn--icon notebook-sidebar-toggle" aria-label="${esc(t('notebook.toggleSidebar'))}">
            <i data-lucide="panel-left" aria-hidden="true"></i>
          </button>
          <div>
            <h1>${esc(t('notebook.title'))}</h1>
            <p>${esc(t('notebook.subtitle'))}</p>
          </div>
        </div>
        <div class="notebook-topbar__actions">
          <button class="btn btn--sm btn--secondary notebook-new-child" title="${esc(t('notebook.newChild'))}">
            <i data-lucide="folder-plus" aria-hidden="true"></i>
            <span>${esc(t('notebook.newChild'))}</span>
          </button>
          <button class="btn btn--sm btn--primary notebook-new-root" title="${esc(t('notebook.newRoot'))}">
            <i data-lucide="plus" aria-hidden="true"></i>
            <span>${esc(t('notebook.newRoot'))}</span>
          </button>
        </div>
      </header>

      <div class="notebook-shell">
        <aside class="notebook-sidebar">
          <div class="notebook-sidebar__header">
            <div class="notebook-sidebar__search">
              <i data-lucide="search" aria-hidden="true"></i>
              <input type="search" class="notebook-search" placeholder="${esc(t('notebook.searchPlaceholder'))}" autocomplete="off" />
              <button class="notebook-search-clear" aria-label="${esc(t('clear'))}">
                <i data-lucide="x" aria-hidden="true"></i>
              </button>
            </div>
          </div>
          <div class="notebook-sidebar__body"></div>
        </aside>
        <main class="notebook-main">
          <div class="notebook-editor-host"></div>
        </main>
      </div>
    </div>
  `;
}

function wireEvents(container) {
  container.addEventListener('click', async (event) => {
    const sidebarToggle = event.target.closest('.notebook-sidebar-toggle');
    if (sidebarToggle) {
      ensureSidebarVisible(!state.sidebarOpen);
      return;
    }

    const overlay = event.target.closest('.notebook-page__overlay');
    if (overlay) {
      ensureSidebarVisible(false);
      return;
    }

    const newRoot = event.target.closest('.notebook-new-root');
    if (newRoot || event.target.closest('.notebook-new-root-btn')) {
      await createNote(null);
      ensureSidebarVisible(false);
      return;
    }

    const newChild = event.target.closest('.notebook-new-child');
    if (newChild) {
      await createNote(state.activeNoteId ?? null);
      ensureSidebarVisible(false);
      return;
    }

    const searchClear = event.target.closest('.notebook-search-clear');
    if (searchClear) {
      state.searchQuery = '';
      state.searchResults = [];
      if (searchInputEl) searchInputEl.value = '';
      renderSidebar();
      return;
    }

    const rowAction = event.target.closest('[data-action]');
    if (rowAction?.closest('.notebook-tree__row')) {
      const action = rowAction.dataset.action;
      const noteId = parseInt(rowAction.dataset.noteId, 10);
      if (action === 'toggle') {
        if (state.collapsed.has(noteId)) state.collapsed.delete(noteId);
        else state.collapsed.add(noteId);
        saveCollapsed();
        renderSidebar();
        return;
      }

      if (action === 'select') {
        await saveCurrentNote().catch(() => {});
        selectNote(noteId, { keepSidebar: false });
        return;
      }

      if (action === 'new-child') {
        await createNote(noteId);
        ensureSidebarVisible(false);
        return;
      }

      if (action === 'delete') {
        await deleteNote(noteId);
        ensureSidebarVisible(false);
        return;
      }
    }

    const searchResult = event.target.closest('.notebook-search-result');
    if (searchResult) {
      const noteId = parseInt(searchResult.dataset.noteId, 10);
      await saveCurrentNote().catch(() => {});
      selectNote(noteId, { keepSidebar: false });
      return;
    }

    const editorAction = event.target.closest('.notebook-editor-action');
    if (editorAction) {
      const action = editorAction.dataset.action;
      if (action === 'new-child') {
        await createNote(state.activeNoteId ?? null);
        return;
      }
      if (action === 'delete') {
        await deleteNote(state.activeNoteId);
        return;
      }
      await saveCurrentNote().catch(() => {});
      await moveCurrentNote(action);
      return;
    }

    const layoutBtn = event.target.closest('.notebook-layout-btn');
    if (layoutBtn) {
      state.layout = layoutBtn.dataset.layout;
      saveLayout();
      renderEditor();
      return;
    }

    const formatBtn = event.target.closest('.notebook-format');
    if (formatBtn) {
      applyFormatting(formatBtn.dataset.format);
      return;
    }
  });

  container.addEventListener('input', (event) => {
    if (event.target === searchInputEl) {
      clearTimeout(state.searchTimer);
      const query = event.target.value.trim();
      state.searchTimer = window.setTimeout(() => {
        runSearch(query).catch((err) => {
          console.error('Notebook search failed:', err);
        });
      }, 220);
      return;
    }

    if (event.target === editorTitleEl || event.target === editorContentEl) {
      state.dirty = true;
      renderEditorStatus();
      renderPreviewFromDraft();
      clearTimeout(state.saveTimer);
      state.saveTimer = window.setTimeout(() => {
        saveCurrentNote().catch((err) => {
          console.error('Notebook save failed:', err);
        });
      }, 800);
    }
  });

  container.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.sidebarOpen) {
      ensureSidebarVisible(false);
      return;
    }

    if ((event.ctrlKey || event.metaKey) && editorContentEl && event.target === editorContentEl) {
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveCurrentNote().catch(() => {});
      }
    }
  });

  container.addEventListener('focusout', (event) => {
    if ((event.target === editorTitleEl || event.target === editorContentEl) && state.dirty) {
      saveCurrentNote().catch(() => {});
    }
  });
}

export async function render(container) {
  rootEl = container;
  renderShell(container);
  container.classList.add('notebook-page');

  sidebarBodyEl = container.querySelector('.notebook-sidebar__body');
  searchInputEl = container.querySelector('.notebook-search');
  editorHostEl = container.querySelector('.notebook-editor-host');

  wireEvents(container);

  try {
    await loadNotes();
  } catch (err) {
    console.error('Failed to load notebook notes:', err);
    syncIndexes([]);
  }

  if (searchInputEl) searchInputEl.value = state.searchQuery;
  renderSidebar();
  renderEditor();

  const note = getNote(state.activeNoteId);
  ensureSidebarVisible(false);
  if (!note && state.notes.length === 0) {
    renderEmptyEditor();
  }

  if (window.lucide) window.lucide.createIcons();
}
