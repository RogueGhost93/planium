/**
 * Modul: Linkding Bookmarks
 * Zweck: Browse, search, filter, and manage Linkding bookmarks with Linkding-like UX
 * Abhängigkeiten: /api.js, /components/modal.js
 */

import { api, ApiError } from '/api.js';
import { esc } from '/utils/html.js';
import { openModal, closeModal, showConfirm } from '/components/modal.js';

let currentSearch = '';
let currentTags = []; // Array of selected tags (AND logic)
let currentStatusFilter = 'unread'; // 'all', 'unread', 'read', 'untagged', 'archived'
let currentOffset = 0;
let bookmarks = [];
let totalCount = 0;
let allTags = [];
let filteredTags = []; // Tags available in currently filtered results
let isLoading = false;
let bulkSelected = new Set();
let currentLimit = 50;
let bulkEditMode = false;
let tagSortMode = 'alpha'; // 'alpha' or 'count'
let tagModalRefresh = null; // Set while mobile tag filter modal is open
let bookmarkletHandled = false;

const FILTERS_STORAGE_KEY = 'bookmarks_filters';
const TAG_SORT_STORAGE_KEY = 'bookmarks_tag_sort';

function saveFiltersToStorage() {
  const filters = {
    search: currentSearch,
    tags: currentTags,
    statusFilter: currentStatusFilter,
    limit: currentLimit,
  };
  localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
}

function restoreFiltersFromStorage() {
  const stored = localStorage.getItem(FILTERS_STORAGE_KEY);
  if (stored) {
    try {
      const filters = JSON.parse(stored);
      currentSearch = filters.search || '';
      currentTags = Array.isArray(filters.tags) ? filters.tags : [];
      currentStatusFilter = filters.statusFilter || 'unread';
      currentLimit = filters.limit || 50;
    } catch (e) {
      console.error('Failed to restore filters:', e);
    }
  }

  // Restore tag sort preference
  const storedSort = localStorage.getItem(TAG_SORT_STORAGE_KEY);
  if (storedSort && (storedSort === 'alpha' || storedSort === 'count')) {
    tagSortMode = storedSort;
  }
}

/**
 * @param {HTMLElement} container
 * @param {{ user: object }} context
 */
export async function render(container, { user }) {
  // Restore filters from previous session
  restoreFiltersFromStorage();

  bookmarkletHandled = false;

  // Reset pagination when page loads
  currentOffset = 0;

  container.innerHTML = `
    <style>
      #mobile-tag-filter-btn { display: none }
      @media (max-width: 768px) {
        .bookmarks-content { grid-template-columns: 1fr !important }
        .bookmarks-sidebar { display: none !important }
        #mobile-tag-filter-btn { display: inline-flex !important }
        .bookmarks-main { overflow-x: hidden; max-width: 100vw }
        .bm-card { padding: 10px !important }
        .bm-title { font-size: 12px !important }
        .bm-url { font-size: 10px !important }
        .bm-tag { font-size: 10px !important }
        .bm-actions { font-size: 11px }
      }
    </style>
    <div class="bookmarks-page-wrapper" style="display:flex;flex-direction:column;height:100vh;background:var(--color-bg)">
      <div class="bookmarks-toolbar" style="flex-shrink:0">
        <h1 class="bookmarks-toolbar__title">Bookmarks</h1>
        <div></div>
        <div class="bookmarks-toolbar__actions">
          <button id="mobile-tag-filter-btn" class="btn btn--secondary" style="padding:6px 10px;font-size:13px;white-space:nowrap;align-items:center;gap:6px">🏷️ Tags${currentTags.length > 0 ? ` <span style="background:var(--color-primary);color:var(--color-text-inverse);border-radius:10px;padding:1px 7px;font-size:11px">${currentTags.length}</span>` : ''}</button>
          <button id="bookmarks-bulk-toggle" class="btn btn--secondary" style="padding:6px 12px;font-size:13px;white-space:nowrap">Bulk Edit</button>
        </div>
      </div>
      <div class="bookmarks-content" style="flex:1;min-height:0;display:grid;grid-template-columns:250px 1fr;overflow:hidden;margin:0 var(--space-3) var(--space-3);border-radius:var(--radius-md);box-shadow:var(--shadow-sm)">
      <!-- Sidebar -->
      <aside class="bookmarks-sidebar" style="border-right:1px solid var(--color-border);background:var(--color-surface);display:flex;flex-direction:column;overflow:hidden">
        <div style="padding:var(--space-3);border-bottom:1px solid var(--color-border);flex-shrink:0">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:var(--space-2)">
            <button id="sidebar-clear-filters" class="btn btn--secondary" style="padding:6px 8px;font-size:11px;white-space:nowrap">Clear</button>
            <button id="sidebar-sort-toggle" class="btn btn--secondary" style="padding:6px 8px;font-size:11px;white-space:nowrap" title="Sort by alphabetical (A-Z) or by count (high to low)">Sort: A-Z</button>
          </div>
          <h2 style="margin:0 0 var(--space-2) 0;font-size:16px;font-weight:600">Tags</h2>
          <input
            type="text"
            id="tags-search"
            class="form-input"
            placeholder="Search tags..."
            style="width:100%;font-size:12px;padding:6px 8px"
          />
        </div>
        <div id="tags-sidebar" style="flex:1;overflow-y:auto;padding:var(--space-2);min-width:0">
        </div>
      </aside>

      <!-- Main content -->
      <main class="bookmarks-main" style="display:flex;flex-direction:column;overflow-y:auto">
        <!-- Header -->
        <div style="padding:var(--space-3);border-bottom:1px solid var(--color-border);background:var(--color-surface);sticky;top:0;z-index:10">
          <div style="margin-bottom:var(--space-2)">
            <input
              type="text"
              id="bookmarks-search"
              class="form-input"
              placeholder="Search bookmarks..."
              value="${esc(currentSearch)}"
              style="width:100%;font-size:15px;padding:8px 12px"
            />
          </div>

          <!-- Filter controls -->
          <div style="display:flex;gap:var(--space-2);align-items:center">
            <select id="bookmarks-filter" class="form-input" style="flex:1;min-width:0;padding:8px 10px;font-size:14px">
              <option value="all" ${currentStatusFilter === 'all' ? 'selected' : ''}>All Status</option>
              <option value="unread" ${currentStatusFilter === 'unread' ? 'selected' : ''}>Unread</option>
              <option value="read" ${currentStatusFilter === 'read' ? 'selected' : ''}>Read</option>
              <option value="untagged" ${currentStatusFilter === 'untagged' ? 'selected' : ''}>Untagged</option>
              <option value="archived" ${currentStatusFilter === 'archived' ? 'selected' : ''}>Archived</option>
            </select>
            <select id="bookmarks-per-page" class="form-input" style="padding:8px 10px;font-size:14px;width:70px;flex-shrink:0">
              <option value="20" ${currentLimit === 20 ? 'selected' : ''}>20</option>
              <option value="50" ${currentLimit === 50 ? 'selected' : ''}>50</option>
              <option value="100" ${currentLimit === 100 ? 'selected' : ''}>100</option>
            </select>
            <div id="bookmarks-info" style="font-size:12px;color:var(--color-text-secondary);white-space:nowrap;padding:8px 4px">
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
          <div id="bookmarks-bulk-toolbar" style="display:none;margin-bottom:var(--space-3);padding:var(--space-2);background:var(--color-primary);color:var(--color-text-inverse);border-radius:6px;gap:var(--space-2);align-items:center;flex-wrap:wrap">
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
      <button type="button" class="page-fab bookmarks-fab" id="bookmarks-add-fab" aria-label="Add bookmark" title="Add bookmark" style="--module-accent: var(--module-bookmarks);">
        <i data-lucide="plus" aria-hidden="true"></i>
      </button>
    </div>
  `;

  bindEvents(container);
  maybeHandleBookmarkletLaunch(container);
  loadTags(container)
    .then(() => loadBookmarks(container))
    .catch(err => console.error('Bookmarks load error:', err));
}

