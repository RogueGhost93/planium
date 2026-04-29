/**
 * Module: Client-Side Router
 * Purpose: SPA routing via History API without a framework, auth guard, page transitions
 * Dependencies: api.js
 */

import { auth, api } from '/api.js';
import { initI18n, getLocale, t } from '/i18n.js';
import { initNotifications, stopNotifications } from '/components/task-notifications.js';
import { init as initPTR } from '/utils/pullToRefresh.js';

// --------------------------------------------------------
// Route definitions
// Each route has: path, page (dynamically loaded), requiresAuth, module (for theme-color)
// --------------------------------------------------------
const ROUTES = [
  { path: '/setup',    page: '/pages/setup.js',    requiresAuth: false, module: null        },
  { path: '/login',    page: '/pages/login.js',    requiresAuth: false, module: null        },
  { path: '/',         page: '/pages/dashboard.js', requiresAuth: true, module: 'dashboard' },
  { path: '/tasks',    page: '/pages/tasks.js',     requiresAuth: true, module: 'tasks'     },
  { path: '/lists',    page: '/pages/lists.js',     requiresAuth: true, module: 'lists'     },
  { path: '/notes',    page: '/pages/notes.js',     requiresAuth: true, module: 'notes'     },
  { path: '/notebook', page: '/pages/notebook-v2.js', requiresAuth: true, module: 'notebook'  },
  { path: '/calendar', page: '/pages/calendar.js',  requiresAuth: true, module: 'calendar'  },
  { path: '/meals',    page: '/pages/meals.js',     requiresAuth: true, module: 'meals'     },
  { path: '/news',     page: '/pages/news.js',      requiresAuth: true, module: 'news'      },
  { path: '/web',      page: '/pages/webview.js',   requiresAuth: true, module: 'webview'   },
  { path: '/bookmarks', page: '/pages/bookmarks.js', requiresAuth: true, module: 'bookmarks' },
  { path: '/filebox',  page: '/pages/filebox.js',   requiresAuth: true, module: 'filebox'   },
  { path: '/contacts', page: '/pages/contacts.js',  requiresAuth: true, module: 'contacts'  },
  { path: '/budget',   page: '/pages/budget.js',    requiresAuth: true, module: 'budget'    },
  { path: '/settings',      page: '/pages/settings.js',      requiresAuth: true, module: 'settings'      },
  { path: '/share-picker',  page: '/pages/share-picker.js',  requiresAuth: true, module: null            },
];

// --------------------------------------------------------
// Standalone mode: dynamic theme-color adjustment
// Status bar colour reflects current page / modal state
// --------------------------------------------------------
const isStandalone = window.matchMedia('(display-mode: standalone)').matches
  || navigator.standalone === true;

/**
 * Sets the theme-color meta tags (light + dark variant).
 * @param {string} lightColor
 * @param {string} [darkColor] - If not provided, lightColor is used for both
 */
function setThemeColor(lightColor, darkColor) {
  if (!isStandalone) return;
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  if (metas.length >= 2) {
    metas[0].setAttribute('content', lightColor);
    metas[1].setAttribute('content', darkColor || lightColor);
  } else if (metas.length === 1) {
    metas[0].setAttribute('content', lightColor);
  }
}

/** Reads a CSS custom property from :root */
function getCSSToken(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Sets theme-color to match the current module */
function updateThemeColorForRoute(route) {
  if (!route?.module) {
    setThemeColor('#007AFF', '#1C1C1E');
    return;
  }
  const color = getCSSToken(`--module-${route.module}`);
  if (color) {
    setThemeColor(color, color);
  }
}

// --------------------------------------------------------
// All known accent IDs (must stay in sync with settings.js)
// --------------------------------------------------------
const ALL_ACCENTS = [
  'blue','indigo','violet','purple','pink','rose','red',
  'orange','amber','gold','lime','green','teal','cyan','sky','slate',
];

const NAV_ITEM_DEFS = [
  { path: '/',         labelKey: 'nav.dashboard', icon: 'layout-dashboard' },
  { path: '/tasks',    labelKey: 'nav.tasks',     icon: 'check-square'     },
  { path: '/lists',    labelKey: 'nav.lists',     icon: 'list-checks'      },
  { path: '/notes',    labelKey: 'nav.notes',     icon: 'sticky-note'      },
  { path: '/notebook', labelKey: 'nav.notebook',  icon: 'book-open'        },
  { path: '/calendar', labelKey: 'nav.calendar',  icon: 'calendar'         },
  { path: '/news',     labelKey: 'nav.news',      icon: 'newspaper', optional: true },
  { path: '/web',      labelKey: 'nav.web',       icon: 'globe',     optional: true },
  { path: '/bookmarks', label: 'Bookmarks',       icon: 'link',      optional: true },
  { path: '/filebox',  label: 'Filebox',          icon: 'folder',    optional: true },
  { path: '/meals',    labelKey: 'nav.meals',     icon: 'utensils'         },
  { path: '/contacts', labelKey: 'nav.contacts',  icon: 'book-user'        },
  { path: '/settings', labelKey: 'nav.settings',  icon: 'settings'         },
];
const NAV_PATHS = NAV_ITEM_DEFS.map((item) => item.path);

let currentNavOrder = NAV_PATHS.slice();

function normalizeNavOrder(value) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set();
  const order = [];

  for (const path of source) {
    if (!NAV_PATHS.includes(path) || seen.has(path)) continue;
    seen.add(path);
    order.push(path);
  }

  for (const path of NAV_PATHS) {
    if (seen.has(path)) continue;
    seen.add(path);
    order.push(path);
  }

  return order;
}

