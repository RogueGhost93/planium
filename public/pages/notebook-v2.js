/**
 * Module: Notebook
 * Purpose: Hierarchical markdown notes with a Joplin-style tree/editor layout.
 */

import { api, auth } from '/api.js';
import { openModal, closeModal, showConfirm } from '/components/modal.js';
import { t } from '/i18n.js';
import { esc } from '/utils/html.js';
import { marked } from '/vendor/marked.esm.js';

marked.setOptions({ breaks: true, gfm: true });

const IMPORT_ACCEPT = '.md,.markdown,.html,.htm';

const STORAGE_KEYS = {
  collapsed: 'planium-notebook-collapsed-v2',
  layout: 'planium-notebook-layout-v2',
};

const PHONE_LAYOUT_QUERY = '(max-width: 719px)';

const state = {
  notes: [],
  noteMap: new Map(),
  childrenMap: new Map(),
  activeNoteId: null,
  folder: loadFolder(),
  lockedUnlocked: loadLockedUnlocked(),
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
  dragNoteId: null,
  dragOverNoteId: null,
  dragOverRoot: false,
};

let rootEl = null;
let sidebarBodyEl = null;
let searchInputEl = null;
let editorHostEl = null;
let editorTitleEl = null;
let editorContentEl = null;
let editorPreviewEl = null;
let editorStatusEl = null;
let layoutMediaQuery = null;

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

function loadFolder() {
  const saved = localStorage.getItem('planium-notebook-folder-v1');
  if (saved === 'notes' || saved === 'trash' || saved === 'locked') return saved;
  return 'notes';
}

function loadLockedUnlocked() {
  return sessionStorage.getItem('planium-notebook-locked-unlocked-v1') === '1';
}

function isPhoneLayout() {
  return window.matchMedia(PHONE_LAYOUT_QUERY).matches;
}

function getEffectiveLayout() {
  if (!isPhoneLayout()) return state.layout;
  return state.layout === 'preview' ? 'preview' : 'editor';
}

function saveLayout() {
  try {
    localStorage.setItem(STORAGE_KEYS.layout, state.layout);
  } catch {
    // ignore
  }
}

function saveFolder() {
  try {
    localStorage.setItem('planium-notebook-folder-v1', state.folder);
  } catch {
    // ignore
  }
}

