/**
 * Modul: Notizbuch (Notebook)
 * Zweck: Hierarchische, tagbare Notizen mit Markdown-Editor und Suche
 * Abhängigkeiten: /api.js, /components/modal.js, /i18n.js, /utils/html.js, /utils/ux.js, /vendor/marked.esm.js
 */

import { api } from '/api.js';
import { openModal as openSharedModal, closeModal, showConfirm } from '/components/modal.js';
import { t } from '/i18n.js';
import { esc } from '/utils/html.js';
import { marked } from '/vendor/marked.esm.js';

marked.setOptions({ breaks: true, gfm: true });

// Simple debounce helper
function debounce(fn, delay) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

const state = {
  notes: [],
  tags: [],
  activeNoteId: null,
  activeTagFilter: null,
  searchQuery: '',
  previewMode: false,
  dragNoteId: null,
  debounceTimer: null,
  collapsed: new Set(loadCollapsed()),
};

function loadCollapsed() {
  try {
    return JSON.parse(localStorage.getItem('notebook-collapsed') || '[]');
  } catch { return []; }
}

function saveCollapsed() {
  try {
    localStorage.setItem('notebook-collapsed', JSON.stringify([...state.collapsed]));
  } catch { /* ignore */ }
}

export async function render(container, { user }) {
  container.innerHTML = buildPage();
  container.classList.add('notebook-page');
  state.user = user;

  // Load data
  await loadNotes();
  await loadTags();

  // Render tree and editor
  renderTree();
  if (state.notes.length === 0) {
    renderEmptyState();
  } else {
    renderEditor();
  }

  // Wire event handlers
  wireEventHandlers();
}

// ========================================================================
// Data Loading
// ========================================================================

async function loadNotes() {
  try {
    const res = await api.get('/notebook');
    state.notes = res.data || [];
  } catch (err) {
    console.error('Failed to load notes:', err);
    state.notes = [];
  }
}

async function loadTags() {
  try {
    const res = await api.get('/notebook/tags');
    state.tags = res.data || [];
  } catch (err) {
    console.error('Failed to load tags:', err);
    state.tags = [];
  }
}

// ========================================================================
// Tree Building
// ========================================================================

function buildTree(notes, parentId = null) {
  return notes
    .filter(n => (n.parent_id ?? null) === parentId)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(n => ({
      ...n,
      children: buildTree(notes, n.id),
    }));
}

function getNote(noteId) {
  return state.notes.find(n => n.id === noteId);
}

// ========================================================================
// Rendering
// ========================================================================

function buildPage() {
  return `
    <div class="notebook-layout">
      <aside class="notebook-sidebar">
        <div class="notebook-sidebar__header">
          <input
            type="text"
            class="notebook-search"
            placeholder="${t('search')}"
            aria-label="${t('search')}"
          />
          <button class="btn btn--icon notebook-new-btn" title="${t('add')}">
            <i data-lucide="plus" aria-hidden="true"></i>
          </button>
        </div>
        <div class="notebook-sidebar__tags"></div>
        <nav class="notebook-tree" role="tree"></nav>
      </aside>
      <main class="notebook-editor">
        <div class="editor-toolbar"></div>
        <div class="editor-body">
          <textarea class="editor-input" spellcheck="true"></textarea>
          <div class="editor-preview"></div>
        </div>
      </main>
    </div>
  `;
}