function parseNavOrder(value) {
  if (Array.isArray(value)) return normalizeNavOrder(value);
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return normalizeNavOrder(JSON.parse(value));
  } catch {
    return null;
  }
}

// --------------------------------------------------------
// Apply user preferences (theme + accent from server profile)
// --------------------------------------------------------
function isAppearanceSyncEnabled(user) {
  return user?.appearance_sync === true || user?.appearance_sync === 1 || user?.appearance_sync === '1';
}

function applyUserPreferences(user) {
  if (!user) return;
  const appearanceSync = isAppearanceSyncEnabled(user);
  const theme = appearanceSync
    ? (user.theme || 'light')
    : (localStorage.getItem('planium-theme') || 'light');
  let accent = appearanceSync
    ? (user.accent || 'blue')
    : (localStorage.getItem('planium-accent') || 'blue');
  const quickLink = appearanceSync
    ? (user.quick_link || '')
    : (localStorage.getItem('planium-quick-link') || '');
  const priorityAppearance = appearanceSync
    ? (user.appearance_priority_appearance || 'accent')
    : (localStorage.getItem('planium-priority-appearance') || 'accent');
  const greetingWidgetAccentFill = appearanceSync
    ? (user.appearance_greeting_widget_accent_fill === true
      || user.appearance_greeting_widget_accent_fill === 1
      || user.appearance_greeting_widget_accent_fill === '1')
    : (localStorage.getItem('planium-greeting-accent-fill') === 'true');
  const showQuotes = appearanceSync
    ? (user.appearance_show_quotes !== false && user.appearance_show_quotes !== '0')
    : (localStorage.getItem('planium-show-quotes') !== 'false');
  const showTickers = appearanceSync
    ? (user.appearance_show_tickers !== false && user.appearance_show_tickers !== '0')
    : (localStorage.getItem('planium-show-tickers') !== 'false');
  const dailyAccentEnabled = appearanceSync
    ? (user.appearance_daily_accent === true || user.appearance_daily_accent === 1 || user.appearance_daily_accent === '1')
    : (localStorage.getItem('planium-daily-accent') === 'true');
  let dailyAccentDate = appearanceSync
    ? (user.appearance_daily_accent_date || '')
    : (localStorage.getItem('planium-daily-accent-date') || '');
  const tickerLink = appearanceSync
    ? (user.appearance_ticker_btc_href || '')
    : (localStorage.getItem('planium-ticker-btc-href') || '');

  // Daily accent rotation
  if (dailyAccentEnabled) {
    const today    = new Date().toISOString().slice(0, 10);
    if (dailyAccentDate !== today) {
      const pool = ALL_ACCENTS.filter(a => a !== accent);
      accent = pool[Math.floor(Math.random() * pool.length)];
      try {
        localStorage.setItem('planium-daily-accent-date', today);
        localStorage.setItem('planium-accent', accent);
        if (appearanceSync) localStorage.setItem('planium-daily-accent', 'true');
      } catch { /* ignore */ }
      if (appearanceSync) {
        api.patch('/auth/me/preferences', {
          accent,
          appearance_daily_accent_date: today,
        }).catch(() => {});
      }
      dailyAccentDate = today;
    }
  }

  // Apply theme
  const VALID_THEMES = ['light','dark','obsidian','midnight-forest','noir','deep-ocean','aubergine','parchment','frost','glacier','arctic'];
  if (VALID_THEMES.includes(theme)) {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  // Sync to localStorage for flash-prevention on next load
  try { localStorage.setItem('planium-theme', theme); } catch { /* ignore */ }
  // Apply accent
  if (accent && accent !== 'blue') {
    document.documentElement.setAttribute('data-accent', accent);
  } else {
    document.documentElement.removeAttribute('data-accent');
  }
  try { localStorage.setItem('planium-accent', accent); } catch { /* ignore */ }

  try {
    localStorage.setItem('planium-quick-link', quickLink);
    localStorage.setItem('planium-priority-appearance', priorityAppearance);
    localStorage.setItem('planium-greeting-accent-fill', greetingWidgetAccentFill ? 'true' : 'false');
    localStorage.setItem('planium-show-quotes', showQuotes ? 'true' : 'false');
    localStorage.setItem('planium-show-tickers', showTickers ? 'true' : 'false');
    localStorage.setItem('planium-daily-accent', dailyAccentEnabled ? 'true' : 'false');
    localStorage.setItem('planium-daily-accent-date', dailyAccentDate);
    localStorage.setItem('planium-ticker-btc-href', tickerLink);
  } catch { /* ignore */ }

  user.appearance_sync = appearanceSync;
  user.theme = theme;
  user.accent = accent;
  user.quick_link = quickLink;
  user.appearance_priority_appearance = priorityAppearance;
  user.appearance_greeting_widget_accent_fill = greetingWidgetAccentFill;
  user.appearance_show_quotes = showQuotes;
  user.appearance_show_tickers = showTickers;
  user.appearance_daily_accent = dailyAccentEnabled;
  user.appearance_daily_accent_date = dailyAccentDate;
  user.appearance_ticker_btc_href = tickerLink;

  const navOrder = parseNavOrder(user.nav_order);
  currentNavOrder = navOrder ?? NAV_PATHS.slice();
}

// --------------------------------------------------------
// Dynamic stylesheet loading per page module
// --------------------------------------------------------
let activePageStyle = null;

function loadPageStyle(moduleName) {
  if (!moduleName) return { ready: Promise.resolve(), cleanup: () => {} };
  const href = moduleName === 'notebook'
    ? '/styles/notebook-v2.css'
    : `/styles/${moduleName}.css`;
  if (activePageStyle?.getAttribute('href') === href) {
    return { ready: Promise.resolve(), cleanup: () => {} };
  }

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;

  const oldLink = activePageStyle;

  const ready = new Promise((resolve) => {
    link.onload = resolve;
    link.onerror = resolve;
  });

  document.head.appendChild(link);
  activePageStyle = link;

  return {
    ready,
    cleanup: () => { if (oldLink) oldLink.remove(); },
  };
}

// --------------------------------------------------------
// Module cache: prevents redundant dynamic imports during navigation
// --------------------------------------------------------
const moduleCache = new Map();

async function importPage(pagePath) {
  if (!moduleCache.has(pagePath)) {
    moduleCache.set(pagePath, await import(pagePath));
  }
  return moduleCache.get(pagePath);
}

// --------------------------------------------------------
// Global app state
// --------------------------------------------------------
let currentUser = null;
let currentPath = null;
let isNavigating = false;

// --------------------------------------------------------
// Router
// --------------------------------------------------------

const ROUTE_ORDER = ['/', '/tasks', '/lists', '/notes', '/notebook', '/calendar', '/news',
                     '/web', '/meals', '/contacts', '/settings'];

function getDirection(fromPath, toPath) {
  const fromIdx = ROUTE_ORDER.indexOf(fromPath ?? '/');
  const toIdx   = ROUTE_ORDER.indexOf(toPath);
  if (fromIdx === -1 || toIdx === -1 || fromPath === toPath) return 'right';
  return toIdx > fromIdx ? 'right' : 'left';
}

/**
 * Navigates to a path and renders the corresponding page.
 * @param {string} path
 * @param {Object|boolean} userOrPushState - Directly a user object after login,
 *   or boolean (pushState) for internal navigation
 * @param {boolean} pushState - false on initial load and popstate
 */
async function navigate(path, userOrPushState = true, pushState = true) {
  if (isNavigating) return;
  isNavigating = true;

  try {
    // Overloading: navigate(path, user) after login vs navigate(path, false) on init
    if (typeof userOrPushState === 'object' && userOrPushState !== null) {
      currentUser = userOrPushState;
      applyUserPreferences(currentUser);
      initNotifications(currentUser);
    } else {
      pushState = userOrPushState;
    }

    // Remember old path before currentPath is updated - for direction calculation
    const previousPath = currentPath;
    currentPath = path;

    const route = ROUTES.find((r) => r.path === path) ?? ROUTES.find((r) => r.path === '/');

    // Auth-Guard
    if (route.requiresAuth && !currentUser) {
      try {
        const result = await auth.me();
        currentUser = result.user;
        applyUserPreferences(currentUser);
        initNotifications(currentUser);
      } catch {
        currentPath = null; // Reset so that navigate('/login') is not blocked
        isNavigating = false;
        navigate('/login');
        return;
      }
    }

    if (!route.requiresAuth && currentUser && path === '/login') {
      currentPath = null;
      isNavigating = false;
      navigate('/');
      return;
    }

    if (pushState) {
      history.pushState({ path }, '', path);
    }

    const accent = route?.module ? getCSSToken(`--module-${route.module}`) : '';
    document.documentElement.style.setProperty('--active-module-accent', accent);
    updateNav(path);

    await renderPage(route, previousPath);
    updateThemeColorForRoute(route);
  } finally {
    isNavigating = false;
  }
}

/**
 * Dynamically loads and renders a page.
 * @param {{ path: string, page: string }} route
 * @param {string|null} previousPath - Path before navigation (for direction calculation)
 */
async function renderPage(route, previousPath = null, { noTransition = false } = {}) {
  const app = document.getElementById('app');
  const loading = document.getElementById('app-loading');

  // Hide loading indicator
  if (loading) loading.hidden = true;

  try {
    const style = loadPageStyle(route.module);
    const [module] = await Promise.all([
      importPage(route.page),
      style.ready,
    ]);

    if (typeof module.render !== 'function') {
      throw new Error(`Page ${route.page} does not export a render() function.`);
    }

    // Build the app shell once BEFORE render() is called -
    // main-content must exist in the DOM so that document.getElementById()
    // works in page modules.
    if (!document.querySelector('.nav-bottom') && currentUser) {
      renderAppShell(app);
      refreshOptionalNavItems();
      initPTR();
    }

    const content = document.getElementById('main-content') || app;

    // Determine direction (previousPath is the old path before navigation)
    const direction = getDirection(previousPath, route.path);
    const outClass  = direction === 'right' ? 'page-transition--out-left' : 'page-transition--out-right';
    const inClass   = direction === 'right' ? 'page-transition--in-right' : 'page-transition--in-left';

    // Briefly fade out old page, if present
    const oldPage = content.querySelector('.page-transition');
    if (oldPage && !noTransition) {
      oldPage.classList.add(outClass);
      await new Promise(r => setTimeout(r, 120));
    } else if (oldPage) {
      oldPage.remove();
    }

    // Remove any FABs that were hoisted out of the previous page wrapper.
    content.querySelectorAll(':scope > .page-fab, :scope > .fab-container').forEach(fab => fab.remove());

    // Old content is now gone - old stylesheet can be removed
    const pageWrapper = document.createElement('div');
    pageWrapper.className = 'page-transition';
    pageWrapper.style.opacity = '0';
    content.replaceChildren(pageWrapper);
    style.cleanup();

    // Reset scroll before rendering: prevents scrollTop clamp jerk during swap.
    window.scrollTo(0, 0);
    if (content.scrollTop) content.scrollTop = 0;

    await module.render(pageWrapper, { user: currentUser });

    // Hoist any .page-fab buttons out of pageWrapper so they are siblings of
    // the animated element, not children. A CSS transform on a parent creates a
    // new containing block for position:fixed descendants, which makes them jump
    // during the slide-in animation. Moving them one level up avoids this.
    pageWrapper.querySelectorAll('.page-fab, .fab-container').forEach(fab => content.appendChild(fab));

    // Make visible and start animation only after render() + CSS
    pageWrapper.style.opacity = '';
    if (!noTransition) {
      pageWrapper.classList.add(inClass);
      // Remove animation class after it finishes so that the lingering
      // transform: translateX(0) from `forwards` fill-mode does not create a
      // new containing block, which would break position:fixed children (FABs).
      pageWrapper.addEventListener('animationend', () => {
        pageWrapper.classList.remove(inClass);
      }, { once: true });
    }

  } catch (err) {
    console.error('[Router] Page render error:', err);
    renderError(app, err);
  }
}

/**
 * Build the app shell with navigation once (after first login).
 */
function renderAppShell(container) {
  container.innerHTML = `
    <a href="#main-content" class="sr-only">${t('common.skipToContent')}</a>
    <nav class="nav-sidebar" aria-label="${t('nav.main')}">
      <a href="/" data-route="/" class="nav-sidebar__logo" aria-label="${t('nav.dashboard')}"><img src="/icons/logo-p.svg" alt="" class="nav-sidebar__logo-img" aria-hidden="true"><span>Planium</span></a>
      <div class="nav-sidebar__items" role="list">
        ${navItems().map((item) => navItemHtml(item, item.optional)).join('')}
      </div>
    </nav>

    <main class="app-content" id="main-content" aria-live="polite">
    </main>

    <nav class="nav-bottom" aria-label="${t('nav.navigation')}">
      <div class="nav-bottom__dots" aria-hidden="true">
        <span class="nav-bottom__dot nav-bottom__dot--active"></span>
        <span class="nav-bottom__dot"></span>
      </div>
      <div class="nav-bottom__scroll">
        ${buildBottomNavPagesHtml((item) => item.optional)}
      </div>
    </nav>

    <div class="toast-container" id="toast-container" aria-live="assertive"></div>
  `;

  // Click handler for all nav links, including rebuilt bottom-nav pages
  container.addEventListener('click', (e) => {
    const el = e.target.closest('[data-route]');
    if (!el || !container.contains(el)) return;
    e.preventDefault();
    navigate(el.dataset.route);
  });

  // Bottom nav: scroll-snap + dot indicator
  initBottomNavSwipe(container);
  initRouteSwipe(container);
  scrollNavToActive();
  wireNavReorder(container);
}

/**
 * Initialises swipe gestures and dot indicator for the mobile bottom navigation.
 */
function initBottomNavSwipe(container) {
  const scroll = container.querySelector('.nav-bottom__scroll');
  const dots   = container.querySelectorAll('.nav-bottom__dot');
  if (!scroll || !dots.length) return;

  // Scroll event: update dot indicator
  scroll.addEventListener('scroll', () => {
    const page = Math.round(scroll.scrollLeft / scroll.offsetWidth);
    dots.forEach((d, i) => d.classList.toggle('nav-bottom__dot--active', i === page));
  }, { passive: true });
}

/**
 * Scrolls the bottom nav to the correct page when an item on page 2 is active.
 */
function scrollNavToActive() {
  const scroll = document.querySelector('.nav-bottom__scroll');
  if (!scroll) return;
  const secondPage = getBottomNavPages()[1]?.map((item) => item.path) ?? [];
  if (secondPage.includes(currentPath)) {
    scroll.scrollTo({ left: scroll.offsetWidth, behavior: 'smooth' });
  }
}

function isRouteSwipeExcludedTarget(target) {
  return !!target?.closest([
    'a',
    'button',
    'input',
    'textarea',
    'select',
    'label',
    '[contenteditable="true"]',
    '.nav-sidebar',
    '.nav-bottom',
    '.shopping-page',
    '#tasks-widget',
    '#shopping-widget',
    '#list-content',
  ].join(', '));
}

/**
 * Lets mobile users swipe left/right to move between routes.
 * Content areas that already own horizontal swipes opt out via selectors above.
 */
function initRouteSwipe(container) {
  const main = container.querySelector('#main-content');
  if (!main) return;

  const isMobile = () => window.matchMedia('(max-width: 1023px)').matches;
  const SWIPE_THRESHOLD = 50;
  const LOCK_DELTA = 10;

  let startX = 0;
  let startY = 0;
  let tracking = false;
  let locked = null;

  main.addEventListener('touchstart', (e) => {
    if (!isMobile()) return;
    if (e.touches.length !== 1) { tracking = false; return; }
    if (isRouteSwipeExcludedTarget(e.target)) { tracking = false; return; }
    if (ROUTE_ORDER.indexOf(currentPath ?? '') === -1) { tracking = false; return; }

    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    tracking = true;
    locked = null;
  }, { passive: true });

  main.addEventListener('touchmove', (e) => {
    if (!tracking) return;

    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    if (locked === null) {
      if (Math.abs(dx) > LOCK_DELTA && Math.abs(dx) > Math.abs(dy)) locked = 'h';
      else if (Math.abs(dy) > LOCK_DELTA) locked = 'v';
    }

    if (locked === 'h') {
      e.preventDefault();
    }
  }, { passive: false });

  main.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    if (locked !== 'h') return;

    const dx = (e.changedTouches[0]?.clientX ?? startX) - startX;
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;

    const currentIdx = ROUTE_ORDER.indexOf(currentPath ?? '');
    if (currentIdx === -1) return;

    const nextIdx = dx < 0
      ? Math.min(ROUTE_ORDER.length - 1, currentIdx + 1)
      : Math.max(0, currentIdx - 1);
    if (nextIdx === currentIdx) return;

    navigate(ROUTE_ORDER[nextIdx]);
  });

  main.addEventListener('touchcancel', () => {
    tracking = false;
    locked = null;
  });
}

