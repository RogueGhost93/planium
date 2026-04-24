/**
 * Modul: Linkding Bookmarks
 * Zweck: Browse, search, filter, and manage Linkding bookmarks with Linkding-like UX
 * Abhängigkeiten: /api.js, /components/modal.js
 */

import { api, ApiError } from '/api.js';
import { esc } from '/utils/html.js';
import { showConfirm } from '/components/modal.js';

let currentSearch = '';
let currentTags = []; // Array of selected tags (AND logic)
let currentUnread = 'all';
let currentOffset = 0;
let bookmarks = [];
let totalCount = 0;
let allTags = [];
let filteredTags = []; // Tags available in currently filtered results
let isLoading = false;
let bulkSelected = new Set();
let currentLimit = 50;
let bulkEditMode = false;

/**
 * @param {HTMLElement} container
 * @param {{ user: object }} context
 */
export async function render(container, { user }) {
  container.innerHTML = `
    <div class="bookmarks-page-wrapper" style="display:grid;grid-template-columns:250px 1fr;gap:0;height:100vh;background:var(--color-bg)">
      <!-- Sidebar -->
      <aside class="bookmarks-sidebar" style="border-right:1px solid var(--color-border);background:var(--color-surface);display:flex;flex-direction:column;overflow:hidden;height:100vh">
        <div style="padding:var(--space-3);border-bottom:1px solid var(--color-border);flex-shrink:0">
          <h2 style="margin:0;font-size:16px;font-weight:600">Tags</h2>
          <p style="margin:var(--space-1) 0 0 0;font-size:12px;color:var(--color-text-secondary)">Click to filter</p>
        </div>
        <div id="tags-sidebar" style="flex:1;overflow-y:auto;padding:var(--space-2);min-width:0">
        </div>
      </aside>

      <!-- Main content -->
      <main class="bookmarks-main" style="display:flex;flex-direction:column;overflow-y:auto">
        <!-- Header -->
        <div style="padding:var(--space-3);border-bottom:1px solid var(--color-border);background:var(--color-surface);sticky;top:0;z-index:10">
          <div style="display:grid;grid-template-columns:1fr auto auto;gap:var(--space-2);align-items:center;margin-bottom:var(--space-2)">
            <input
              type="text"
              id="bookmarks-search"
              class="form-input"
              placeholder="Search bookmarks..."
              value="${esc(currentSearch)}"
              style="width:100%;font-size:15px;padding:8px 12px"
            />
            <button id="bookmarks-bulk-toggle" class="btn btn--secondary" style="padding:8px 12px;font-size:13px;white-space:nowrap">Bulk Edit</button>
            <select id="bookmarks-per-page" class="form-input" style="padding:8px 12px;font-size:14px;min-width:70px">
              <option value="20" ${currentLimit === 20 ? 'selected' : ''}>20</option>
              <option value="50" ${currentLimit === 50 ? 'selected' : ''}>50</option>
              <option value="100" ${currentLimit === 100 ? 'selected' : ''}>100</option>
            </select>
          </div>

          <!-- Filter controls -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2)">
            <select id="bookmarks-filter" class="form-input" style="width:100%;padding:8px 10px;font-size:14px">
              <option value="all" ${currentUnread === 'all' ? 'selected' : ''}>All Status</option>
              <option value="unread" ${currentUnread === 'unread' ? 'selected' : ''}>Unread</option>
              <option value="read" ${currentUnread === 'read' ? 'selected' : ''}>Read</option>
            </select>
            <div id="bookmarks-info" style="font-size:12px;color:var(--color-text-secondary);padding:8px 10px;text-align:right">
            </div>
          </div>

          <!-- Active filters toolbar -->
          <div id="bookmarks-active-filters" style="display:none;margin-top:var(--space-2);padding:var(--space-2);background:var(--color-bg);border-radius:6px;border:1px solid var(--color-border)">
            <div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:var(--space-1)">Active Filters:</div>
            <div id="filters-container" style="display:flex;flex-wrap:wrap;gap:6px">
            </div>
          </div>
        </div>

        <!-- Content area -->
        <div style="flex:1;overflow-y:auto;padding:var(--space-3)">
          <div id="bookmarks-loading" style="display:none;text-align:center;padding:var(--space-4)">
            <p style="color:var(--color-text-secondary);font-size:14px">Loading bookmarks...</p>
          </div>

          <div id="bookmarks-error" class="form-error" style="margin-bottom:var(--space-3)" hidden></div>

          <!-- Bulk actions toolbar -->
          <div id="bookmarks-bulk-toolbar" style="display:none;margin-bottom:var(--space-3);padding:var(--space-2);background:var(--color-primary);color:var(--color-text-inverse);border-radius:6px;display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap">
            <span id="bulk-count" style="font-size:14px">0 selected</span>
            <button id="bulk-select-all" style="padding:6px 12px;background:rgba(255,255,255,0.2);border:none;border-radius:4px;cursor:pointer;color:inherit;font-size:13px">Select All</button>
            <button id="bulk-unselect-all" style="padding:6px 12px;background:rgba(255,255,255,0.2);border:none;border-radius:4px;cursor:pointer;color:inherit;font-size:13px">Unselect All</button>
            <button id="bulk-mark-read" style="padding:6px 12px;background:rgba(255,255,255,0.2);border:none;border-radius:4px;cursor:pointer;color:inherit;font-size:13px">Mark read</button>
            <button id="bulk-mark-unread" style="padding:6px 12px;background:rgba(255,255,255,0.2);border:none;border-radius:4px;cursor:pointer;color:inherit;font-size:13px">Mark unread</button>
            <button id="bulk-archive" style="padding:6px 12px;background:rgba(255,255,255,0.2);border:none;border-radius:4px;cursor:pointer;color:inherit;font-size:13px">Archive</button>
            <button id="bulk-delete" style="padding:6px 12px;background:rgba(255,255,255,0.2);border:none;border-radius:4px;cursor:pointer;color:inherit;font-size:13px">Delete</button>
            <button id="bulk-clear" style="margin-left:auto;padding:6px 12px;background:rgba(255,255,255,0.2);border:none;border-radius:4px;cursor:pointer;color:inherit;font-size:13px">Exit Bulk</button>
          </div>

          <!-- Bookmarks list -->
          <div id="bookmarks-container" style="display:grid;gap:var(--space-2)">
          </div>

          <!-- Pagination -->
          <div id="bookmarks-pagination" style="display:flex;gap:var(--space-2);justify-content:center;align-items:center;margin-top:var(--space-3);flex-wrap:wrap">
          </div>
        </div>
      </main>
    </div>
  `;

  await loadTags(container);
  await loadBookmarks(container);
  bindEvents(container);
}