function saveLockedUnlocked() {
  try {
    sessionStorage.setItem('planium-notebook-locked-unlocked-v1', state.lockedUnlocked ? '1' : '0');
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

function renderLayoutButtons() {
  const effectiveLayout = getEffectiveLayout();
  const isPhone = isPhoneLayout();
  const buttons = [
    `<button class="btn btn--sm btn--toggle notebook-layout-btn ${effectiveLayout === 'editor' ? 'is-active' : ''}" data-layout="editor">${esc(t('notebook.layoutEditor'))}</button>`,
    ...(!isPhone ? [
      `<button class="btn btn--sm btn--toggle notebook-layout-btn ${effectiveLayout === 'split' ? 'is-active' : ''}" data-layout="split">${esc(t('notebook.layoutSplit'))}</button>`,
    ] : []),
    `<button class="btn btn--sm btn--toggle notebook-layout-btn ${effectiveLayout === 'preview' ? 'is-active' : ''}" data-layout="preview">${esc(t('notebook.layoutPreview'))}</button>`,
  ];

  return buttons.join('');
}

function renderSidebar() {
  if (!sidebarBodyEl) return;
  sidebarBodyEl.classList.toggle('is-drop-root', Boolean(state.dragOverRoot));

  const roots = getChildren(null);
  const treeHtml = state.folder === 'locked' && !state.lockedUnlocked
    ? `
      <div class="notebook-empty-sidebar">
        <i data-lucide="lock" aria-hidden="true"></i>
        <h2>${esc(t('notebook.lockedTitle'))}</h2>
        <p>${esc(t('notebook.lockedHint'))}</p>
        <button class="btn btn--primary notebook-unlock-folder">${esc(t('notebook.unlockFolderLabel'))}</button>
      </div>
    `
    : state.searchQuery
    ? renderSearchResults()
    : roots.length
      ? `<div class="notebook-tree" role="tree" aria-label="${esc(t('notebook.title'))}">
          <ul class="notebook-tree__list">${renderTreeNodes(roots, 0)}</ul>
      </div>`
    : `
      <div class="notebook-empty-sidebar">
        <i data-lucide="${state.folder === 'trash' ? 'trash-2' : state.folder === 'locked' ? 'lock' : 'book-open'}" aria-hidden="true"></i>
        <h2>${esc(state.folder === 'trash' ? t('notebook.trashEmpty') : state.folder === 'locked' ? t('notebook.lockedEmpty') : t('notebook.empty'))}</h2>
        <p>${esc(state.folder === 'trash' ? t('notebook.trashEmptyHint') : state.folder === 'locked' ? t('notebook.lockedEmptyHint') : t('notebook.emptyHint'))}</p>
        ${state.folder === 'notes' ? `<button class="btn btn--primary notebook-new-root-btn">${esc(t('notebook.newRoot'))}</button>` : ''}
      </div>
    `;
  sidebarBodyEl.innerHTML = `
    <div class="notebook-folders" role="navigation" aria-label="${esc(t('notebook.title'))}">
      <button class="notebook-folder ${state.folder === 'notes' ? 'is-active' : ''}" data-folder="notes">
        <i data-lucide="book-open" aria-hidden="true"></i>
        <span>${esc(t('notebook.notesFolder'))}</span>
      </button>
      <button class="notebook-folder ${state.folder === 'trash' ? 'is-active' : ''}" data-folder="trash">
        <i data-lucide="trash-2" aria-hidden="true"></i>
        <span>${esc(t('notebook.trashLabel'))}</span>
      </button>
      <button class="notebook-folder ${state.folder === 'locked' ? 'is-active' : ''}" data-folder="locked">
        <i data-lucide="lock" aria-hidden="true"></i>
        <span>${esc(t('notebook.lockedLabel'))}</span>
      </button>
    </div>
    ${treeHtml}
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
    const isDropTarget = state.dragOverNoteId === node.id ? ' is-drop-target' : '';

    return `
      <li class="notebook-tree__node" style="--depth:${depth}">
        <div class="notebook-tree__row ${active}${isDropTarget}" draggable="${state.folder === 'trash' ? 'false' : 'true'}" data-drag-note-id="${node.id}">
          <button class="notebook-tree__toggle" data-action="toggle" data-note-id="${node.id}" ${hasChildren ? '' : 'disabled'}>
            <i data-lucide="${hasChildren ? toggleIcon : 'dot'}" aria-hidden="true"></i>
          </button>
          <button class="notebook-tree__item" data-action="select" data-note-id="${node.id}" title="${esc(node.title || t('notebook.untitled'))}">
            <span class="notebook-tree__title">${esc(node.title || t('notebook.untitled'))}</span>
            ${childCount}
          </button>
          ${state.folder === 'trash' ? `
            <button class="notebook-tree__child" data-action="restore" data-note-id="${node.id}" aria-label="${esc(t('notebook.restoreLabel'))}">
              <i data-lucide="rotate-ccw" aria-hidden="true"></i>
            </button>
            <button class="notebook-tree__delete" data-action="delete-permanent" data-note-id="${node.id}" aria-label="${esc(t('notebook.deleteForeverLabel'))}">
              <i data-lucide="trash-2" aria-hidden="true"></i>
            </button>
          ` : state.folder === 'locked' ? `
            <button class="notebook-tree__delete" data-action="delete-permanent" data-note-id="${node.id}" aria-label="${esc(t('notebook.deleteForeverLabel'))}">
              <i data-lucide="trash-2" aria-hidden="true"></i>
            </button>
          ` : `
            <button class="notebook-tree__child" data-action="new-child" data-note-id="${node.id}" aria-label="${esc(t('notebook.newChild'))}">
              <i data-lucide="plus" aria-hidden="true"></i>
            </button>
            <button class="notebook-tree__delete" data-action="trash" data-note-id="${node.id}" aria-label="${esc(t('notebook.trashLabel'))}">
              <i data-lucide="trash-2" aria-hidden="true"></i>
            </button>
            <button class="notebook-tree__child" data-action="lock" data-note-id="${node.id}" aria-label="${esc(t('notebook.lockLabel'))}">
              <i data-lucide="lock" aria-hidden="true"></i>
            </button>
          `}
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
    return `
      <div class="notebook-empty-sidebar">
        <i data-lucide="search-x" aria-hidden="true"></i>
        <h2>${esc(t('notebook.noResultsTitle'))}</h2>
        <p>${esc(t('notebook.noResultsHint', { query }))}</p>
      </div>
    `;
  }

  return `
    <div class="notebook-search-results">
      <div class="notebook-search-results__meta">
        ${esc(t('notebook.searchSummary', { count: results.length }))}
      </div>
      <div class="notebook-search-results__list">
        ${results.map(renderSearchResult).join('')}
      </div>
    </div>
  `;
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
      ${state.folder === 'notes' ? `<button class="btn btn--primary notebook-new-root-btn">${esc(t('notebook.newRoot'))}</button>` : ''}
    </div>
  `;

  if (window.lucide) window.lucide.createIcons();
}

function renderEditor() {
  if (!editorHostEl) return;
  rootEl?.classList.toggle('is-folder-trash', state.folder === 'trash');
  rootEl?.classList.toggle('is-folder-locked', state.folder === 'locked');
  const note = getNote(state.activeNoteId);

  if (!note) {
    if (state.folder === 'locked' && !state.lockedUnlocked) {
      editorHostEl.innerHTML = `
        <section class="notebook-editor-card notebook-editor-card--locked">
          <div class="notebook-empty-editor">
            <i data-lucide="lock" aria-hidden="true"></i>
            <h2>${esc(t('notebook.lockedTitle'))}</h2>
            <p>${esc(t('notebook.lockedHint'))}</p>
            <button class="btn btn--primary notebook-unlock-folder">${esc(t('notebook.unlockFolderLabel'))}</button>
          </div>
        </section>
      `;
      editorPreviewEl = null;
      editorTitleEl = null;
      editorContentEl = null;
      editorStatusEl = null;
      if (window.lucide) window.lucide.createIcons();
      return;
    }
    renderEmptyEditor();
    return;
  }

  if (note.trashed_at != null) {
    const breadcrumb = renderBreadcrumb(note);
    editorHostEl.innerHTML = `
      <section class="notebook-editor-card notebook-editor-card--trash">
        <div class="notebook-editor__header">
          <div class="notebook-editor__title-wrap">
            <div class="notebook-title notebook-title--static">${esc(note.title || t('notebook.untitled'))}</div>
            <div class="notebook-breadcrumbs">${breadcrumb}</div>
          </div>

          <div class="notebook-editor__actions">
            <button class="btn btn--sm btn--secondary notebook-editor-action" data-action="restore" title="${esc(t('notebook.restoreLabel'))}">
              <i data-lucide="rotate-ccw" aria-hidden="true"></i>
              <span>${esc(t('notebook.restoreLabel'))}</span>
            </button>
            <button class="btn btn--sm btn--danger notebook-editor-action" data-action="delete-permanent" title="${esc(t('notebook.deleteForeverLabel'))}">
              <i data-lucide="trash-2" aria-hidden="true"></i>
              <span>${esc(t('notebook.deleteForeverLabel'))}</span>
            </button>
          </div>
        </div>

        <div class="notebook-trash-note">
          <div class="notebook-trash-note__mode">${esc(t('notebook.trashModeHint'))}</div>
          <div class="notebook-trash-note__meta">${esc(t('notebook.trashedAt', { value: formatDate(note.trashed_at) }))}</div>
          <div class="notebook-trash-note__content">${marked.parse(note.content || '')}</div>
        </div>
      </section>
    `;

    editorPreviewEl = null;
    editorTitleEl = null;
    editorContentEl = null;
    editorStatusEl = null;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  if (state.folder === 'locked' && note.locked_at && !state.lockedUnlocked) {
    editorHostEl.innerHTML = `
      <section class="notebook-editor-card notebook-editor-card--locked">
        <div class="notebook-empty-editor">
          <i data-lucide="lock" aria-hidden="true"></i>
          <h2>${esc(t('notebook.lockedTitle'))}</h2>
          <p>${esc(t('notebook.lockedHint'))}</p>
          <button class="btn btn--primary notebook-unlock-folder">${esc(t('notebook.unlockFolderLabel'))}</button>
        </div>
      </section>
    `;
    editorPreviewEl = null;
    editorTitleEl = null;
    editorContentEl = null;
    editorStatusEl = null;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  const breadcrumb = renderBreadcrumb(note);
  const noteChildren = getChildren(note.id);
  const effectiveLayout = getEffectiveLayout();

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
          <button class="btn btn--sm btn--icon notebook-editor-action" data-action="trash" title="${esc(t('notebook.trashLabel'))}">
            <i data-lucide="trash-2" aria-hidden="true"></i>
          </button>
          <button class="btn btn--sm btn--icon notebook-editor-action" data-action="lock" title="${esc(t('notebook.lockLabel'))}">
            <i data-lucide="lock" aria-hidden="true"></i>
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
          ${renderLayoutButtons()}
        </div>

        <span class="notebook-editor__status" aria-live="polite"></span>
      </div>

      <div class="notebook-editor__panes notebook-editor__panes--${esc(effectiveLayout)}">
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

function fileStem(name) {
  const base = String(name || '').split('/').pop() || '';
  return base.replace(/\.[^.]+$/, '') || base;
}

function normalizeTimestamp(value) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  const parsed = new Date(text.includes(' ') && !text.includes('T') ? text.replace(' ', 'T') : text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function parseFrontMatter(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { meta: {}, body: normalized };
  }

  const header = [];
  let index = 1;
  for (; index < lines.length; index++) {
    const line = lines[index];
    if (line.trim() === '---') {
      index++;
      break;
    }
    header.push(line);
  }

  const meta = {};
  for (const line of header) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (/^(true|false)$/i.test(value)) value = value.toLowerCase() === 'true';
    else if (/^-?\d+(?:\.\d+)?$/.test(value)) value = Number(value);
    meta[match[1]] = value;
  }

  const body = lines.slice(index).join('\n').replace(/^\n+/, '');
  return { meta, body };
}

function collapseSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function escapeHtmlToMarkdown(text) {
  return String(text || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function inlineMarkdownForNode(node) {
  if (!node) return '';
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeHtmlToMarkdown(node.textContent || '');
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const tag = node.tagName.toLowerCase();
  if (tag === 'br') return '  \n';
  if (tag === 'code') return `\`${collapseSpaces(node.textContent || '')}\``;
  if (tag === 'strong' || tag === 'b') return `**${childrenMarkdown(node).trim()}**`;
  if (tag === 'em' || tag === 'i') return `*${childrenMarkdown(node).trim()}*`;
  if (tag === 'a') {
    const href = node.getAttribute('href') || '';
    const label = childrenMarkdown(node).trim() || href;
    return href ? `[${label}](${href})` : label;
  }
  if (tag === 'img') {
    const alt = node.getAttribute('alt') || '';
    const src = node.getAttribute('src') || '';
    return src ? `![${alt}](${src})` : alt;
  }
  return childrenMarkdown(node);
}

function listItemMarkdown(node) {
  const parentTag = node.parentElement?.tagName?.toLowerCase();
  const ordered = parentTag === 'ol';
  const index = ordered
    ? [...node.parentElement.children].filter((child) => child.tagName?.toLowerCase() === 'li').indexOf(node) + 1
    : 0;
  const prefix = ordered ? `${index}. ` : '- ';
  const inline = childrenMarkdown(node).replace(/\n+/g, ' ').trim();
  return `${prefix}${inline}`;
}

function blockMarkdownForNode(node) {
  if (!node) return '';
  if (node.nodeType === Node.TEXT_NODE) {
    const text = escapeHtmlToMarkdown(node.textContent || '');
    return text.trim() ? text : '';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const tag = node.tagName.toLowerCase();
  if (['script', 'style', 'meta', 'link'].includes(tag)) return '';
  if (tag === 'br') return '\n';
  if (tag === 'pre') {
    const code = node.querySelector('code')?.textContent ?? node.textContent ?? '';
    return `\n\n\`\`\`\n${code.replace(/\n+$/, '')}\n\`\`\`\n\n`;
  }
  if (tag === 'blockquote') {
    const text = blockChildrenMarkdown(node).trim();
    if (!text) return '';
    return `\n\n${text.split('\n').map((line) => `> ${line}`.trimEnd()).join('\n')}\n\n`;
  }
  if (tag === 'ul' || tag === 'ol') {
    const items = [...node.children]
      .filter((child) => child.tagName?.toLowerCase() === 'li')
      .map((child) => listItemMarkdown(child))
      .filter(Boolean);
    return items.length ? `\n\n${items.join('\n')}\n\n` : '';
  }
  if (tag === 'table') {
    const text = collapseSpaces(node.textContent || '');
    return text ? `\n\n${text}\n\n` : '';
  }
  if (tag === 'hr') return '\n\n---\n\n';
  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1));
    const text = collapseSpaces(childrenMarkdown(node));
    return text ? `\n\n${'#'.repeat(level)} ${text}\n\n` : '';
  }
  if (tag === 'li') return listItemMarkdown(node);
  if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article') {
    const text = childrenMarkdown(node).trim();
    return text ? `\n\n${text}\n\n` : '';
  }
  if (tag === 'td' || tag === 'th') {
    return collapseSpaces(childrenMarkdown(node));
  }
  if (tag === 'tr') {
    const cells = [...node.children].map((child) => blockMarkdownForNode(child)).filter(Boolean);
    return cells.length ? cells.join(' | ') : '';
  }
  return childrenMarkdown(node);
}