function setNavRouteHidden(path, hidden) {
  document.querySelectorAll(`a.nav-item[data-route="${path}"]`).forEach(el => {
    el.hidden = hidden;
  });
}

async function refreshOptionalNavItems() {
  const [mealieStatus, freshrssStatus, linkdingStatus, fileboxStatus, webviewStatus] = await Promise.allSettled([
    api.get('/mealie/status'),
    api.get('/freshrss/status'),
    api.get('/linkding/status'),
    api.get('/filebox/status'),
    api.get('/webview/config'),
  ]);

  const mealieConfigured = mealieStatus.status === 'fulfilled' && mealieStatus.value?.configured;
  const freshrssConfigured = freshrssStatus.status === 'fulfilled' && freshrssStatus.value?.configured;
  const linkdingConfigured = linkdingStatus.status === 'fulfilled' && linkdingStatus.value?.configured;
  const fileboxEnabled = fileboxStatus.status === 'fulfilled' && fileboxStatus.value?.enabled;
  const webviewConfigured = webviewStatus.status === 'fulfilled' && webviewStatus.value?.configured;
  const webviewTabsEnabled = webviewConfigured && webviewStatus.value?.show_in_tabs !== false;

  setNavRouteHidden('/meals', !mealieConfigured);
  setNavRouteHidden('/news', !freshrssConfigured);
  setNavRouteHidden('/web', !webviewTabsEnabled);
  setNavRouteHidden('/bookmarks', !linkdingConfigured);
  setNavRouteHidden('/filebox', !fileboxEnabled);
  renderBottomNavPages();
  updateNav(currentPath);
}

