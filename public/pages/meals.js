/**
 * Modul: Recipes (Mealie Integration)
 * Zweck: Browse recipes from a self-hosted Mealie instance via proxy API
 * Abhängigkeiten: /api.js, /router.js (window.planner)
 */

import { api } from '/api.js';
import { openModal as openSharedModal, closeModal } from '/components/modal.js';
import { stagger } from '/utils/ux.js';
import { t } from '/i18n.js';
import { esc } from '/utils/html.js';

// --------------------------------------------------------
// State
// --------------------------------------------------------

let state = {
  configured:     false,
  mealieUrl:      null,
  recipes:        [],
  search:         '',
  loading:        false,
  activeCategory: null, // null = All
};

let _container   = null;
let _searchTimer = null;
let _gridWired   = false;
let _tabsWired   = false;

// --------------------------------------------------------
// Helpers
// --------------------------------------------------------

function catSlug(key) {
  if (key === '__uncategorized__') return 'uncategorized';
  return key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/, '');
}

function buildGroups(recipes = state.recipes) {
  const groups = new Map();
  for (const recipe of recipes) {
    const name = recipe.recipeCategory?.[0]?.name ?? null;
    const key  = name ?? '__uncategorized__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(recipe);
  }
  return new Map(
    [...groups.entries()].sort(([a], [b]) => {
      if (a === '__uncategorized__') return 1;
      if (b === '__uncategorized__') return -1;
      return a.localeCompare(b);
    })
  );
}

// --------------------------------------------------------
// API helpers
// --------------------------------------------------------

async function checkStatus() {
  try {
    const res = await api.get('/mealie/status');
    state.configured = res.configured ?? false;
    state.mealieUrl  = res.url ?? null;
  } catch {
    state.configured = false;
    state.mealieUrl  = null;
  }
}

async function loadAllRecipes() {
  if (!state.configured || state.loading) return;
  state.loading = true;
  state.recipes = [];

  // Show loading state immediately
  const grid = _container?.querySelector('#recipes-grid');
  if (grid) grid.innerHTML = `<div class="recipes-loading">${t('mealie.loadingIndicator')}</div>`;

  try {
    let page = 1;
    const perPage = 200;
    while (true) {
      const res = await api.get(
        `/mealie/recipes?page=${page}&perPage=${perPage}` +
        (state.search ? `&search=${encodeURIComponent(state.search)}` : '')
      );
      const items = res.items ?? [];
      const total = res.total ?? 0;
      state.recipes = [...state.recipes, ...items];
      if (state.recipes.length >= total || items.length === 0) break;
      page++;
    }
  } catch (err) {
    const code = err?.data?.code ?? err?.status;
    const msg  = (code === 401 || code === 502)
      ? t('mealie.connectionError')
      : t('mealie.loadError');
    window.planner?.showToast(msg, 'danger');
  } finally {
    state.loading = false;
    renderGrid();
    renderCategoryTabs();
  }
}

async function loadRecipeDetail(slug) {
  try {
    return await api.get(`/mealie/recipes/${encodeURIComponent(slug)}`);
  } catch {
    window.planner?.showToast(t('mealie.loadError'), 'danger');
    return null;
  }
}

// --------------------------------------------------------
// Render
// --------------------------------------------------------

export async function render(container, { user }) {
  _container = container;
  _gridWired = false;
  state.recipes        = [];
  state.search         = '';
  state.loading        = false;
  state.activeCategory = null;
  _gridWired           = false;
  _tabsWired           = false;

  container.innerHTML = `
    <div class="meals-page">
      <h1 class="sr-only">${t('mealie.title')}</h1>
      <div class="recipes-header" id="recipes-header">
        <div class="recipes-toolbar">
          <div class="recipes-search-wrap">
            <i data-lucide="search" class="recipes-search-icon" aria-hidden="true"></i>
            <input
              type="search"
              id="recipes-search"
              class="recipes-search"
              placeholder="${t('mealie.searchPlaceholder')}"
              value=""
              autocomplete="off"
            />
          </div>
        </div>
        <div class="recipes-category-tabs" id="recipes-category-tabs" hidden></div>
      </div>
      <div class="recipes-grid" id="recipes-grid">
        <div class="recipes-loading">${t('mealie.loadingIndicator')}</div>
      </div>
    </div>
  `;

  if (window.lucide) lucide.createIcons();

  await checkStatus();

  if (!state.configured) {
    renderNotConfigured();
    return;
  }

  await loadAllRecipes();
  wireSearch();
}