function childrenMarkdown(node) {
  return [...node.childNodes].map((child) => inlineMarkdownForNode(child)).join('');
}

function blockChildrenMarkdown(node) {
  return [...node.childNodes]
    .map((child) => blockMarkdownForNode(child))
    .join('')
    .replace(/\n{3,}/g, '\n\n');
}

function normalizeMarkdownOutput(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseJoplinHtml(text, fallbackName) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/html');
  const exported = doc.querySelector('.exported-note') || doc.body || doc.documentElement;
  const title = collapseSpaces(
    exported.querySelector('.exported-note-title')?.textContent
      || doc.querySelector('title')?.textContent
      || fallbackName,
  ) || fallbackName;

  const body = exported.cloneNode(true);
  body.querySelectorAll('.exported-note-title, style, script, meta, link').forEach((node) => node.remove());
  const content = normalizeMarkdownOutput(blockChildrenMarkdown(body));

  return { title, content };
}

function isNotebookImportFile(file) {
  const name = String(file?.name || '').toLowerCase();
  return name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.html') || name.endsWith('.htm');
}

function inferNotebookImportKind(files) {
  let md = 0;
  let html = 0;
  for (const file of files) {
    const name = String(file?.name || '').toLowerCase();
    if (name.endsWith('.md') || name.endsWith('.markdown')) md++;
    else if (name.endsWith('.html') || name.endsWith('.htm')) html++;
  }
  if (md === 0 && html === 0) return null;
  return md >= html ? 'markdown' : 'html';
}