function wireNavReorder(container) {
  const bar = container.querySelector('.nav-sidebar__items');
  if (!bar) return;

  let dragging = null;
  let dragPtrId = null;
  let didDrag = false;
  let startX = 0;
  let startY = 0;
  let savedOrder = currentNavOrder.slice();

  const getVisibleDraggables = () => [...bar.querySelectorAll('.nav-item:not([hidden])')];

  bar.addEventListener('pointerdown', (e) => {
    const item = e.target.closest('.nav-item:not([hidden])');
    if (!item || !bar.contains(item)) return;
    e.preventDefault();
    dragging = item;
    dragPtrId = e.pointerId;
    didDrag = false;
    savedOrder = currentNavOrder.slice();
    startX = e.clientX;
    startY = e.clientY;
  });

  bar.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== dragPtrId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!didDrag && Math.abs(dx) > Math.abs(dy) + 5) {
      dragging = null;
      dragPtrId = null;
      return;
    }
    if (!didDrag) {
      if (Math.abs(dy) < 8) return;
      didDrag = true;
      dragging.classList.add('nav-item--dragging');
      try { bar.setPointerCapture(e.pointerId); } catch {}
    }
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.nav-item:not([hidden])');
    if (!over || over === dragging) return;
    const items = getVisibleDraggables();
    const dragIdx = items.indexOf(dragging);
    const overIdx = items.indexOf(over);
    if (dragIdx === -1 || overIdx === -1) return;
    if (dragIdx < overIdx) over.after(dragging); else over.before(dragging);
  });

  const finishDrag = async (e) => {
    if (!dragging || e.pointerId !== dragPtrId) return;
    const wasDragged = didDrag;
    dragging.classList.remove('nav-item--dragging');
    const newVisibleOrder = getVisibleDraggables().map((el) => el.dataset.route);
    dragging = null;
    dragPtrId = null;
    didDrag = false;
    if (!wasDragged) return;
    bar.addEventListener('click', (ev) => ev.stopImmediatePropagation(), { once: true, capture: true });

    const newFullOrder = buildFullNavOrderFromVisible(newVisibleOrder);
    if (JSON.stringify(newFullOrder) === JSON.stringify(savedOrder)) return;

    const oldNavOrder = currentNavOrder.slice();
    currentNavOrder = newFullOrder;

    try {
      await api.patch('/auth/me/preferences', { nav_order: newFullOrder });
      await syncNavShell();
    } catch (err) {
      currentNavOrder = oldNavOrder;
      window.planium?.showToast(err.message, 'danger');
      await syncNavShell();
    }
  };

  bar.addEventListener('pointerup', finishDrag);
  bar.addEventListener('pointercancel', (e) => {
    if (!dragging || e.pointerId !== dragPtrId) return;
    dragging.classList.remove('nav-item--dragging');
    dragging = null;
    dragPtrId = null;
    didDrag = false;
    currentNavOrder = savedOrder.slice();
    syncNavShell();
  });
}