async function loadTags(container) {
  try {
    allTags = await api.get('/linkding/tags');
  } catch (err) {
    console.error('Failed to load tags:', err);
  }

  renderTagsSidebar(container);
}

function renderTagsSidebar(container) {
  const tagsSidebar = container.querySelector('#tags-sidebar');
  tagsSidebar.innerHTML = '';

  // Use filtered tags if available (when filters are applied), otherwise use all tags
  const tagsToShow = filteredTags.length > 0 ? filteredTags : allTags;

  if (tagsToShow.length === 0) {
    tagsSidebar.innerHTML = '<p style="color:var(--color-text-secondary);font-size:12px;padding:var(--space-2)">No tags</p>';
    return;
  }

  // Sort tags alphabetically
  const sortedTags = [...tagsToShow].sort((a, b) => {
    const nameA = (a.name || '').toLowerCase();
    const nameB = (b.name || '').toLowerCase();
    return nameA.localeCompare(nameB);
  });

  sortedTags.forEach((tag) => {
    // Skip undefined or empty tag names
    if (!tag.name) return;

    const tagEl = document.createElement('button');
    const isActive = currentTags.includes(tag.name);
    tagEl.style.cssText = `
      display: block;
      width: 100%;
      text-align: left;
      padding: 8px 10px;
      margin-bottom: 4px;
      border: 1px solid ${isActive ? 'var(--color-primary)' : 'var(--color-border)'};
      background: ${isActive ? 'var(--color-primary)' : 'var(--color-surface)'};
      color: ${isActive ? 'var(--color-text-inverse)' : 'var(--color-text)'};
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      transition: all 0.2s;
    `;
    tagEl.textContent = `${tag.name} (${tag.count || 0})`;
    tagEl.style.fontWeight = '500';
    tagEl.addEventListener('click', () => {
      toggleTag(tag.name, container);
    });
    tagEl.addEventListener('mouseover', (e) => {
      if (!isActive) e.target.style.borderColor = 'var(--color-primary)';
    });
    tagEl.addEventListener('mouseout', (e) => {
      if (!isActive) e.target.style.borderColor = 'var(--color-border)';
    });
    tagsSidebar.appendChild(tagEl);
  });
}