function getRelativeSegments(file) {
  const raw = String(file?.webkitRelativePath || file?.name || '');
  return raw.split('/').filter(Boolean);
}

function createNotebookImportNode(title) {
  return {
    title: title || t('notebook.untitled'),
    content: '',
    created_at: null,
    updated_at: null,
    children: [],
  };
}

function stripCommonRoot(paths) {
  if (!paths.length) return { prefix: [], paths };

  const prefix = paths[0];
  let keep = prefix.length;

  for (const path of paths.slice(1)) {
    const max = Math.min(keep, path.length);
    let i = 0;
    while (i < max && path[i] === prefix[i]) i++;
    keep = i;
    if (!keep) break;
  }

  if (!keep) return { prefix: [], paths };
  return {
    prefix: prefix.slice(0, keep),
    paths: paths.map((path) => path.slice(keep)),
  };
}

function sanitizeFileSegment(value, fallback = 'untitled') {
  const text = collapseSpaces(value) || fallback;
  return text
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\.+$/g, '')
    .replace(/\s+/g, ' ')
    .trim() || fallback;
}

function ensureUniqueNames(nodes) {
  const seen = new Map();
  return nodes.map((node) => {
    const base = sanitizeFileSegment(node.title, t('notebook.untitled'));
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    const name = count === 0 ? base : `${base} (${count + 1})`;
    return { ...node, exportName: name, children: ensureUniqueNames(node.children || []) };
  });
}

function normalizeExportTree() {
  const roots = getChildren(null).map((node) => ({
    id: node.id,
    title: node.title,
    content: node.content || '',
    created_at: node.created_at,
    updated_at: node.updated_at,
    children: getChildren(node.id).map(function walk(child) {
      return {
        id: child.id,
        title: child.title,
        content: child.content || '',
        created_at: child.created_at,
        updated_at: child.updated_at,
        children: getChildren(child.id).map(walk),
      };
    }),
  }));
  return ensureUniqueNames(roots);
}

function frontMatterFor(node) {
  const lines = [
    '---',
    `title: ${node.title || t('notebook.untitled')}`,
    `updated: ${normalizeTimestamp(node.updated_at) || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}`,
    `created: ${normalizeTimestamp(node.created_at) || normalizeTimestamp(node.updated_at) || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}`,
    '---',
    '',
  ];
  return lines.join('\n');
}