function navItems() {
  const byPath = new Map(NAV_ITEM_DEFS.map((item) => [item.path, item]));
  return currentNavOrder.map((path) => byPath.get(path)).filter(Boolean).map((item) => ({
    ...item,
    label: item.label ?? t(item.labelKey),
  }));
}

function navItemHtml({ path, label, icon }, hidden = false) {
  return `
    <a href="${path}" data-route="${path}" class="nav-item" role="listitem" aria-label="${label}" draggable="false" ${hidden ? 'hidden' : ''}>
      <i data-lucide="${icon}" class="nav-item__icon" aria-hidden="true"></i>
      <span class="nav-item__label">${label}</span>
    </a>
  `;
}

function isNavRouteHidden(path) {
  return document.querySelector(`a.nav-item[data-route="${path}"]`)?.hidden ?? false;
}

function getVisibleNavItems() {
  return navItems().filter((item) => !item.optional || !isNavRouteHidden(item.path));
}

function getBottomNavPages(hiddenResolver = (item) => isNavRouteHidden(item.path)) {
  const items = navItems().map((item) => ({
    ...item,
    hidden: hiddenResolver(item),
  }));

  const visibleItems = items.filter((item) => !item.hidden);
  const splitIndex = Math.ceil(visibleItems.length / 2);
  const pages = [[], []];
  let visibleSeen = 0;

  for (const item of items) {
    if (item.hidden) continue;
    const pageIndex = visibleSeen < splitIndex ? 0 : 1;
    pages[pageIndex].push(item);
    visibleSeen++;
  }

  return pages;
}