function toggleTag(tagName, container) {
  const idx = currentTags.indexOf(tagName);
  if (idx >= 0) {
    currentTags.splice(idx, 1);
  } else {
    currentTags.push(tagName);
  }
  currentOffset = 0;
  bulkSelected.clear();
  renderTagsSidebar(container);
  updateActiveFiltersToolbar(container);
  loadBookmarks(container);
}

function updateActiveFiltersToolbar(container) {
  const toolbar = container.querySelector('#bookmarks-active-filters');
  const filtersContainer = container.querySelector('#filters-container');

  if (currentTags.length === 0) {
    toolbar.style.display = 'none';
    return;
  }

  toolbar.style.display = 'block';
  filtersContainer.innerHTML = '';

  currentTags.forEach((tag) => {
    const filterChip = document.createElement('div');
    filterChip.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--color-primary);
      color: var(--color-text-inverse);
      padding: 6px 10px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
    `;
    filterChip.innerHTML = `
      <span>${esc(tag)}</span>
      <button style="background:none;border:none;color:inherit;cursor:pointer;padding:0;font-size:14px" title="Remove filter">×</button>
    `;
    filterChip.querySelector('button').addEventListener('click', () => {
      toggleTag(tag, container);
    });
    filtersContainer.appendChild(filterChip);
  });
}

async function loadBookmarks(container) {
  if (isLoading) return;
  isLoading = true;

  const loadingEl = container.querySelector('#bookmarks-loading');
  const errorEl = container.querySelector('#bookmarks-error');
  const bookmarksEl = container.querySelector('#bookmarks-container');
  const infoEl = container.querySelector('#bookmarks-info');

  loadingEl.style.display = 'block';
  errorEl.hidden = true;

  try {
    let url = `/linkding/bookmarks?limit=${currentLimit}&offset=${currentOffset}`;
    if (currentSearch) url += `&search=${encodeURIComponent(currentSearch)}`;

    // Apply each tag as a separate parameter (Linkding API expects this for AND logic)
    if (currentTags.length > 0) {
      currentTags.forEach((tag) => {
        url += `&tags=${encodeURIComponent(tag)}`;
      });
    }

    if (currentUnread === 'unread') url += '&unread=true';
    if (currentUnread === 'read') url += '&unread=false';

    console.log('Fetching bookmarks with URL:', url);
    const data = await api.get(url);
    console.log('Received bookmarks data:', data);
    bookmarks = data.results ?? [];
    totalCount = data.count ?? 0;

    // Extract available tags from filtered results
    const tagsSet = new Map();
    bookmarks.forEach((bookmark) => {
      if (bookmark.tag_names && Array.isArray(bookmark.tag_names)) {
        bookmark.tag_names.forEach((tagName) => {
          if (tagName) {
            tagsSet.set(tagName, (tagsSet.get(tagName) || 0) + 1);
          }
        });
      }
    });

    // Build filtered tags array from current results
    filteredTags = Array.from(tagsSet.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const start = currentOffset + 1;
    const end = Math.min(currentOffset + currentLimit, totalCount);
    if (infoEl) {
      infoEl.textContent = totalCount > 0 ? `${start}–${end} of ${totalCount}` : 'No bookmarks';
    }

    renderBookmarks(container);
    renderTagsSidebar(container);
    renderPagination(container);
  } catch (err) {
    console.error('Bookmarks load error:', err);
    errorEl.textContent = err.message || 'Failed to load bookmarks';
    errorEl.hidden = false;
  } finally {
    loadingEl.style.display = 'none';
    isLoading = false;
  }
}

function renderBookmarks(container) {
  const bookmarksEl = container.querySelector('#bookmarks-container');
  bookmarksEl.innerHTML = '';

  if (bookmarks.length === 0) {
    bookmarksEl.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--color-text-secondary);padding:var(--space-3);font-size:14px">No bookmarks found</p>';
    return;
  }

  bookmarks.forEach((bookmark) => {
    const card = document.createElement('div');
    const isSelected = bulkSelected.has(bookmark.id);
    const gridCols = bulkEditMode ? '24px 1fr auto' : '1fr auto';
    card.style.cssText = `
      border: 2px solid ${isSelected ? 'var(--color-primary)' : 'var(--color-border)'};
      border-radius: 8px;
      padding: 12px;
      background: var(--color-surface);
      display: grid;
      grid-template-columns: ${gridCols};
      gap: 12px;
      align-items: start;
      transition: all 0.2s;
    `;

    // Checkbox (only in bulk edit mode)
    if (bulkEditMode) {
      const checkboxEl = document.createElement('input');
      checkboxEl.type = 'checkbox';
      checkboxEl.checked = isSelected;
      checkboxEl.style.cssText = 'cursor:pointer;margin-top:2px';
      checkboxEl.addEventListener('change', () => {
        if (checkboxEl.checked) {
          bulkSelected.add(bookmark.id);
        } else {
          bulkSelected.delete(bookmark.id);
        }
        updateBulkToolbar(container);
        renderBookmarks(container);
      });
      card.appendChild(checkboxEl);
    }

    // Content
    const contentEl = document.createElement('div');
    contentEl.style.cssText = 'display:flex;flex-direction:column;gap:6px;min-width:0;cursor:pointer';
    if (bulkEditMode) {
      contentEl.addEventListener('click', () => {
        const checkbox = card.querySelector('input[type="checkbox"]');
        if (checkbox) {
          checkbox.checked = !checkbox.checked;
          if (checkbox.checked) {
            bulkSelected.add(bookmark.id);
          } else {
            bulkSelected.delete(bookmark.id);
          }
          updateBulkToolbar(container);
          renderBookmarks(container);
        }
      });
    }

    // Favicon + Title
    const titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex;gap:8px;align-items:center;min-width:0';

    const favicon = document.createElement('img');
    favicon.src = `https://www.google.com/s2/favicons?sz=16&domain=${esc(new URL(bookmark.url).hostname)}`;
    favicon.style.cssText = 'width:16px;height:16px;flex-shrink:0;border-radius:2px';
    favicon.addEventListener('error', () => {
      favicon.style.display = 'none';
    });

    const titleLink = document.createElement('a');
    titleLink.href = bookmark.url;
    titleLink.target = '_blank';
    titleLink.rel = 'noopener noreferrer';
    titleLink.style.cssText = `
      font-weight: 600;
      color: var(--color-link);
      text-decoration: none;
      word-break: break-word;
      font-size: 14px;
      line-height: 1.3;
      flex: 1;
      min-width: 0;
    `;
    titleLink.textContent = bookmark.title || bookmark.url;
    titleLink.title = bookmark.title || bookmark.url;
    titleLink.addEventListener('click', (e) => e.stopPropagation());

    titleRow.appendChild(favicon);
    titleRow.appendChild(titleLink);

    // URL
    const urlEl = document.createElement('a');
    urlEl.href = bookmark.url;
    urlEl.target = '_blank';
    urlEl.rel = 'noopener noreferrer';
    urlEl.style.cssText = `
      font-size: 12px;
      color: var(--color-text-secondary);
      text-decoration: none;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding: 0 24px;
    `;
    urlEl.textContent = bookmark.url;
    urlEl.addEventListener('click', (e) => e.stopPropagation());

    // Tags
    const tagsEl = document.createElement('div');
    tagsEl.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;padding:0 24px';
    if (bookmark.tag_names && bookmark.tag_names.length > 0) {
      bookmark.tag_names.forEach((tag) => {
        const tagBadge = document.createElement('span');
        tagBadge.style.cssText = `
          display: inline-block;
          background: var(--color-primary);
          color: var(--color-text-inverse);
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 11px;
          cursor: pointer;
          white-space: nowrap;
        `;
        tagBadge.textContent = tag;
        tagBadge.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleTag(tag, container);
        });
        tagsEl.appendChild(tagBadge);
      });
    }

    contentEl.appendChild(titleRow);
    contentEl.appendChild(urlEl);
    if (bookmark.tag_names && bookmark.tag_names.length > 0) {
      contentEl.appendChild(tagsEl);
    }

    // Actions
    const actionsEl = document.createElement('div');
    actionsEl.style.cssText = 'display:flex;gap:4px;align-items:center;flex-shrink:0;cursor:default';

    const readBtn = document.createElement('button');
    readBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;padding:4px 6px;border-radius:4px;transition:background 0.2s';
    readBtn.textContent = bookmark.unread ? '📖' : '📕';
    readBtn.title = bookmark.unread ? 'Mark read' : 'Mark unread';
    readBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await toggleBookmarkReadStatus(container, bookmark.id, bookmark.unread);
    });
    readBtn.addEventListener('mouseover', (e) => { e.target.style.background = 'var(--color-primary)'; e.target.style.opacity = '0.2'; });
    readBtn.addEventListener('mouseout', (e) => { e.target.style.background = 'none'; });

    const archiveBtn = document.createElement('button');
    archiveBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;padding:4px 6px;border-radius:4px;transition:background 0.2s';
    archiveBtn.textContent = bookmark.archived ? '📭' : '📬';
    archiveBtn.title = bookmark.archived ? 'Unarchive' : 'Archive';
    archiveBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await toggleBookmarkArchive(container, bookmark.id, bookmark.archived);
    });
    archiveBtn.addEventListener('mouseover', (e) => { e.target.style.background = 'var(--color-primary)'; e.target.style.opacity = '0.2'; });
    archiveBtn.addEventListener('mouseout', (e) => { e.target.style.background = 'none'; });

    const deleteBtn = document.createElement('button');
    deleteBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;padding:4px 6px;border-radius:4px;color:var(--color-danger);transition:background 0.2s';
    deleteBtn.textContent = '🗑️';
    deleteBtn.title = 'Delete';
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteBookmark(container, bookmark.id);
    });
    deleteBtn.addEventListener('mouseover', (e) => { e.target.style.background = 'var(--color-danger)'; e.target.style.opacity = '0.2'; });
    deleteBtn.addEventListener('mouseout', (e) => { e.target.style.background = 'none'; });

    actionsEl.appendChild(readBtn);
    actionsEl.appendChild(archiveBtn);
    actionsEl.appendChild(deleteBtn);

    card.appendChild(contentEl);
    card.appendChild(actionsEl);
    bookmarksEl.appendChild(card);
  });
}