function maybeHandleBookmarkletLaunch(container) {
  if (bookmarkletHandled) return;
  const params = new URLSearchParams(window.location.search);
  const isBookmarkletLaunch = params.get('bookmarklet') === '1' || params.get('bookmarklet') === 'true' || params.get('save') === '1';
  if (!isBookmarkletLaunch) return;

  const url = params.get('url') || '';
  const title = params.get('title') || '';
  const description = params.get('description') || params.get('notes') || '';
  const unreadParam = params.get('unread');
  const unread = unreadParam === null ? true : !(unreadParam === '0' || unreadParam === 'false');

  bookmarkletHandled = true;
  window.history.replaceState({}, '', '/bookmarks');
  openNewBookmarkModal(container, { url, title, description, unread });
}

async function loadTags(container) {
  try {
    const tagsData = await api.get('/linkding/tags');
    console.log('Loaded tags from API:', tagsData.length, 'tags');
    // Linkding tags API doesn't include counts, just names
    // Counts will be populated from actual bookmarks in loadBookmarks
    allTags = tagsData.map(tag => ({ name: tag.name, count: 0 }));
  } catch (err) {
    console.error('Failed to load tags:', err);
    allTags = [];
  }

  // Render sidebar - will show allTags if no filters, or loading state if filters applied
  // When filters are applied, loadBookmarks will update with filteredTags
  renderTagsSidebar(container);
}