function renderBottomNavPages() {
  const scroll = document.querySelector('.nav-bottom__scroll');
  if (!scroll) return '';

  const pageHtml = buildBottomNavPagesHtml();
  scroll.innerHTML = pageHtml;
  return pageHtml;
}

function buildBottomNavPagesHtml(hiddenResolver) {
  return getBottomNavPages(hiddenResolver).map((page) => `
        <div class="nav-bottom__page" role="list">
          ${page.map((item) => navItemHtml(item, item.hidden)).join('')}
        </div>
  `).join('');
}

function renderSidebarNavItems() {
  const items = document.querySelector('.nav-sidebar__items');
  if (!items) return;
  items.innerHTML = navItems().map((item) => navItemHtml(item, item.optional)).join('');
  if (window.lucide) window.lucide.createIcons();
}

function buildFullNavOrderFromVisible(newVisibleOrder) {
  const visibleSet = new Set(getVisibleNavItems().map((item) => item.path));
  const next = [];
  let idx = 0;

  for (const path of currentNavOrder) {
    if (visibleSet.has(path)) {
      next.push(newVisibleOrder[idx++] ?? path);
    } else {
      next.push(path);
    }
  }

  return normalizeNavOrder(next);
}

async function syncNavShell() {
  renderSidebarNavItems();
  renderBottomNavPages();
  updateNav(currentPath);
  await refreshOptionalNavItems();
  updateNav(currentPath);
}