function renderEmptyState() {
  const toolbar = document.querySelector('.editor-toolbar');
  const body = document.querySelector('.editor-body');

  if (toolbar) {
    toolbar.innerHTML = '';
  }

  if (body) {
    body.innerHTML = `
      <div class="editor-empty">
        <i data-lucide="book-open" aria-hidden="true"></i>
        <h2>${t('notebook.empty')}</h2>
        <p>${t('notebook.emptyHint')}</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  }
}

function renderTree() {
  const container = document.querySelector('.notebook-tree');
  if (!container) return;

  const tree = buildTree(state.notes);
  let html = '';

  function renderNode(node, depth = 0) {
    const isActive = node.id === state.activeNoteId;
    const hasChildren = node.children && node.children.length > 0;
    const isCollapsed = state.collapsed.has(node.id);
    const activeCls = isActive ? 'active' : '';

    html += `<li class="notebook-tree__li" style="--depth: ${depth}">`;
    html += `<div class="notebook-tree__row ${activeCls}">`;

    // Expand/collapse toggle
    if (hasChildren) {
      const chevron = isCollapsed ? 'chevron-right' : 'chevron-down';
      html += `<button class="notebook-tree__toggle" data-toggle-id="${node.id}" aria-label="Toggle">
        <i data-lucide="${chevron}" aria-hidden="true"></i>
      </button>`;
    } else {
      html += `<span class="notebook-tree__toggle-placeholder"></span>`;
    }

    html += `<button class="notebook-tree__item" data-note-id="${node.id}" draggable="true">
      ${esc(node.title || t('notebook.untitled'))}
    </button>`;

    // Add-child button
    html += `<button class="notebook-tree__add-child" data-add-child-id="${node.id}" title="Add child note" aria-label="Add child note">
      <i data-lucide="plus" aria-hidden="true"></i>
    </button>`;

    // Delete button
    html += `<button class="notebook-tree__delete" data-delete-id="${node.id}" title="Delete note" aria-label="Delete note">
      <i data-lucide="trash-2" aria-hidden="true"></i>
    </button>`;

    html += `</div>`;

    if (hasChildren && !isCollapsed) {
      html += '<ul class="notebook-tree__list">';
      node.children.forEach(child => renderNode(child, depth + 1));
      html += '</ul>';
    }
    html += '</li>';
  }

  html = '<ul class="notebook-tree__list">';
  tree.forEach(node => renderNode(node));
  html += '</ul>';

  container.innerHTML = html;
  if (window.lucide) window.lucide.createIcons();
}

function renderTags() {
  const container = document.querySelector('.notebook-sidebar__tags');
  if (!container) return;

  let html = '';
  for (const tag of state.tags) {
    const isActive = state.activeTagFilter === tag.id;
    const cls = isActive ? 'active' : '';
    html += `<button class="notebook-tag-chip ${cls}" data-tag-id="${tag.id}">${esc(tag.name)}</button>`;
  }
  html += `<button class="notebook-tag-chip notebook-tag-new" title="${t('add')}"><i data-lucide="plus" aria-hidden="true"></i></button>`;

  container.innerHTML = html;
  if (window.lucide) window.lucide.createIcons();
}

function renderEditor() {
  const note = getNote(state.activeNoteId);
  if (!note) {
    renderEmptyState();
    return;
  }

  const toolbar = document.querySelector('.editor-toolbar');
  const textarea = document.querySelector('.editor-input');
  const preview = document.querySelector('.editor-preview');

  if (toolbar) {
    toolbar.innerHTML = `
      <div class="editor-toolbar__left">
        <input type="text" class="editor-title" value="${esc(note.title || '')}" placeholder="${t('notebook.untitled')}" />
      </div>
      <div class="editor-toolbar__right">
        <button class="btn btn--sm btn--icon editor-btn-bold" title="Bold (Ctrl+B)">
          <i data-lucide="bold" aria-hidden="true"></i>
        </button>
        <button class="btn btn--sm btn--icon editor-btn-italic" title="Italic (Ctrl+I)">
          <i data-lucide="italic" aria-hidden="true"></i>
        </button>
        <div class="editor-toolbar__sep"></div>
        <button class="btn btn--sm btn--icon editor-btn-h1" title="Heading 1">
          <strong>H1</strong>
        </button>
        <button class="btn btn--sm btn--icon editor-btn-h2" title="Heading 2">
          <strong>H2</strong>
        </button>
        <button class="btn btn--sm btn--icon editor-btn-h3" title="Heading 3">
          <strong>H3</strong>
        </button>
        <button class="btn btn--sm btn--icon editor-btn-list" title="List">
          <i data-lucide="list" aria-hidden="true"></i>
        </button>
        <button class="btn btn--sm btn--icon editor-btn-link" title="Link">
          <i data-lucide="link" aria-hidden="true"></i>
        </button>
        <button class="btn btn--sm btn--icon editor-btn-hr" title="Divider">
          <i data-lucide="minus" aria-hidden="true"></i>
        </button>
        <div class="editor-toolbar__sep"></div>
        <button class="btn btn--sm btn--toggle editor-btn-preview" title="Preview">
          <i data-lucide="eye" aria-hidden="true"></i>
        </button>
        <span class="editor-status"></span>
      </div>
    `;
  }

  if (textarea) {
    textarea.value = note.content || '';
    textarea.style.display = state.previewMode ? 'none' : 'block';
  }

  if (preview) {
    preview.innerHTML = state.previewMode ? marked.parse(note.content || '') : '';
    preview.style.display = state.previewMode ? 'block' : 'none';
  }

  if (window.lucide) window.lucide.createIcons();
}

// ========================================================================
// Event Handlers
// ========================================================================

function wireEventHandlers() {
  // Sidebar: new note and tag buttons
  const container = document.querySelector('.notebook-page');
  if (!container) return;

  container.addEventListener('click', async (e) => {
    const newBtn = e.target.closest('.notebook-new-btn');
    if (newBtn) {
      e.stopPropagation();
      await onNewNote();
      return;
    }

    const tagBtn = e.target.closest('.notebook-tag-new');
    if (tagBtn) {
      e.stopPropagation();
      await onNewTag();
      return;
    }

    const treeItem = e.target.closest('.notebook-tree__item');
    if (treeItem) {
      e.stopPropagation();
      const noteId = parseInt(treeItem.dataset.noteId, 10);
      if (noteId !== state.activeNoteId) {
        state.activeNoteId = noteId;
        state.previewMode = false;
        renderTree();
        renderEditor();
      }
      return;
    }
  });

  // Search
  const searchInput = document.querySelector('.notebook-search');
  if (searchInput) {
    searchInput.addEventListener('input', debounce(onSearch, 300));
  }

  // Toolbar: markdown buttons
  container.addEventListener('click', (e) => {
    const textarea = document.querySelector('.editor-input');
    if (!textarea) return;

    if (e.target.closest('.editor-btn-bold')) {
      e.stopPropagation();
      insertMarkdown(textarea, '**', '**');
    } else if (e.target.closest('.editor-btn-italic')) {
      e.stopPropagation();
      insertMarkdown(textarea, '*', '*');
    } else if (e.target.closest('.editor-btn-h1')) {
      e.stopPropagation();
      insertMarkdown(textarea, '# ', '', true);
    } else if (e.target.closest('.editor-btn-h2')) {
      e.stopPropagation();
      insertMarkdown(textarea, '## ', '', true);
    } else if (e.target.closest('.editor-btn-h3')) {
      e.stopPropagation();
      insertMarkdown(textarea, '### ', '', true);
    } else if (e.target.closest('.editor-btn-list')) {
      e.stopPropagation();
      insertMarkdown(textarea, '- ', '', true);
    } else if (e.target.closest('.editor-btn-link')) {
      e.stopPropagation();
      insertMarkdown(textarea, '[', '](url)');
    } else if (e.target.closest('.editor-btn-hr')) {
      e.stopPropagation();
      insertMarkdown(textarea, '\n---\n', '', true);
    } else if (e.target.closest('.editor-btn-preview')) {
      e.stopPropagation();
      togglePreview(e.target.closest('.editor-btn-preview'));
    }
  });

  // Auto-save on content change (delegated since editor re-renders)
  const debouncedSave = debounce(saveNote, 1500);
  container.addEventListener('input', (e) => {
    if (e.target.matches('.editor-input') || e.target.matches('.editor-title')) {
      debouncedSave();
    }
  });

  // Drag and drop
  document.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.notebook-tree__item');
    if (item) {
      state.dragNoteId = parseInt(item.dataset.noteId, 10);
      e.dataTransfer.effectAllowed = 'move';
    }
  });

  document.addEventListener('dragover', (e) => {
    if (state.dragNoteId === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const item = e.target.closest('.notebook-tree__item');
    if (item && parseInt(item.dataset.noteId, 10) !== state.dragNoteId) {
      const rect = item.getBoundingClientRect();
      const thirdHeight = rect.height / 3;
      const relY = e.clientY - rect.top;

      item.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-into');
      if (relY < thirdHeight) {
        item.classList.add('drag-over-before');
      } else if (relY > thirdHeight * 2) {
        item.classList.add('drag-over-after');
      } else {
        item.classList.add('drag-over-into');
      }
    }
  });

  document.addEventListener('dragleave', (e) => {
    const item = e.target.closest('.notebook-tree__item');
    if (item) {
      item.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-into');
    }
  });

  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (state.dragNoteId === null) return;

    const dropTarget = e.target.closest('.notebook-tree__item');
    if (!dropTarget) return;

    const targetNoteId = parseInt(dropTarget.dataset.noteId, 10);
    if (targetNoteId === state.dragNoteId) return;

    dropTarget.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-into');

    const dragNote = getNote(state.dragNoteId);
    if (!dragNote) return;

    // Determine parent_id and sort_order based on drop position
    const rect = dropTarget.getBoundingClientRect();
    const thirdHeight = rect.height / 3;
    const relY = e.clientY - rect.top;

    let newParentId, newSortOrder;

    if (relY < thirdHeight || relY > thirdHeight * 2) {
      // Drop before or after: keep same parent, adjust sort_order
      newParentId = dragNote.parent_id;
      const siblings = state.notes.filter(n => (n.parent_id ?? null) === newParentId);
      const targetIdx = siblings.findIndex(n => n.id === targetNoteId);
      if (relY < thirdHeight && targetIdx >= 0) {
        newSortOrder = Math.max(0, siblings[targetIdx].sort_order - 1);
      } else {
        newSortOrder = (siblings[targetIdx]?.sort_order ?? -1) + 1;
      }
    } else {
      // Drop into: make target the parent
      newParentId = targetNoteId;
      const children = state.notes.filter(n => n.parent_id === targetNoteId);
      newSortOrder = Math.max(0, (children[children.length - 1]?.sort_order ?? -1) + 1);
    }

    await updateNote(state.dragNoteId, { parent_id: newParentId, sort_order: newSortOrder });
    state.dragNoteId = null;
  });

  document.addEventListener('dragend', (e) => {
    document.querySelectorAll('.notebook-tree__item').forEach(el => {
      el.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-into');
    });
  });

  renderTags();
}

// ========================================================================
// Actions
// ========================================================================

async function onNewNote() {
  const parentId = state.activeNoteId || null;

  try {
    const res = await api.post('/notebook', {
      title: t('notebook.untitled'),
      content: '',
      parent_id: parentId,
    });

    state.notes.push(res.data);
    state.activeNoteId = res.data.id;
    state.previewMode = false;

    renderTree();
    renderEditor();
  } catch (err) {
    console.error('Failed to create note:', err);
  }
}

async function onNewTag() {
  const tagName = prompt('Enter tag name:');
  if (!tagName || tagName.trim() === '') return;

  try {
    const res = await api.post('/notebook/tags', { name: tagName });
    state.tags.push(res.data);
    renderTags();
  } catch (err) {
    console.error('Failed to create tag:', err);
  }
}

async function onSearch(e) {
  const query = e.target.value.trim();
  state.searchQuery = query;

  if (query === '') {
    renderTree();
    return;
  }

  try {
    const res = await api.get(`/notebook/search?q=${encodeURIComponent(query)}`);
    const data = res.data || [];
    const container = document.querySelector('.notebook-tree');
    if (!container) return;

    let html = '';
    for (const result of data) {
      const isActive = result.id === state.activeNoteId;
      const cls = isActive ? 'active' : '';
      html += `<li class="notebook-tree__li">`;
      html += `<button class="notebook-tree__item ${cls}" data-note-id="${result.id}">${esc(result.title)}</button>`;
      html += `<small class="notebook-tree__excerpt">${result.excerpt}</small>`;
      html += '</li>';
    }

    container.innerHTML = `<ul class="notebook-tree__list">${html}</ul>`;
    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    console.error('Search failed:', err);
  }
}

function insertMarkdown(textarea, before, after = '', newline = false) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  const selected = text.substring(start, end) || before;

  let newText, newCursorPos;

  if (newline) {
    // Heading or list: prepend to line start
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = text.indexOf('\n', start) === -1 ? text.length : text.indexOf('\n', start);
    const beforeLine = text.substring(0, lineStart);
    const line = text.substring(lineStart, lineEnd);
    const afterLine = text.substring(lineEnd);

    newText = beforeLine + before + line + afterLine;
    newCursorPos = lineStart + before.length + line.length;
  } else {
    // Inline: wrap selection
    newText = text.substring(0, start) + before + selected + after + text.substring(end);
    newCursorPos = start + before.length + selected.length;
  }

  textarea.value = newText;
  textarea.selectionStart = textarea.selectionEnd = newCursorPos;
  textarea.focus();

  // Trigger input to mark as dirty
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function togglePreview(btn) {
  state.previewMode = !state.previewMode;
  btn.classList.toggle('active');
  renderEditor();
}

async function saveNote() {
  if (!state.activeNoteId) return;

  const textarea = document.querySelector('.editor-input');
  const titleEl = document.querySelector('.editor-title');
  const statusEl = document.querySelector('.editor-status');

  if (!textarea || !titleEl) return;

  const note = getNote(state.activeNoteId);
  if (!note) return;

  const title = (titleEl.value || '').trim() || t('notebook.untitled');
  const content = textarea.value;

  // Only save if changed
  if (note.title === title && note.content === content) return;

  try {
    if (statusEl) statusEl.textContent = 'Saving…';

    await updateNote(state.activeNoteId, { title, content });

    // Update tree to reflect title change
    renderTree();

    if (statusEl) {
      statusEl.textContent = 'Saved';
      setTimeout(() => {
        statusEl.textContent = '';
      }, 2000);
    }
  } catch (err) {
    console.error('Failed to save note:', err);
    if (statusEl) statusEl.textContent = 'Failed to save';
  }
}

async function updateNote(noteId, updates) {
  const res = await api.put(`/notebook/${noteId}`, updates);

  // Update local state
  const idx = state.notes.findIndex(n => n.id === noteId);
  if (idx >= 0) {
    state.notes[idx] = { ...state.notes[idx], ...res.data };
  }
}