function renderTagsSidebar(container) {
  const tagsSidebar = container.querySelector('#tags-sidebar');
  const tagsSearchInput = container.querySelector('#tags-search');
  const searchTerm = tagsSearchInput?.value.toLowerCase().trim() || '';

  tagsSidebar.innerHTML = '';

  // Show all tags when no filters applied, but narrow down when filters are active
  // This creates cascading filters: each tag selection reduces available options
  let tagsToShow = currentTags.length === 0 ? allTags : filteredTags;

  // Filter tags by search term
  if (searchTerm) {
    tagsToShow = tagsToShow.filter(tag =>
      (tag.name || '').toLowerCase().includes(searchTerm)
    );
  }

  if (tagsToShow.length === 0) {
    tagsSidebar.innerHTML = '<p style="color:var(--color-text-secondary);font-size:12px;padding:var(--space-2)">No tags</p>';
    return;
  }

  // Sort tags based on current sort mode
  const sortedTags = [...tagsToShow].sort((a, b) => {
    if (tagSortMode === 'count') {
      // Sort by count descending (high to low), then alphabetically for ties
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      const nameA = (a.name || '').toLowerCase();
      const nameB = (b.name || '').toLowerCase();
      return nameA.localeCompare(nameB);
    } else {
      // Sort alphabetically (A-Z)
      const nameA = (a.name || '').toLowerCase();
      const nameB = (b.name || '').toLowerCase();
      return nameA.localeCompare(nameB);
    }
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
  console.log('Toggle tag:', tagName, '| Current tags:', currentTags);
  currentOffset = 0;
  bulkSelected.clear();
  saveFiltersToStorage();
  renderTagsSidebar(container);
  updateActiveFiltersToolbar(container);
  loadBookmarks(container);
}

function updateActiveFiltersToolbar(container) {
  const toolbar = container.querySelector('#bookmarks-active-filters');
  const filtersContainer = container.querySelector('#filters-container');
  const mobileBtn = container.querySelector('#mobile-tag-filter-btn');
  if (mobileBtn) {
    mobileBtn.innerHTML = `🏷️ Tags${currentTags.length > 0 ? ` <span style="background:var(--color-primary);color:var(--color-text-inverse);border-radius:10px;padding:1px 7px;font-size:11px;margin-left:2px">${currentTags.length}</span>` : ''}`;
  }

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

    // Send status filter to backend
    url += `&statusFilter=${encodeURIComponent(currentStatusFilter)}`;

    console.log('Fetching bookmarks with URL:', url);
    const data = await api.get(url);
    console.log('Received bookmarks data:', data);
    bookmarks = (data.results ?? []).map(b => ({ ...b, archived: b.is_archived }));
    totalCount = data.count ?? 0;

    const start = currentOffset + 1;
    const end = Math.min(currentOffset + currentLimit, totalCount);
    if (infoEl) {
      infoEl.textContent = totalCount > 0 ? `${start}–${end} of ${totalCount}` : 'No bookmarks';
    }

    // Extract available tags based on current filter state
    if (currentTags.length > 0) {
      // When filters applied: extract tags from ALL matching bookmarks
      // This creates cascading filters: only show tags that exist in filtered results
      // Paginate through all results to get accurate counts
      try {
        const tagsSet = new Map();
        let offset = 0;
        let hasMore = true;
        let totalFetched = 0;

        while (hasMore) {
          let paginatedUrl = `/linkding/bookmarks?limit=200&offset=${offset}`;

          // Use same format as initial request: send &tags= parameters
          if (currentSearch) paginatedUrl += `&search=${encodeURIComponent(currentSearch)}`;
          currentTags.forEach(tag => {
            if (tag && typeof tag === 'string') {
              paginatedUrl += `&tags=${encodeURIComponent(tag)}`;
            }
          });

          paginatedUrl += `&statusFilter=${encodeURIComponent(currentStatusFilter)}`;

          console.log('Fetching filtered bookmarks page at offset', offset);
          const pageData = await api.get(paginatedUrl);
          const pageBookmarks = pageData.results ?? [];

          if (pageBookmarks.length === 0) {
            hasMore = false;
            break;
          }

          // Extract tags from this page
          pageBookmarks.forEach((bookmark) => {
            if (bookmark.tag_names && Array.isArray(bookmark.tag_names)) {
              bookmark.tag_names.forEach((tagName) => {
                if (tagName) {
                  tagsSet.set(tagName, (tagsSet.get(tagName) || 0) + 1);
                }
              });
            }
          });

          totalFetched += pageBookmarks.length;

          // Check if we got less than the limit (indicates last page)
          if (pageBookmarks.length < 200) {
            hasMore = false;
          } else {
            offset += 200;
          }
        }

        filteredTags = Array.from(tagsSet.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => a.name.localeCompare(b.name));

        console.log('Extracted filtered tags:', filteredTags.length, 'tags from', totalFetched, 'bookmarks across', Math.ceil(totalFetched / 200), 'pages');
      } catch (err) {
        console.error('Failed to load all matching bookmarks:', err);
        // Fallback to current page bookmarks only
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

        filteredTags = Array.from(tagsSet.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => a.name.localeCompare(b.name));
      }
    } else {
      // No filters applied: extract tags from all bookmarks to show counts
      // Paginate through ALL bookmarks to get accurate counts (not just first 10000)
      try {
        const tagsSet = new Map();
        let offset = 0;
        let hasMore = true;
        let totalFetched = 0;

        while (hasMore) {
          let paginatedUrl = `/linkding/bookmarks?limit=200&offset=${offset}`;
          if (currentSearch) paginatedUrl += `&search=${encodeURIComponent(currentSearch)}`;
          paginatedUrl += `&statusFilter=${encodeURIComponent(currentStatusFilter)}`;

          console.log('Fetching bookmarks page at offset', offset);
          const pageData = await api.get(paginatedUrl);
          const pageBookmarks = pageData.results ?? [];

          if (pageBookmarks.length === 0) {
            hasMore = false;
            break;
          }

          // Extract tags from this page
          pageBookmarks.forEach((bookmark) => {
            if (bookmark.tag_names && Array.isArray(bookmark.tag_names)) {
              bookmark.tag_names.forEach((tagName) => {
                if (tagName) {
                  tagsSet.set(tagName, (tagsSet.get(tagName) || 0) + 1);
                }
              });
            }
          });

          totalFetched += pageBookmarks.length;

          // Check if we got less than the limit (indicates last page)
          if (pageBookmarks.length < 200) {
            hasMore = false;
          } else {
            offset += 200;
          }
        }

        // Update allTags with counts from actual bookmarks
        allTags = allTags.map(tag => ({
          name: tag.name,
          count: tagsSet.get(tag.name) || 0
        }));

        filteredTags = []; // Clear filtered tags when no filters applied
        console.log('Extracted all tags:', allTags.length, 'tags from', totalFetched, 'bookmarks across', Math.ceil(totalFetched / 200), 'pages');
      } catch (err) {
        console.error('Failed to load all bookmarks for tag counts:', err);
        // Fallback: allTags stays as is with count 0
        filteredTags = [];
      }
    }

    renderBookmarks(container);
    renderPagination(container);
    renderTagsSidebar(container);
    if (tagModalRefresh) tagModalRefresh();
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
    card.className = 'bm-card';
    card.style.cssText = `
      border: 2px solid ${isSelected ? 'var(--color-primary)' : 'var(--color-border)'};
      border-radius: 8px;
      padding: 12px;
      background: var(--color-surface);
      display: flex;
      flex-direction: column;
      gap: 8px;
      transition: all 0.2s;
      min-width: 0;
      max-width: 100%;
    `;

    // Checkbox (only in bulk edit mode)
    let checkboxEl = null;
    if (bulkEditMode) {
      checkboxEl = document.createElement('input');
      checkboxEl.type = 'checkbox';
      checkboxEl.checked = isSelected;
      checkboxEl.style.cssText = 'cursor:pointer;margin-top:2px;flex-shrink:0';
      checkboxEl.addEventListener('change', () => {
        if (checkboxEl.checked) {
          bulkSelected.add(bookmark.id);
        } else {
          bulkSelected.delete(bookmark.id);
        }
        updateBulkToolbar(container);
        renderBookmarks(container);
      });
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
    favicon.style.cssText = 'width:16px;height:16px;flex-shrink:0;border-radius:2px';
    let hostname = '';
    try { hostname = new URL(bookmark.url).hostname; } catch { /* empty */ }
    const faviconSrcs = [];
    if (bookmark.favicon_url) faviconSrcs.push(`/api/v1/linkding/favicon?url=${encodeURIComponent(bookmark.favicon_url)}`);
    if (hostname) faviconSrcs.push(`https://icons.duckduckgo.com/ip3/${hostname}.ico`);
    let faviconIdx = 0;
    const tryNextFavicon = () => {
      if (faviconIdx < faviconSrcs.length) { favicon.src = faviconSrcs[faviconIdx++]; }
      else { favicon.style.display = 'none'; }
    };
    favicon.addEventListener('error', tryNextFavicon);
    tryNextFavicon();

    const titleLink = document.createElement('a');
    titleLink.className = 'bm-title';
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
    urlEl.className = 'bm-url';
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
        tagBadge.className = 'bm-tag';
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

    // Actions (bottom row with SVG icons)
    const actionsEl = document.createElement('div');
    actionsEl.className = 'bm-actions';
    actionsEl.style.cssText = 'display:flex;gap:2px;align-items:center;cursor:default;border-top:1px solid var(--color-border);padding-top:8px;justify-content:flex-start';

    const btnBase = 'background:none;border:none;cursor:pointer;padding:5px 8px;border-radius:4px;transition:background 0.2s;display:inline-flex;align-items:center;justify-content:center;color:var(--color-text-secondary)';

    const readBtn = document.createElement('button');
    readBtn.style.cssText = btnBase;
    readBtn.innerHTML = bookmark.unread
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
    readBtn.title = bookmark.unread ? 'Mark read' : 'Mark unread';
    readBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await toggleBookmarkReadStatus(container, bookmark.id, bookmark.unread);
    });
    readBtn.addEventListener('mouseover', () => { readBtn.style.background = 'var(--color-primary-muted, rgba(99,102,241,0.15))'; });
    readBtn.addEventListener('mouseout', () => { readBtn.style.background = 'none'; });

    const archiveBtn = document.createElement('button');
    archiveBtn.style.cssText = btnBase;
    archiveBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>`;
    archiveBtn.title = bookmark.archived ? 'Unarchive' : 'Archive';
    archiveBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await toggleBookmarkArchive(container, bookmark.id, bookmark.archived);
    });
    archiveBtn.addEventListener('mouseover', () => { archiveBtn.style.background = 'var(--color-primary-muted, rgba(99,102,241,0.15))'; });
    archiveBtn.addEventListener('mouseout', () => { archiveBtn.style.background = 'none'; });

    const editBtn = document.createElement('button');
    editBtn.style.cssText = btnBase;
    editBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    editBtn.title = 'Edit';
    editBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await showEditBookmarkModal(container, bookmark);
    });
    editBtn.addEventListener('mouseover', () => { editBtn.style.background = 'var(--color-primary-muted, rgba(99,102,241,0.15))'; });
    editBtn.addEventListener('mouseout', () => { editBtn.style.background = 'none'; });

    const deleteBtn = document.createElement('button');
    deleteBtn.style.cssText = btnBase + ';color:var(--color-danger)';
    deleteBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
    deleteBtn.title = 'Delete';
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteBookmark(container, bookmark.id);
    });
    deleteBtn.addEventListener('mouseover', () => { deleteBtn.style.background = 'rgba(var(--color-danger-rgb, 239,68,68), 0.15)'; });
    deleteBtn.addEventListener('mouseout', () => { deleteBtn.style.background = 'none'; });

    actionsEl.appendChild(readBtn);
    actionsEl.appendChild(archiveBtn);
    actionsEl.appendChild(editBtn);
    actionsEl.appendChild(deleteBtn);

    if (bulkEditMode && checkboxEl) {
      const topRow = document.createElement('div');
      topRow.style.cssText = 'display:flex;gap:12px;align-items:start';
      topRow.appendChild(checkboxEl);
      topRow.appendChild(contentEl);
      card.appendChild(topRow);
    } else {
      card.appendChild(contentEl);
    }
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

  if (!bulkEditMode) {
    toolbar.style.display = 'none';
    return;
  }

  toolbar.style.display = 'flex';
  countEl.textContent = bulkSelected.size === 0 ? 'No selection' : `${bulkSelected.size} selected`;
}

function buildBookmarklet() {
  const origin = window.location.origin;
  return `javascript:(()=>{const o=${JSON.stringify(origin)};const u=location.href;const t=(document.title||'').trim();const s=(window.getSelection&&window.getSelection().toString?window.getSelection().toString().trim():'');const q=new URLSearchParams({bookmarklet:'1',url:u,title:t,description:s,unread:'1'});const target=o+'/bookmarks?'+q.toString();const w=window.open(target,'_blank','noopener,noreferrer');if(!w)location.href=target;})();`;
}

async function copyBookmarklet() {
  const code = buildBookmarklet();
  try {
    await navigator.clipboard.writeText(code);
    window.planium?.showToast('Bookmarklet copied', 'success');
  } catch {
    window.prompt('Copy the bookmarklet below', code);
  }
}

function normalizeBookmarkUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed).toString();
  } catch {
    if (/^[a-z0-9.-]+\.[a-z]{2,}(?:[/?#].*)?$/i.test(trimmed)) {
      try {
        return new URL(`https://${trimmed}`).toString();
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
}

function openNewBookmarkModal(container, prefill = {}) {
  const bookmarkletCode = buildBookmarklet();
  const content = `
    <form id="bookmark-create-form" class="bookmarks-save-form" style="display:grid;gap:var(--space-3)">
      <div style="display:grid;gap:var(--space-2)">
        <label style="display:grid;gap:4px">
          <span style="font-size:12px;font-weight:600;color:var(--color-text-secondary)">URL</span>
          <input id="bookmark-create-url" class="form-input" type="url" placeholder="https://example.com" value="${esc(prefill.url || '')}" style="width:100%;padding:8px 10px;font-size:14px" />
        </label>
        <label style="display:grid;gap:4px">
          <span style="font-size:12px;font-weight:600;color:var(--color-text-secondary)">Title</span>
          <input id="bookmark-create-title" class="form-input" type="text" placeholder="Optional title" value="${esc(prefill.title || '')}" style="width:100%;padding:8px 10px;font-size:14px" />
        </label>
        <label style="display:grid;gap:4px">
          <span style="font-size:12px;font-weight:600;color:var(--color-text-secondary)">Description</span>
          <textarea id="bookmark-create-description" class="form-input" placeholder="Optional notes" style="width:100%;padding:8px 10px;font-size:14px;min-height:96px;resize:vertical;font-family:inherit">${esc(prefill.description || '')}</textarea>
        </label>
        <label style="display:grid;gap:4px">
          <span style="font-size:12px;font-weight:600;color:var(--color-text-secondary)">Tags</span>
          <input id="bookmark-create-tags" class="form-input" type="text" placeholder="comma-separated tags" value="${esc((prefill.tags || []).join(', '))}" style="width:100%;padding:8px 10px;font-size:14px" />
        </label>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--color-text-secondary)">
          <input id="bookmark-create-unread" type="checkbox"${prefill.unread !== false ? ' checked' : ''} />
          Save as unread
        </label>
      </div>
      <div style="padding:var(--space-2);border:1px solid var(--color-border);border-radius:8px;background:var(--color-bg);display:grid;gap:8px">
        <div style="font-size:12px;font-weight:600;color:var(--color-text-secondary)">Bookmarklet</div>
        <input id="bookmark-create-bookmarklet" class="form-input" type="text" readonly value="${esc(bookmarkletCode)}" style="width:100%;padding:8px 10px;font-size:12px;font-family:monospace" />
        <button type="button" id="bookmark-create-copy-bookmarklet" class="btn btn--secondary" style="justify-self:start;padding:6px 10px;font-size:12px">Copy bookmarklet</button>
        <div style="font-size:12px;color:var(--color-text-secondary)">Save this bookmarklet in your browser, then click it on any page to prefill Planium with the page URL and title.</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2)">
        <button type="button" id="bookmark-create-cancel" class="btn btn--secondary" style="padding:8px 12px;font-size:14px">Cancel</button>
        <button type="submit" id="bookmark-create-save" class="btn btn--primary" style="padding:8px 12px;font-size:14px;background:var(--color-primary);color:var(--color-text-inverse);border:none;border-radius:4px;cursor:pointer">Save</button>
      </div>
    </form>
  `;

  openModal({
    title: 'Save bookmark',
    content,
    size: 'md',
    onSave: (panel) => {
      const form = panel.querySelector('#bookmark-create-form');
      const urlInput = panel.querySelector('#bookmark-create-url');
      const titleInput = panel.querySelector('#bookmark-create-title');
      const descriptionInput = panel.querySelector('#bookmark-create-description');
      const tagsInput = panel.querySelector('#bookmark-create-tags');
      const unreadInput = panel.querySelector('#bookmark-create-unread');
      const cancelBtn = panel.querySelector('#bookmark-create-cancel');
      const copyBtn = panel.querySelector('#bookmark-create-copy-bookmarklet');
      const saveBtn = panel.querySelector('#bookmark-create-save');

      const focusTitle = () => {
        if (prefill.title) {
          titleInput.focus();
          titleInput.select();
        } else {
          urlInput.focus();
          urlInput.select();
        }
      };
      setTimeout(focusTitle, 75);

      copyBtn?.addEventListener('click', copyBookmarklet);
      cancelBtn?.addEventListener('click', () => closeModal());

      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!saveBtn || saveBtn.disabled) return;
        saveBtn.disabled = true;
        const oldText = saveBtn.textContent;
        saveBtn.textContent = 'Saving...';

        try {
          const url = normalizeBookmarkUrl(urlInput.value);
          if (!url) {
            throw new Error('URL is required');
          }
          const parsed = new URL(url);
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error('URL must use http or https');
          }

          const tag_names = tagsInput.value
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean);

          await api.post('/linkding/bookmarks', {
            url,
            title: titleInput.value.trim(),
            description: descriptionInput.value.trim(),
            tag_names,
            unread: unreadInput.checked,
          });

          window.planium?.showToast('Bookmark saved', 'success');
          closeModal();
          await loadBookmarks(container);
          await loadTags(container);
        } catch (err) {
          window.planium?.showToast(err.message || 'Failed to save bookmark', 'danger');
          saveBtn.disabled = false;
          saveBtn.textContent = oldText || 'Save';
        }
      });
    },
  });
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