function htmlExportFor(node) {
  const rendered = marked.parse(node.content || '');
  const title = node.title || t('notebook.untitled');
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <style>
      body { font-family: Arial, sans-serif; line-height: 1.6; color: #32373F; margin: 0; padding: 1rem; background: #fff; }
      .exported-note { padding: 1rem; }
      .exported-note-title { font-size: 2rem; font-weight: 700; margin-bottom: 0.8rem; padding-bottom: 0.35rem; border-bottom: 1px solid #ddd; }
      img { max-width: 100%; height: auto; }
      pre { overflow: auto; }
      blockquote { border-left: 4px solid #ddd; padding-left: 1rem; margin-left: 0; opacity: 0.8; }
      a { color: #155BDA; }
    </style>
  </head>
  <body>
    <div class="exported-note">
      <div class="exported-note-title">${esc(title)}</div>
      <div id="rendered-md">${rendered}</div>
    </div>
  </body>
</html>`;
}

async function pickExportDirectory() {
  if (!window.showDirectoryPicker) {
    throw new Error('This browser does not support folder export.');
  }
  return window.showDirectoryPicker({ mode: 'readwrite' });
}

async function writeExportNode(dirHandle, node, kind) {
  const folder = await dirHandle.getDirectoryHandle(node.exportName, { create: true });
  const fileName = kind === 'markdown' ? `${node.exportName}.md` : `${node.exportName}.html`;
  const content = kind === 'markdown'
    ? `${frontMatterFor(node)}${normalizeMarkdownOutput(node.content || '')}\n`
    : htmlExportFor(node);
  const fileHandle = await folder.getFileHandle(fileName, { create: true });
  const writer = await fileHandle.createWritable();
  await writer.write(content);
  await writer.close();

  for (const child of node.children || []) {
    await writeExportNode(folder, child, kind);
  }
}

async function exportNotebookDirectory(kind) {
  await saveCurrentNote().catch(() => {});
  await refreshNotebook({ selectId: state.activeNoteId, focus: null });
  const tree = normalizeExportTree();
  if (!tree.length) {
    window.planium.showToast(t('notebook.exportNothing'), 'danger');
    return;
  }

  const baseName = kind === 'markdown' ? 'Planium Notebook Markdown' : 'Planium Notebook HTML';
  const root = await pickExportDirectory();
  const exportRoot = await root.getDirectoryHandle(baseName, { create: true });
  for (const node of tree) {
    await writeExportNode(exportRoot, node, kind);
  }
  window.planium.showToast(
    kind === 'markdown' ? t('notebook.exportMarkdownDone') : t('notebook.exportHtmlDone'),
    'success',
  );
}

async function parseNotebookImportFiles(files, kind) {
  const entries = [];
  for (const file of files) {
    if (!isNotebookImportFile(file)) continue;
    const segments = getRelativeSegments(file);
    if (!segments.length) continue;
    if (segments.some((segment) => ['_resources', 'pluginAssets'].includes(segment))) continue;
    entries.push({ file, segments });
  }

  if (!entries.length) return [];

  entries.sort((a, b) => a.segments.join('/').localeCompare(b.segments.join('/')));
  const { prefix: commonRoot, paths: strippedSegments } = stripCommonRoot(entries.map((entry) => entry.segments));
  const treeEntries = entries.map((entry, index) => ({
    ...entry,
    segments: strippedSegments[index] || [],
    stripped: strippedSegments[index] || [],
  }));
  const root = [];
  const nodeMap = new Map();

  function ensureNode(pathSegments) {
    const key = pathSegments.join('/');
    if (nodeMap.has(key)) return nodeMap.get(key);

    const node = createNotebookImportNode(pathSegments[pathSegments.length - 1] || t('notebook.untitled'));
    nodeMap.set(key, node);

    if (!pathSegments.length) {
      root.push(node);
      return node;
    }

    const parent = ensureNode(pathSegments.slice(0, -1));
    parent.children.push(node);
    return node;
  }

  for (const entry of treeEntries) {
    if (entry.stripped.length === 0 && commonRoot.length > 0) {
      continue;
    }

    const segments = entry.segments.length ? entry.segments : [fileStem(entry.file.name)];
    const relative = segments.slice(0, -1);
    const parent = relative.length ? ensureNode(relative) : null;

    let title = fileStem(entry.file.name);
    let content = '';
    let createdAt = null;
    let updatedAt = null;

    const text = await entry.file.text();
    if (kind === 'markdown') {
      const parsed = parseFrontMatter(text);
      title = collapseSpaces(String(parsed.meta.title || title)) || title;
      content = normalizeMarkdownOutput(parsed.body);
      createdAt = normalizeTimestamp(parsed.meta.created);
      updatedAt = normalizeTimestamp(parsed.meta.updated) || createdAt;
    } else {
      const parsed = parseJoplinHtml(text, title);
      title = collapseSpaces(parsed.title || title) || title;
      content = normalizeMarkdownOutput(parsed.content);
    }

    const note = {
      title,
      content,
      created_at: createdAt,
      updated_at: updatedAt,
      children: [],
    };

    if (parent) parent.children.push(note);
    else root.push(note);
  }

  if (
    root.length === 1
    && collapseSpaces(root[0].title) === t('notebook.untitled')
    && !normalizeMarkdownOutput(root[0].content || '')
    && root[0].children.length
  ) {
    return root[0].children;
  }

  return root;
}

function pickNotebookImportFiles() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = IMPORT_ACCEPT;
    input.setAttribute('webkitdirectory', '');
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.top = '0';
    document.body.appendChild(input);

    const cleanup = () => {
      input.remove();
    };

    input.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      cleanup();
      resolve(files);
    }, { once: true });

    input.addEventListener('cancel', () => {
      cleanup();
      resolve([]);
    }, { once: true });

    try {
      input.click();
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

function openNotebookImportDialog() {
  openModal({
    title: t('notebook.importTitle'),
    size: 'md',
    content: `
      <div class="notebook-import-dialog">
        <p class="notebook-import-dialog__copy">${esc(t('notebook.importHint'))}</p>
        <div class="notebook-import-dialog__actions">
          <button class="btn btn--primary" type="button" data-import-kind="markdown">${esc(t('notebook.importMarkdownFolder'))}</button>
          <button class="btn btn--secondary" type="button" data-import-kind="html">${esc(t('notebook.importHtmlFolder'))}</button>
        </div>
        <div class="notebook-import-dialog__status" aria-live="polite"></div>
      </div>
    `,
    onSave(panel) {
      const statusEl = panel.querySelector('.notebook-import-dialog__status');
      const setStatus = (text = '') => {
        if (statusEl) statusEl.textContent = text;
      };

      const runImport = async (kind) => {
        await saveCurrentNote().catch(() => {});
        let files = [];
        try {
          files = await pickNotebookImportFiles();
        } catch (err) {
          setStatus('');
          window.planium.showToast(err.message || t('notebook.importFailed'), 'danger');
          return;
        }

        if (!files.length) {
          setStatus('');
          return;
        }

        const detected = inferNotebookImportKind(files);
        if (!detected) {
          window.planium.showToast(t('notebook.importUnsupported'), 'danger');
          return;
        }

        if (detected !== kind) {
          window.planium.showToast(
            kind === 'markdown'
              ? t('notebook.importMarkdownMismatch')
              : t('notebook.importHtmlMismatch'),
            'danger',
          );
          return;
        }

        const buttons = [...panel.querySelectorAll('[data-import-kind]')];
        buttons.forEach((btn) => { btn.disabled = true; });
        setStatus(kind === 'markdown' ? t('notebook.importReadingMarkdown') : t('notebook.importReadingHtml'));

        try {
          const notes = await parseNotebookImportFiles(files, kind);
          if (!notes.length) {
            throw new Error(t('notebook.importUnsupported'));
          }

          setStatus(t('notebook.importUploading'));
          const res = await api.post('/notebook/import', { notes, source: kind });
          const imported = Number(res?.data?.imported || 0);
          const rootId = Array.isArray(res?.data?.root_ids) ? res.data.root_ids[0] ?? null : null;
          closeModal();
          state.searchQuery = '';
          state.searchResults = [];
          if (searchInputEl) searchInputEl.value = '';
          await refreshNotebook({ selectId: rootId || null, focus: rootId ? 'content' : null });
          window.planium.showToast(
            imported ? t('notebook.importDone', { count: imported }) : t('notebook.importDoneEmpty'),
            'success',
          );
        } catch (err) {
          console.error('Notebook import failed:', err);
          setStatus('');
          window.planium.showToast(err.message || t('notebook.importFailed'), 'danger');
        } finally {
          buttons.forEach((btn) => { btn.disabled = false; });
        }
      };

      panel.querySelectorAll('[data-import-kind]').forEach((btn) => {
        btn.addEventListener('click', () => runImport(btn.dataset.importKind));
      });
    },
  });
}

function openNotebookExportDialog() {
  openModal({
    title: t('notebook.exportTitle'),
    size: 'md',
    content: `
      <div class="notebook-import-dialog">
        <p class="notebook-import-dialog__copy">${esc(t('notebook.exportHint'))}</p>
        <div class="notebook-import-dialog__actions">
          <button class="btn btn--primary" type="button" data-export-kind="markdown">${esc(t('notebook.exportMarkdownFolder'))}</button>
          <button class="btn btn--secondary" type="button" data-export-kind="html">${esc(t('notebook.exportHtmlFolder'))}</button>
        </div>
        <div class="notebook-import-dialog__status" aria-live="polite"></div>
      </div>
    `,
    onSave(panel) {
      const statusEl = panel.querySelector('.notebook-import-dialog__status');
      const buttons = [...panel.querySelectorAll('[data-export-kind]')];
      const setStatus = (text = '') => {
        if (statusEl) statusEl.textContent = text;
      };

      const runExport = async (kind) => {
        buttons.forEach((btn) => { btn.disabled = true; });
        setStatus(kind === 'markdown' ? t('notebook.exportReadingMarkdown') : t('notebook.exportReadingHtml'));

        try {
          await exportNotebookDirectory(kind);
          closeModal();
        } catch (err) {
          console.error('Notebook export failed:', err);
          setStatus('');
          window.planium.showToast(err.message || t('notebook.exportFailed'), 'danger');
        } finally {
          buttons.forEach((btn) => { btn.disabled = false; });
        }
      };

      buttons.forEach((btn) => {
        btn.addEventListener('click', () => runExport(btn.dataset.exportKind));
      });
    },
  });
}

async function clearAllNotebookNotes() {
  const confirmed = await showConfirm(t('notebook.clearAllConfirm'), { danger: true });
  if (!confirmed) return;

  await saveCurrentNote().catch(() => {});
  await api.delete('/notebook/clear');
  state.searchQuery = '';
  state.searchResults = [];
  if (searchInputEl) searchInputEl.value = '';
  state.activeNoteId = null;
  await refreshNotebook({ selectId: null, focus: null });
  window.planium.showToast(t('notebook.clearAllDone'), 'success');
}

async function openFolder(folder) {
  if (state.folder === folder) return;
  await saveCurrentNote().catch(() => {});
  state.folder = folder;
  saveFolder();
  state.searchQuery = '';
  state.searchResults = [];
  if (searchInputEl) searchInputEl.value = '';
  state.activeNoteId = null;
  clearDragState();

  if (folder === 'locked' && !state.lockedUnlocked) {
    await promptUnlockFolder();
    if (!state.lockedUnlocked) {
      state.folder = 'locked';
    }
  }

  await refreshNotebook({ selectId: null, focus: null });
  ensureSidebarVisible(false);
}

async function promptUnlockFolder() {
  const password = window.prompt(t('notebook.lockPasswordPrompt'));
  if (!password) return false;

  try {
    await auth.verifyPassword(password);
    state.lockedUnlocked = true;
    saveLockedUnlocked();
    return true;
  } catch (err) {
    window.planium.showToast(err.message || t('notebook.lockUnlockFailed'), 'danger');
    return false;
  }
}

function clearDragState() {
  state.dragNoteId = null;
  state.dragOverNoteId = null;
  state.dragOverRoot = false;
  rootEl?.querySelectorAll('.notebook-folder.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
}

function renderPreviewFromDraft() {
  if (!editorPreviewEl || !editorContentEl) return;
  if (getEffectiveLayout() === 'editor') {
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
  const path = state.folder === 'trash'
    ? '/notebook/trash'
    : state.folder === 'locked'
      ? '/notebook/locked'
      : '/notebook';
  const res = await api.get(path);
  syncIndexes(Array.isArray(res.data) ? res.data : []);
}

async function runSearch(query) {
  state.searchQuery = query;

  if (!query) {
    state.searchResults = [];
    renderSidebar();
    return;
  }

  if (state.folder === 'locked' && !state.lockedUnlocked) {
    state.searchResults = [];
    renderSidebar();
    return;
  }

  const res = await api.get(`/notebook/search?q=${encodeURIComponent(query)}${state.folder === 'trash' ? '&trashed=1' : state.folder === 'locked' ? '&locked=1' : ''}`);
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
  if (!note || note.trashed_at != null || !editorTitleEl || !editorContentEl) {
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
  const note = getNote(state.activeNoteId);
  if (!note || note.trashed_at != null) return;
  state.dirty = true;
  updateEditorStatus(t('notebook.unsaved'));
  clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(() => {
    saveCurrentNote().catch(() => {});
  }, 850);
}

async function createNote(parentId = null) {
  if (state.folder !== 'notes') {
    state.folder = 'notes';
    saveFolder();
  }
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

async function trashNote(noteId) {
  const note = getNote(noteId);
  if (!note) return;

  const confirmed = await showConfirm(t('notebook.trashConfirm'), { danger: true });
  if (!confirmed) return;

  await api.post(`/notebook/${noteId}/trash`);
  if (state.activeNoteId === noteId) {
    state.activeNoteId = null;
  }
  const fallback = note.parent_id != null && getNote(note.parent_id)
    ? note.parent_id
    : getChildren(null)[0]?.id ?? null;
  state.folder = 'trash';
  saveFolder();
  await refreshNotebook({ selectId: fallback });
}

async function restoreNote(noteId) {
  const note = getNote(noteId);
  if (!note) return;

  await api.post(`/notebook/${noteId}/restore`);
  state.folder = note.locked_at ? 'locked' : 'notes';
  saveFolder();
  state.activeNoteId = null;
  await refreshNotebook({ selectId: noteId });
}

async function deleteNoteForever(noteId) {
  const note = getNote(noteId);
  if (!note) return;

  const confirmed = await showConfirm(t('notebook.deleteForeverConfirm'), { danger: true });
  if (!confirmed) return;

  await api.delete(`/notebook/${noteId}`);
  if (state.activeNoteId === noteId) {
    state.activeNoteId = null;
  }
  const fallback = note.parent_id != null && getNote(note.parent_id)
    ? note.parent_id
    : getChildren(null)[0]?.id ?? null;
  await refreshNotebook({ selectId: fallback });
}

async function lockNote(noteId) {
  const note = getNote(noteId);
  if (!note) return;

  await api.post(`/notebook/${noteId}/lock`);
  state.folder = 'locked';
  saveFolder();
  if (state.activeNoteId === noteId) {
    state.activeNoteId = null;
  }
  await refreshNotebook({ selectId: noteId });
}

async function unlockNote(noteId) {
  const note = getNote(noteId);
  if (!note) return;

  await api.post(`/notebook/${noteId}/unlock`);
  state.folder = 'locked';
  saveFolder();
  if (state.activeNoteId === noteId) {
    state.activeNoteId = null;
  }
  await refreshNotebook({ selectId: noteId });
}

async function moveCurrentNote(kind) {
  const note = getNote(state.activeNoteId);
  if (!note || note.trashed_at != null) return;

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

async function moveNoteToParent(noteId, parentId) {
  const note = getNote(noteId);
  if (!note) return;
  if (note.parent_id === parentId) return;

  await saveCurrentNote().catch(() => {});
  await api.put(`/notebook/${noteId}`, {
    parent_id: parentId,
    sort_order: getChildren(parentId).length,
  });
  await refreshNotebook({ selectId: noteId });
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
          <button class="btn btn--sm btn--secondary notebook-export" title="${esc(t('notebook.exportTitle'))}">
            <i data-lucide="download" aria-hidden="true"></i>
            <span>${esc(t('notebook.exportLabel'))}</span>
          </button>
          <button class="btn btn--sm btn--secondary notebook-import" title="${esc(t('notebook.importTitle'))}">
            <i data-lucide="upload" aria-hidden="true"></i>
            <span>${esc(t('notebook.importLabel'))}</span>
          </button>
          <button class="btn btn--sm btn--danger notebook-clear-all" title="${esc(t('notebook.clearAllLabel'))}">
            <i data-lucide="trash-2" aria-hidden="true"></i>
            <span>${esc(t('notebook.clearAllLabel'))}</span>
          </button>
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

    const exportBtn = event.target.closest('.notebook-export');
    if (exportBtn) {
      openNotebookExportDialog();
      return;
    }

    const importBtn = event.target.closest('.notebook-import');
    if (importBtn) {
      openNotebookImportDialog();
      return;
    }

    const folderBtn = event.target.closest('.notebook-folder');
    if (folderBtn) {
      const folder = folderBtn.dataset.folder;
      if (folder === 'locked' && !state.lockedUnlocked) {
        await openFolder('locked');
      } else {
        await openFolder(folder);
      }
      return;
    }

    const clearAllBtn = event.target.closest('.notebook-clear-all');
    if (clearAllBtn) {
      clearAllNotebookNotes().catch((err) => {
        console.error('Notebook clear all failed:', err);
        window.planium.showToast(err.message || t('notebook.clearAllFailed'), 'danger');
      });
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

      if (action === 'trash') {
        await trashNote(noteId);
        ensureSidebarVisible(false);
        return;
      }

      if (action === 'lock') {
        await lockNote(noteId);
        ensureSidebarVisible(false);
        return;
      }

      if (action === 'restore') {
        await restoreNote(noteId);
        ensureSidebarVisible(false);
        return;
      }

      if (action === 'delete-permanent') {
        await deleteNoteForever(noteId);
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
      if (action === 'trash') {
        await trashNote(state.activeNoteId);
        return;
      }
      if (action === 'lock') {
        await lockNote(state.activeNoteId);
        return;
      }
      if (action === 'restore') {
        await restoreNote(state.activeNoteId);
        return;
      }
      if (action === 'delete-permanent') {
        await deleteNoteForever(state.activeNoteId);
        return;
      }
      await saveCurrentNote().catch(() => {});
      await moveCurrentNote(action);
      return;
    }

    const unlockFolderBtn = event.target.closest('.notebook-unlock-folder');
    if (unlockFolderBtn) {
      await promptUnlockFolder();
      await openFolder('locked');
      return;
    }

    const layoutBtn = event.target.closest('.notebook-layout-btn');
    if (layoutBtn) {
      if (isPhoneLayout() && layoutBtn.dataset.layout === 'split') return;
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
        Promise.resolve()
          .then(() => (state.dirty ? saveCurrentNote() : null))
          .then(() => runSearch(query))
          .catch((err) => {
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

  container.addEventListener('dragstart', (event) => {
    if (state.folder === 'trash') return;
    const row = event.target.closest('.notebook-tree__row');
    if (!row) return;
    const noteId = parseInt(row.dataset.dragNoteId, 10);
    if (!noteId) return;
    state.dragNoteId = noteId;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(noteId));
    row.classList.add('is-dragging');
  });

  container.addEventListener('dragend', () => {
    clearDragState();
    renderSidebar();
  });

  container.addEventListener('dragover', (event) => {
    const folderBtn = event.target.closest('.notebook-folder');
    if (folderBtn && state.dragNoteId) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const folder = folderBtn.dataset.folder;
      const isTrash = folder === 'trash';
      const isLocked = folder === 'locked';
      const isNotes = folder === 'notes';
      folderBtn.classList.add('is-drop-target');
      if (isTrash || isLocked || isNotes) {
        state.dragOverNoteId = null;
        state.dragOverRoot = false;
      }
      return;
    }

    const row = event.target.closest('.notebook-tree__row');
    if (row && state.dragNoteId) {
      const noteId = parseInt(row.dataset.dragNoteId, 10);
      if (!noteId || noteId === state.dragNoteId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      container.querySelectorAll('.notebook-folder.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
      if (state.dragOverNoteId !== noteId || state.dragOverRoot) {
        state.dragOverRoot = false;
        state.dragOverNoteId = noteId;
        renderSidebar();
      }
      return;
    }

    if (state.dragNoteId && event.target.closest('.notebook-sidebar__body') && state.folder !== 'trash') {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      container.querySelectorAll('.notebook-folder.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
      if (!state.dragOverRoot || state.dragOverNoteId !== null) {
        state.dragOverNoteId = null;
        state.dragOverRoot = true;
        renderSidebar();
      }
    }
  });

  container.addEventListener('dragleave', (event) => {
    const folderBtn = event.target.closest('.notebook-folder');
    if (folderBtn) {
      folderBtn.classList.remove('is-drop-target');
    }
  });

  container.addEventListener('drop', async (event) => {
    const noteId = state.dragNoteId || parseInt(event.dataTransfer?.getData('text/plain') || '', 10);
    if (!noteId) return;

    const folderBtn = event.target.closest('.notebook-folder');
    if (folderBtn) {
      event.preventDefault();
      const folder = folderBtn.dataset.folder;
      clearDragState();
      renderSidebar();
      if (folder === 'trash') {
        await trashNote(noteId);
      } else if (folder === 'locked') {
        await lockNote(noteId);
      } else {
        const dragged = getNote(noteId);
        if (!dragged) return;
        if (dragged.trashed_at != null) {
          await restoreNote(noteId);
        } else if (dragged.locked_at != null) {
          await unlockNote(noteId);
        } else {
          await moveNoteToParent(noteId, null);
        }
      }
      return;
    }

    const row = event.target.closest('.notebook-tree__row');
    if (row) {
      event.preventDefault();
      const targetId = parseInt(row.dataset.dragNoteId, 10);
      if (targetId && targetId !== noteId) {
        clearDragState();
        renderSidebar();
        await moveNoteToParent(noteId, targetId);
      }
      return;
    }

    if (event.target.closest('.notebook-sidebar__body') && state.folder !== 'trash') {
      event.preventDefault();
      clearDragState();
      renderSidebar();
      await moveNoteToParent(noteId, null);
    }
  });
}

export async function render(container) {
  rootEl = container;
  renderShell(container);
  container.classList.add('notebook-page');

  if (layoutMediaQuery) {
    layoutMediaQuery.removeEventListener('change', handleLayoutMediaChange);
  }
  layoutMediaQuery = window.matchMedia(PHONE_LAYOUT_QUERY);
  layoutMediaQuery.addEventListener('change', handleLayoutMediaChange);

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

function handleLayoutMediaChange() {
  if (!editorHostEl) return;
  renderEditor();
}
