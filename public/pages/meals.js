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
  configured: false,
  mealieUrl:  null,
  recipes:    [],
  page:       1,
  total:      0,
  perPage:    32,
  search:     '',
  loading:    false,
  grouped:    false,
};

let _container   = null;
let _searchTimer = null;
let _gridWired   = false;

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

async function loadRecipes(reset = false) {
  if (!state.configured) return;
  if (state.loading) return;

  if (reset) {
    state.page    = 1;
    state.recipes = [];
  }

  state.loading = true;
  updateLoadMoreBtn();

  try {
    const res = await api.get(
      `/mealie/recipes?page=${state.page}&perPage=${state.perPage}` +
      (state.search ? `&search=${encodeURIComponent(state.search)}` : '')
    );
    const items = res.items ?? [];
    state.total   = res.total ?? 0;
    state.recipes = reset ? items : [...state.recipes, ...items];
    renderGrid();
  } catch (err) {
    const code = err?.data?.code ?? err?.status;
    const msg  = (code === 401 || code === 502)
      ? t('mealie.connectionError')
      : t('mealie.loadError');
    window.planner?.showToast(msg, 'danger');
  } finally {
    state.loading = false;
    updateLoadMoreBtn();
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
  state.recipes = [];
  state.page    = 1;
  state.total   = 0;
  state.search  = '';
  state.loading = false;

  container.innerHTML = `
    <div class="meals-page">
      <h1 class="sr-only">${t('mealie.title')}</h1>
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
        <button
          id="recipes-group-toggle"
          class="btn btn--ghost recipes-group-toggle${state.grouped ? ' is-active' : ''}"
          title="${t('mealie.groupByCategory')}"
          aria-pressed="${state.grouped}"
        >
          <i data-lucide="layout-list" aria-hidden="true"></i>
        </button>
      </div>
      <div class="recipes-grid" id="recipes-grid">
        <div class="recipes-loading">${t('mealie.loadingIndicator')}</div>
      </div>
      <div class="recipes-footer" id="recipes-footer" hidden>
        <button class="btn btn--secondary" id="recipes-load-more">${t('mealie.loadMoreBtn')}</button>
      </div>
    </div>
  `;

  if (window.lucide) lucide.createIcons();

  await checkStatus();

  if (!state.configured) {
    renderNotConfigured();
    return;
  }

  await loadRecipes(true);
  wireSearch();
  wireLoadMore();
  wireGroupToggle();
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

  if (state.recipes.length === 0) {
    grid.innerHTML = `
      <div class="recipes-empty-state">
        <i data-lucide="search-x" class="recipes-empty-state__icon" aria-hidden="true"></i>
        <p class="recipes-empty-state__desc">${t('mealie.noResults')}</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    updateLoadMoreBtn();
    return;
  }

  if (state.grouped) {
    renderGroupedGrid(grid);
  } else {
    grid.innerHTML = state.recipes.map(recipeCardHTML).join('');
  }

  if (window.lucide) lucide.createIcons();
  stagger(grid.querySelectorAll('.recipe-card'));
  if (!_gridWired) { wireCards(grid); _gridWired = true; }
  updateLoadMoreBtn();
}

function renderGroupedGrid(grid) {
  const groups = new Map();

  for (const recipe of state.recipes) {
    const categoryName = recipe.recipeCategory?.[0]?.name ?? null;
    const key = categoryName ?? '__uncategorized__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(recipe);
  }

  // Sort category keys alphabetically, uncategorized last
  const sortedKeys = [...groups.keys()].sort((a, b) => {
    if (a === '__uncategorized__') return 1;
    if (b === '__uncategorized__') return -1;
    return a.localeCompare(b);
  });

  const html = sortedKeys.map((key) => {
    const label = key === '__uncategorized__' ? t('mealie.uncategorized') : esc(key);
    const cards = groups.get(key).map(recipeCardHTML).join('');
    return `
      <div class="recipes-category-header" role="heading" aria-level="2">${label}</div>
      ${cards}
    `;
  }).join('');

  grid.innerHTML = html;
}

function recipeCardHTML(recipe) {
  const imgUrl = recipe.image && state.mealieUrl
    ? `${state.mealieUrl}/api/media/recipes/${recipe.id}/images/min-original.webp`
    : null;

  const categories = (recipe.recipeCategory ?? []).map((c) => esc(c.name)).join(', ');
  const totalTime  = recipe.totalTime ?? recipe.prepTime ?? null;

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
        ${categories ? `<div class="recipe-card__meta">${categories}</div>` : ''}
        ${totalTime   ? `<div class="recipe-card__time"><i data-lucide="clock" style="width:12px;height:12px" aria-hidden="true"></i> ${esc(totalTime)}</div>` : ''}
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
      await loadRecipes(true);
    }, 300);
  });
}

function wireLoadMore() {
  const btn = _container.querySelector('#recipes-load-more');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    state.page++;
    await loadRecipes(false);
  });
}

function wireGroupToggle() {
  const btn = _container.querySelector('#recipes-group-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    state.grouped = !state.grouped;
    btn.classList.toggle('is-active', state.grouped);
    btn.setAttribute('aria-pressed', String(state.grouped));
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

function updateLoadMoreBtn() {
  const footer = _container?.querySelector('#recipes-footer');
  const btn    = _container?.querySelector('#recipes-load-more');
  if (!footer || !btn) return;

  const hasMore = state.recipes.length < state.total;
  footer.hidden = !state.configured || state.recipes.length === 0;

  if (state.loading) {
    btn.disabled    = true;
    btn.textContent = t('mealie.loadingIndicator');
  } else if (hasMore) {
    btn.disabled    = false;
    btn.textContent = t('mealie.loadMoreBtn');
  } else {
    btn.disabled    = true;
    btn.textContent = t('mealie.allLoaded');
  }
}