async function showEditBookmarkModal(container, bookmark) {
  // Create modal overlay
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  `;

  // Modal content
  const modalContent = document.createElement('div');
  modalContent.style.cssText = `
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: var(--space-3);
    max-width: 600px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  `;

  modalContent.innerHTML = `
    <h2 style="margin:0 0 var(--space-2) 0;font-size:18px;font-weight:600">Edit Bookmark</h2>

    <div style="display:grid;gap:var(--space-2)">
      <div>
        <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;color:var(--color-text-secondary)">URL</label>
        <input type="text" id="edit-url" class="form-input" style="width:100%;padding:8px 10px;font-size:14px" value="${esc(bookmark.url)}" />
      </div>

      <div>
        <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;color:var(--color-text-secondary)">Title</label>
        <input type="text" id="edit-title" class="form-input" style="width:100%;padding:8px 10px;font-size:14px" value="${esc(bookmark.title || '')}" />
      </div>

      <div>
        <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;color:var(--color-text-secondary)">Description</label>
        <textarea id="edit-description" class="form-input" style="width:100%;padding:8px 10px;font-size:14px;min-height:80px;resize:vertical;font-family:inherit">${esc(bookmark.description || '')}</textarea>
      </div>

      <div>
        <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;color:var(--color-text-secondary)">Tags (comma-separated)</label>
        <input type="text" id="edit-tags" class="form-input" style="width:100%;padding:8px 10px;font-size:14px" value="${esc((bookmark.tag_names || []).join(', '))}" placeholder="e.g. python, javascript, tutorial" />
        <div id="tag-suggestions" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;max-height:100px;overflow-y:auto"></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2);margin-top:var(--space-2)">
        <button id="edit-cancel" class="btn btn--secondary" style="padding:8px 12px;font-size:14px">Cancel</button>
        <button id="edit-save" class="btn btn--primary" style="padding:8px 12px;font-size:14px;background:var(--color-primary);color:var(--color-text-inverse);border:none;border-radius:4px;cursor:pointer">Save</button>
      </div>
    </div>
  `;

  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  // Elements
  const urlInput = modalContent.querySelector('#edit-url');
  const titleInput = modalContent.querySelector('#edit-title');
  const descriptionInput = modalContent.querySelector('#edit-description');
  const tagsInput = modalContent.querySelector('#edit-tags');
  const tagSuggestions = modalContent.querySelector('#tag-suggestions');
  const cancelBtn = modalContent.querySelector('#edit-cancel');
  const saveBtn = modalContent.querySelector('#edit-save');

  // Populate tag suggestions
  function updateTagSuggestions() {
    const inputTags = tagsInput.value.split(',').map(t => t.trim().toLowerCase());
    const availableTags = allTags.filter(t => !inputTags.includes(t.name.toLowerCase()));

    tagSuggestions.innerHTML = '';
    availableTags.slice(0, 10).forEach(tag => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.style.cssText = `
        padding: 4px 8px;
        background: var(--color-primary);
        color: var(--color-text-inverse);
        border: none;
        border-radius: 3px;
        font-size: 12px;
        cursor: pointer;
        white-space: nowrap;
      `;
      chip.textContent = tag.name;
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        const current = tagsInput.value.trim();
        tagsInput.value = current ? `${current}, ${tag.name}` : tag.name;
        updateTagSuggestions();
      });
      tagSuggestions.appendChild(chip);
    });
  }

  tagsInput.addEventListener('input', updateTagSuggestions);
  updateTagSuggestions();

  // Cancel button
  cancelBtn.addEventListener('click', () => {
    modal.remove();
  });

  // Save button
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      const url = urlInput.value.trim();
      if (!url) {
        window.planium?.showToast('URL is required', 'danger');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
        return;
      }

      const updateData = {
        url,
        title: titleInput.value.trim(),
        description: descriptionInput.value.trim(),
        tag_names: tagsInput.value
          .split(',')
          .map(t => t.trim())
          .filter(t => t.length > 0),
      };

      await api.patch(`/linkding/bookmarks/${bookmark.id}`, updateData);
      window.planium?.showToast('Bookmark updated', 'default');
      modal.remove();
      await loadBookmarks(container);
    } catch (err) {
      window.planium?.showToast(err.message || 'Failed to update bookmark', 'danger');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  });

  // Close modal on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });

  // Focus on URL input
  urlInput.focus();
  urlInput.select();
}

function showTagFilterModal(container) {
  const existing = document.getElementById('tag-filter-modal');
  if (existing) return;

  const modal = document.createElement('div');
  modal.id = 'tag-filter-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:500;display:flex;flex-direction:column;justify-content:flex-end';

  const sheet = document.createElement('div');
  sheet.style.cssText = 'background:var(--color-surface);border-radius:16px 16px 0 0;max-height:80vh;display:flex;flex-direction:column;overflow:hidden';

  function renderSheet() {
    const searchVal = sheet.querySelector('#tag-modal-search')?.value || '';

    sheet.innerHTML = `
      <div style="padding:16px;border-bottom:1px solid var(--color-border);flex-shrink:0">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <h2 style="margin:0;font-size:16px;font-weight:600">Filter by Tags</h2>
          <div style="display:flex;gap:8px;align-items:center">
            ${currentTags.length > 0 ? `<button id="tag-modal-clear" class="btn btn--secondary" style="padding:5px 12px;font-size:13px">Clear</button>` : ''}
            <button id="tag-modal-done" class="btn btn--primary" style="padding:5px 16px;font-size:14px">Done</button>
          </div>
        </div>
        ${currentTags.length > 0 ? `
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">
            ${currentTags.map(tag => `
              <div style="display:inline-flex;align-items:center;gap:4px;background:var(--color-primary);color:var(--color-text-inverse);padding:5px 10px;border-radius:20px;font-size:13px;font-weight:500">
                <span>${esc(tag)}</span>
                <button data-remove="${esc(tag)}" style="background:none;border:none;color:inherit;cursor:pointer;padding:0 0 0 2px;font-size:17px;line-height:1">×</button>
              </div>
            `).join('')}
          </div>
        ` : ''}
        <input id="tag-modal-search" type="text" class="form-input" placeholder="Search tags…" style="width:100%;padding:8px 12px;font-size:14px" value="${esc(searchVal)}" />
      </div>
      <div id="tag-modal-list" style="flex:1;overflow-y:auto;padding:12px"></div>
    `;

    sheet.querySelector('#tag-modal-done').addEventListener('click', closeModal);
    sheet.querySelector('#tag-modal-clear')?.addEventListener('click', () => {
      currentTags = [];
      currentOffset = 0;
      saveFiltersToStorage();
      updateActiveFiltersToolbar(container);
      loadBookmarks(container);
      renderSheet();
    });
    sheet.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        toggleTag(btn.dataset.remove, container);
        renderSheet();
      });
    });

    const searchInput = sheet.querySelector('#tag-modal-search');
    searchInput.addEventListener('input', () => renderTagList(searchInput.value));
    searchInput.focus();

    renderTagList(searchVal);
  }

  function renderTagList(searchTerm) {
    const listEl = sheet.querySelector('#tag-modal-list');
    if (!listEl) return;

    let tagsToShow = currentTags.length === 0 ? [...allTags] : [...filteredTags];
    if (searchTerm) {
      tagsToShow = tagsToShow.filter(t => (t.name || '').toLowerCase().includes(searchTerm.toLowerCase()));
    }

    const sorted = tagsToShow.sort((a, b) => {
      if (tagSortMode === 'count') {
        if (b.count !== a.count) return b.count - a.count;
      }
      return (a.name || '').localeCompare(b.name || '');
    });

    listEl.innerHTML = '';
    if (sorted.length === 0) {
      listEl.innerHTML = '<p style="color:var(--color-text-secondary);font-size:14px;text-align:center;padding:20px">No tags found</p>';
      return;
    }

    sorted.forEach(tag => {
      if (!tag.name) return;
      const isActive = currentTags.includes(tag.name);
      const btn = document.createElement('button');
      btn.style.cssText = `display:flex;width:100%;text-align:left;padding:10px 12px;margin-bottom:4px;border:1px solid ${isActive ? 'var(--color-primary)' : 'var(--color-border)'};background:${isActive ? 'var(--color-primary)' : 'var(--color-surface)'};color:${isActive ? 'var(--color-text-inverse)' : 'var(--color-text)'};border-radius:8px;cursor:pointer;font-size:14px;font-weight:500;align-items:center;justify-content:space-between`;
      btn.innerHTML = `<span>${esc(tag.name)}</span><span style="font-size:12px;opacity:0.6">${tag.count || 0}</span>`;
      btn.addEventListener('click', () => {
        toggleTag(tag.name, container);
        renderSheet();
      });
      listEl.appendChild(btn);
    });
  }

  function closeModal() {
    modal.remove();
    tagModalRefresh = null;
  }

  tagModalRefresh = renderSheet;
  renderSheet();
  modal.appendChild(sheet);
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
}

function bindEvents(container) {
  const addBookmarkFab = container.querySelector('#bookmarks-add-fab');
  const searchInput = container.querySelector('#bookmarks-search');
  const tagsSearchInput = container.querySelector('#tags-search');
  const filterSelect = container.querySelector('#bookmarks-filter');
  const perPageSelect = container.querySelector('#bookmarks-per-page');
  const sidebarClearBtn = container.querySelector('#sidebar-clear-filters');
  const sidebarSortBtn = container.querySelector('#sidebar-sort-toggle');
  const bulkToggleBtn = container.querySelector('#bookmarks-bulk-toggle');
  const bulkSelectAllBtn = container.querySelector('#bulk-select-all');
  const bulkUnselectAllBtn = container.querySelector('#bulk-unselect-all');
  const bulkMarkReadBtn = container.querySelector('#bulk-mark-read');
  const bulkMarkUnreadBtn = container.querySelector('#bulk-mark-unread');
  const bulkArchiveBtn = container.querySelector('#bulk-archive');
  const bulkDeleteBtn = container.querySelector('#bulk-delete');
  const bulkClearBtn = container.querySelector('#bulk-clear');
  const mobileTagFilterBtn = container.querySelector('#mobile-tag-filter-btn');

  addBookmarkFab?.addEventListener('click', () => openNewBookmarkModal(container));
  mobileTagFilterBtn?.addEventListener('click', () => showTagFilterModal(container));

  searchInput?.addEventListener('input', (e) => {
    currentSearch = e.target.value.trim();
    currentOffset = 0;
    saveFiltersToStorage();
    loadBookmarks(container);
  });

  tagsSearchInput?.addEventListener('input', () => {
    renderTagsSidebar(container);
  });

  filterSelect?.addEventListener('change', (e) => {
    currentStatusFilter = e.target.value;
    currentOffset = 0;
    saveFiltersToStorage();
    loadBookmarks(container);
  });

  perPageSelect?.addEventListener('change', (e) => {
    currentLimit = parseInt(e.target.value, 10);
    currentOffset = 0;
    saveFiltersToStorage();
    loadBookmarks(container);
  });

  sidebarClearBtn?.addEventListener('click', () => {
    currentSearch = '';
    currentTags = [];
    currentStatusFilter = 'all';
    currentOffset = 0;
    currentLimit = 50;
    bulkSelected.clear();
    bulkEditMode = false;
    saveFiltersToStorage();

    // Reset input values
    if (searchInput) searchInput.value = '';
    if (filterSelect) filterSelect.value = 'all';
    if (perPageSelect) perPageSelect.value = '50';
    if (tagsSearchInput) tagsSearchInput.value = '';
    const bulkToggle = container.querySelector('#bookmarks-bulk-toggle');
    if (bulkToggle) {
      bulkToggle.style.background = '';
      bulkToggle.style.color = '';
    }

    updateActiveFiltersToolbar(container);
    updateBulkToolbar(container);
    renderBookmarks(container);
    loadTags(container);
    loadBookmarks(container);
  });

  // Set initial sort button text
  if (sidebarSortBtn) {
    const sortLabel = tagSortMode === 'alpha' ? 'A-Z' : 'Count';
    sidebarSortBtn.textContent = `Sort: ${sortLabel}`;
  }

  sidebarSortBtn?.addEventListener('click', () => {
    // Toggle between alphabetical and count sorting
    tagSortMode = tagSortMode === 'alpha' ? 'count' : 'alpha';
    localStorage.setItem(TAG_SORT_STORAGE_KEY, tagSortMode);

    // Update button text
    const sortLabel = tagSortMode === 'alpha' ? 'A-Z' : 'Count';
    sidebarSortBtn.textContent = `Sort: ${sortLabel}`;

    // Re-render sidebar with new sort order
    renderTagsSidebar(container);
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