/**
 * Highlight the active nav link.
 */
function updateNav(path) {
  document.querySelectorAll('[data-route]').forEach((el) => {
    el.removeAttribute('aria-current');
    if (el.dataset.route === path) {
      el.setAttribute('aria-current', 'page');
    }
  });

  // Re-render Lucide icons (after DOM update)
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // Scroll bottom nav to the active page
  scrollNavToActive();

  // Module accent colour is set in navigate() where route is already resolved.
}

function renderError(container, err) {
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-state__title">${t('common.errorOccurred')}</div>
      <div class="empty-state__description">${err.message}</div>
      <button class="btn btn--primary" id="error-reload-btn">${t('common.reload')}</button>
    </div>
  `;
  container.querySelector('#error-reload-btn')?.addEventListener('click', () => location.reload());
}

// --------------------------------------------------------
// Toast notifications (global)
// --------------------------------------------------------

/**
 * Shows a toast notification.
 * @param {string} message
 * @param {'default'|'success'|'danger'|'warning'} type
 * @param {number} duration - ms
 */
const TOAST_ICONS = {
  success: '<svg class="toast__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
  danger:  '<svg class="toast__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  warning: '<svg class="toast__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
};

function showToast(message, type = 'default', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type !== 'default' ? `toast--${type}` : ''}`;
  toast.setAttribute('role', 'alert');

  // Icon: static SVGs from TOAST_ICONS (no user input, no XSS risk)
  const icon = TOAST_ICONS[type] || '';
  const span = document.createElement('span');
  span.textContent = message;
  toast.innerHTML = icon; // eslint-disable-line no-unsanitized/property -- static SVG only
  toast.appendChild(span);

  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast--out');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, duration);
}