function renderNotConfigured() {
  const grid = _container.querySelector('#recipes-grid');
  if (!grid) return;
  grid.innerHTML = `
    <div class="recipes-empty-state">
      <i data-lucide="chef-hat" class="recipes-empty-state__icon" aria-hidden="true"></i>
      <h2 class="recipes-empty-state__title">${t('mealie.notConfiguredTitle')}</h2>
      <p class="recipes-empty-state__desc">${t('mealie.notConfiguredDesc')}</p>
      <button class="btn btn--primary" id="go-to-settings">${t('mealie.goToSettings')}</button>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
  _container.querySelector('#go-to-settings')?.addEventListener('click', () => {
    window.planner?.navigate('/settings');
  });
}

function renderGrid() {
  const grid = _container.querySelector('#recipes-grid');
  if (!grid) return;

  // Filter by active category when not "All"
  const visible = state.activeCategory === null
    ? state.recipes
    : state.recipes.filter((r) => {
        const cat = r.recipeCategory?.[0]?.name ?? '__uncategorized__';
        return cat === state.activeCategory;
      });

  if (visible.length === 0) {
    grid.innerHTML = `
      <div class="recipes-empty-state">
        <i data-lucide="search-x" class="recipes-empty-state__icon" aria-hidden="true"></i>
        <p class="recipes-empty-state__desc">${t('mealie.noResults')}</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  if (state.activeCategory === null) {
    renderGroupedGrid(grid, visible);
  } else {
    grid.innerHTML = visible.map(recipeCardHTML).join('');
  }

  if (window.lucide) lucide.createIcons();
  stagger(grid.querySelectorAll('.recipe-card'));
  if (!_gridWired) { wireCards(grid); _gridWired = true; }
}

function renderGroupedGrid(grid, recipes) {
  const groups = buildGroups(recipes);
  const html   = [...groups.entries()].map(([key, items]) => {
    const label = key === '__uncategorized__' ? t('mealie.uncategorized') : esc(key);
    const cards = items.map(recipeCardHTML).join('');
    return `
      <div class="recipes-category-header" role="heading" aria-level="2">${label}</div>
      ${cards}
    `;
  }).join('');
  grid.innerHTML = html;
}

function renderCategoryTabs() {
  const tabsEl = _container?.querySelector('#recipes-category-tabs');
  if (!tabsEl) return;

  if (state.recipes.length === 0) { tabsEl.hidden = true; return; }

  const groups = buildGroups();
  if (groups.size === 0) { tabsEl.hidden = true; return; }

  tabsEl.hidden = false;

  const allTab = `<button class="recipes-cat-tab" data-key="__all__">${t('mealie.allCategories')}</button>`;

  const catTabs = [...groups.keys()].map((key) => {
    const label = key === '__uncategorized__' ? t('mealie.uncategorized') : esc(key);
    return `<button class="recipes-cat-tab" data-key="${esc(key)}">${label}</button>`;
  }).join('');

  tabsEl.innerHTML = allTab + catTabs;

  // Mark active tab
  updateActiveTab(tabsEl);

  // Wire once — event delegation survives innerHTML replacement
  if (!_tabsWired) {
    wireTabs(tabsEl);
    _tabsWired = true;
  }
}

function updateActiveTab(tabsEl) {
  tabsEl.querySelectorAll('.recipes-cat-tab').forEach((tab) => {
    const isActive = tab.dataset.key === '__all__'
      ? state.activeCategory === null
      : tab.dataset.key === state.activeCategory;
    tab.classList.toggle('is-active', isActive);
  });
}

function recipeCardHTML(recipe) {
  const imgUrl = recipe.image && state.mealieUrl
    ? `${state.mealieUrl}/api/media/recipes/${recipe.id}/images/min-original.webp`
    : null;

  const totalTime = recipe.totalTime ?? recipe.prepTime ?? null;

  return `
    <div class="recipe-card" data-slug="${esc(recipe.slug)}" role="button" tabindex="0"
         aria-label="${esc(recipe.name)}">
      <div class="recipe-card__image-wrap">
        ${imgUrl
          ? `<img class="recipe-card__image" src="${esc(imgUrl)}" alt="" loading="lazy" decoding="async">`
          : `<div class="recipe-card__image-placeholder"><i data-lucide="utensils" aria-hidden="true"></i></div>`
        }
      </div>
      <div class="recipe-card__body">
        <div class="recipe-card__name">${esc(recipe.name)}</div>
        ${totalTime ? `<div class="recipe-card__time"><i data-lucide="clock" style="width:12px;height:12px" aria-hidden="true"></i> ${esc(totalTime)}</div>` : ''}
      </div>
    </div>
  `;
}

// --------------------------------------------------------
// Recipe detail modal
// --------------------------------------------------------