function renderPagination(container) {
  const paginationEl = container.querySelector('#bookmarks-pagination');
  paginationEl.innerHTML = '';

  const hasMore = currentOffset + currentLimit < totalCount;

  if (currentOffset > 0) {
    const prevBtn = document.createElement('button');
    prevBtn.style.cssText = 'padding:6px 12px;font-size:13px;border:1px solid var(--color-border);border-radius:4px;background:var(--color-surface);cursor:pointer;color:var(--color-text)';
    prevBtn.textContent = '← Prev';
    prevBtn.addEventListener('click', () => {
      currentOffset = Math.max(0, currentOffset - currentLimit);
      loadBookmarks(container);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    paginationEl.appendChild(prevBtn);
  }

  if (hasMore) {
    const nextBtn = document.createElement('button');
    nextBtn.style.cssText = 'padding:6px 12px;font-size:13px;border:1px solid var(--color-border);border-radius:4px;background:var(--color-surface);cursor:pointer;color:var(--color-text)';
    nextBtn.textContent = 'Next →';
    nextBtn.addEventListener('click', () => {
      currentOffset += currentLimit;
      loadBookmarks(container);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    paginationEl.appendChild(nextBtn);
  }
}

function updateBulkToolbar(container) {
  const toolbar = container.querySelector('#bookmarks-bulk-toolbar');
  const countEl = container.querySelector('#bulk-count');

  if (bulkSelected.size === 0) {
    toolbar.style.display = 'none';
    return;
  }

  toolbar.style.display = 'flex';
  countEl.textContent = `${bulkSelected.size} selected`;
}

async function bulkMarkRead(container, value) {
  const ids = Array.from(bulkSelected);
  for (const id of ids) {
    try {
      await api.patch(`/linkding/bookmarks/${id}`, { unread: !value });
    } catch (err) {
      console.error('Failed to update bookmark:', err);
    }
  }
  bulkSelected.clear();
  await loadBookmarks(container);
}

async function bulkArchive(container) {
  const ids = Array.from(bulkSelected);
  for (const id of ids) {
    try {
      const bookmark = bookmarks.find((b) => b.id === id);
      await api.patch(`/linkding/bookmarks/${id}`, { archived: !bookmark?.archived });
    } catch (err) {
      console.error('Failed to archive bookmark:', err);
    }
  }
  bulkSelected.clear();
  await loadBookmarks(container);
}

async function bulkDelete(container) {
  if (!await showConfirm(`Delete ${bulkSelected.size} bookmark${bulkSelected.size !== 1 ? 's' : ''}?`, { danger: true })) return;

  const ids = Array.from(bulkSelected);
  for (const id of ids) {
    try {
      await api.delete(`/linkding/bookmarks/${id}`);
    } catch (err) {
      console.error('Failed to delete bookmark:', err);
    }
  }
  bulkSelected.clear();
  await loadBookmarks(container);
}

async function toggleBookmarkReadStatus(container, bookmarkId, isCurrentlyUnread) {
  try {
    await api.patch(`/linkding/bookmarks/${bookmarkId}`, { unread: !isCurrentlyUnread });
    await loadBookmarks(container);
  } catch (err) {
    window.planium?.showToast(err.message || 'Failed to update bookmark', 'danger');
  }
}

async function toggleBookmarkArchive(container, bookmarkId, isCurrentlyArchived) {
  try {
    await api.patch(`/linkding/bookmarks/${bookmarkId}`, { archived: !isCurrentlyArchived });
    await loadBookmarks(container);
  } catch (err) {
    window.planium?.showToast(err.message || 'Failed to archive bookmark', 'danger');
  }
}

async function deleteBookmark(container, bookmarkId) {
  if (!await showConfirm('Delete this bookmark?', { danger: true })) return;

  try {
    await api.delete(`/linkding/bookmarks/${bookmarkId}`);
    await loadBookmarks(container);
    window.planium?.showToast('Bookmark deleted', 'default');
  } catch (err) {
    window.planium?.showToast(err.message || 'Failed to delete bookmark', 'danger');
  }
}

function bindEvents(container) {
  const searchInput = container.querySelector('#bookmarks-search');
  const filterSelect = container.querySelector('#bookmarks-filter');
  const perPageSelect = container.querySelector('#bookmarks-per-page');
  const bulkToggleBtn = container.querySelector('#bookmarks-bulk-toggle');
  const bulkSelectAllBtn = container.querySelector('#bulk-select-all');
  const bulkUnselectAllBtn = container.querySelector('#bulk-unselect-all');
  const bulkMarkReadBtn = container.querySelector('#bulk-mark-read');
  const bulkMarkUnreadBtn = container.querySelector('#bulk-mark-unread');
  const bulkArchiveBtn = container.querySelector('#bulk-archive');
  const bulkDeleteBtn = container.querySelector('#bulk-delete');
  const bulkClearBtn = container.querySelector('#bulk-clear');

  searchInput?.addEventListener('input', (e) => {
    currentSearch = e.target.value.trim();
    currentOffset = 0;
    loadBookmarks(container);
  });

  filterSelect?.addEventListener('change', (e) => {
    currentUnread = e.target.value;
    currentOffset = 0;
    loadBookmarks(container);
  });

  perPageSelect?.addEventListener('change', (e) => {
    currentLimit = parseInt(e.target.value, 10);
    currentOffset = 0;
    loadBookmarks(container);
  });

  bulkToggleBtn?.addEventListener('click', () => {
    bulkEditMode = !bulkEditMode;
    bulkSelected.clear();
    bulkToggleBtn.style.background = bulkEditMode ? 'var(--color-primary)' : '';
    bulkToggleBtn.style.color = bulkEditMode ? 'var(--color-text-inverse)' : '';
    updateBulkToolbar(container);
    renderBookmarks(container);
  });

  bulkSelectAllBtn?.addEventListener('click', () => {
    bookmarks.forEach((b) => bulkSelected.add(b.id));
    updateBulkToolbar(container);
    renderBookmarks(container);
  });

  bulkUnselectAllBtn?.addEventListener('click', () => {
    bulkSelected.clear();
    updateBulkToolbar(container);
    renderBookmarks(container);
  });

  bulkMarkReadBtn?.addEventListener('click', () => bulkMarkRead(container, true));
  bulkMarkUnreadBtn?.addEventListener('click', () => bulkMarkRead(container, false));
  bulkArchiveBtn?.addEventListener('click', () => bulkArchive(container));
  bulkDeleteBtn?.addEventListener('click', () => bulkDelete(container));
  bulkClearBtn?.addEventListener('click', () => {
    bulkEditMode = false;
    bulkSelected.clear();
    const bulkToggleBtn = container.querySelector('#bookmarks-bulk-toggle');
    if (bulkToggleBtn) {
      bulkToggleBtn.style.background = '';
      bulkToggleBtn.style.color = '';
    }
    updateBulkToolbar(container);
    renderBookmarks(container);
  });
}

export default { render };