// --------------------------------------------------------
// Event listeners
// --------------------------------------------------------

// --------------------------------------------------------
// Global error handlers (Error Boundary)
// --------------------------------------------------------

window.addEventListener('error', (e) => {
  // Resource load errors (e.g. failed image): ignore
  if (e.target && e.target !== window) return;
  console.error('[Planium] Unhandled error:', e.error ?? e.message);
  showToast(t('common.unexpectedError'), 'danger');
});

window.addEventListener('unhandledrejection', (e) => {
  // Auth errors are already handled by auth:expired
  if (e.reason?.status === 401) return;
  console.error('[Planium] Unhandled Promise rejection:', e.reason);
  const msg = e.reason?.message || t('common.errorGeneric');
  showToast(msg, 'danger');
  e.preventDefault(); // Suppress console error (already logged)
});

// SW update: new version installed in background → show toast
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'SW_UPDATED') {
      // Clear module cache so next navigation loads fresh modules
      moduleCache.clear();
      showToast(t('common.updateAvailable'), 'default', 8000);
    }
  });
}

// Browser back/forward
window.addEventListener('popstate', (e) => {
  navigate(e.state?.path || location.pathname, false);
});

// Session expired
window.addEventListener('auth:expired', () => {
  currentUser = null;
  stopNotifications();
  navigate('/login');
});


// --------------------------------------------------------
// Virtual keyboard: hide FAB when keyboard is open
// Detection via visualViewport - height < 75% of window = keyboard active.
// Only relevant on mobile devices (< 1024px), desktop has no virtual keyboard.
// --------------------------------------------------------
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    const keyboardVisible = window.visualViewport.height < window.innerHeight * 0.75;
    document.body.classList.toggle('keyboard-visible', keyboardVisible);
  });
}

// --------------------------------------------------------
// Background image
// --------------------------------------------------------
function applyBackground() {
  const bg  = localStorage.getItem('planium-bg');
  const dim = parseFloat(localStorage.getItem('planium-bg-dim') ?? '0.2');

  let layer = document.getElementById('bg-layer');

  if (bg) {
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'bg-layer';
      document.body.insertBefore(layer, document.body.firstChild);
    }
    layer.style.backgroundImage =
      `linear-gradient(rgba(0,0,0,${dim}),rgba(0,0,0,${dim})),url("${bg}")`;
  } else if (layer) {
    layer.remove();
  }
}

// --------------------------------------------------------
// Initialisation
// --------------------------------------------------------
(async () => {
  await initI18n();
  applyBackground();

  let initialPath = location.pathname;
  try {
    const { required } = await auth.setupRequired();
    if (required) initialPath = '/setup';
    else if (initialPath === '/setup') initialPath = '/login';
  } catch {
    // network/server error → fall through; login flow will surface it
  }

  navigate(initialPath, false);
})();

// Global exports
window.planium = {
  navigate,
  showToast,
  setThemeColor,
  applyBackground,
  refreshOptionalNavItems,
  refresh: () => {
    const route = ROUTES.find(r => r.path === currentPath);
    if (route) renderPage(route, null, { noTransition: true });
  },
  restoreThemeColor: () => {
    const route = ROUTES.find((r) => r.path === currentPath);
    updateThemeColorForRoute(route);
  },
};