async function openRecipeModal(slug) {
  const recipe = await loadRecipeDetail(slug);
  if (!recipe) return;

  const recipeUrl = state.mealieUrl ? `${state.mealieUrl}/g/home/r/${slug}` : null;
  const imgUrl    = recipe.image && state.mealieUrl
    ? `${state.mealieUrl}/api/media/recipes/${recipe.id}/images/original.webp`
    : null;

  const ingredients  = recipe.recipeIngredient ?? [];
  const instructions = recipe.recipeInstructions ?? [];

  const ingHTML = ingredients.length
    ? `<ul class="recipe-detail__list">${ingredients.map((i) => {
        const note = i.note ? ` – ${esc(i.note)}` : '';
        const qty  = i.quantity ? `${esc(String(i.quantity))} ` : '';
        const unit = i.unit?.name ? `${esc(i.unit.name)} ` : '';
        return `<li>${qty}${unit}${esc(i.food?.name ?? i.display ?? '')}${note}</li>`;
      }).join('')}</ul>`
    : `<p class="recipe-detail__empty">${t('mealie.noIngredients')}</p>`;

  const stepsHTML = instructions.length
    ? `<ol class="recipe-detail__steps">${instructions.map((s) =>
        `<li>${esc(s.text ?? '')}</li>`
      ).join('')}</ol>`
    : `<p class="recipe-detail__empty">${t('mealie.noInstructions')}</p>`;

  const timeMeta = [
    recipe.prepTime  ? `<span><strong>${t('mealie.prepTime')}:</strong> ${esc(recipe.prepTime)}</span>`  : '',
    recipe.cookTime  ? `<span><strong>${t('mealie.cookTime')}:</strong> ${esc(recipe.cookTime)}</span>`  : '',
    recipe.totalTime ? `<span><strong>${t('mealie.totalTime')}:</strong> ${esc(recipe.totalTime)}</span>` : '',
    recipe.recipeYield ? `<span><strong>${t('mealie.servings')}:</strong> ${esc(String(recipe.recipeYield))}</span>` : '',
  ].filter(Boolean).join('');

  const content = `
    ${imgUrl ? `<img class="recipe-detail__hero" src="${esc(imgUrl)}" alt="" loading="lazy">` : ''}
    ${recipe.description ? `<p class="recipe-detail__desc">${esc(recipe.description)}</p>` : ''}
    ${timeMeta ? `<div class="recipe-detail__meta">${timeMeta}</div>` : ''}
    <h3 class="recipe-detail__section-title">${t('mealie.ingredients')}</h3>
    ${ingHTML}
    <h3 class="recipe-detail__section-title">${t('mealie.instructions')}</h3>
    ${stepsHTML}
    <div class="modal-panel__footer" style="border:none;padding:0;margin-top:var(--space-4);display:flex;gap:var(--space-2);justify-content:flex-end">
      ${recipeUrl ? `<a class="btn btn--secondary" href="${esc(recipeUrl)}" target="_blank" rel="noopener noreferrer">${t('mealie.openInMealie')}</a>` : ''}
      <button class="btn btn--primary" id="recipe-modal-close">${t('common.close')}</button>
    </div>
  `;

  openSharedModal({
    title:   esc(recipe.name),
    content,
    size:    'lg',
    onSave(panel) {
      panel.querySelector('#recipe-modal-close')?.addEventListener('click', () => closeModal());
    },
  });

  if (window.lucide) lucide.createIcons();
}

// --------------------------------------------------------
// Event wiring
// --------------------------------------------------------

function wireSearch() {
  const input = _container.querySelector('#recipes-search');
  if (!input) return;
  input.addEventListener('input', () => {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(async () => {
      state.search = input.value.trim();
      await loadAllRecipes();
    }, 400);
  });
}

function wireTabs(tabsEl) {
  tabsEl.addEventListener('click', (e) => {
    const tab = e.target.closest('.recipes-cat-tab');
    if (!tab) return;

    state.activeCategory = tab.dataset.key === '__all__' ? null : tab.dataset.key;

    updateActiveTab(tabsEl);

    const scroller = document.getElementById('main-content');
    if (scroller) scroller.scrollTo({ top: 0, behavior: 'smooth' });

    renderGrid();
  });
}

function wireCards(grid) {
  grid.addEventListener('click', async (e) => {
    const card = e.target.closest('.recipe-card');
    if (!card) return;
    await openRecipeModal(card.dataset.slug);
  });

  grid.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const card = e.target.closest('.recipe-card');
      if (card) { e.preventDefault(); await openRecipeModal(card.dataset.slug); }
    }
  });
}
