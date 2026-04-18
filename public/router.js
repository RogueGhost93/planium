/**
 * Module: Client-Side Router
 * Purpose: SPA routing via History API without a framework, auth guard, page transitions
 * Dependencies: api.js
 */

import { auth, api } from '/api.js';
import { initI18n, getLocale, t } from '/i18n.js';
import { initNotifications, stopNotifications } from '/components/task-notifications.js';

// --------------------------------------------------------
// Route definitions
// Each route has: path, page (dynamically loaded), requiresAuth, module (for theme-color)
// --------------------------------------------------------
const ROUTES = [
  { path: '/login',    page: '/pages/login.js',    requiresAuth: false, module: null        },
  { path: '/',         page: '/pages/dashboard.js', requiresAuth: true, module: 'dashboard' },
  { path: '/tasks',    page: '/pages/tasks.js',     requiresAuth: true, module: 'tasks'     },
  { path: '/lists',    page: '/pages/lists.js',     requiresAuth: true, module: 'lists'     },
  { path: '/meals',    page: '/pages/meals.js',     requiresAuth: true, module: 'meals'     },
  { path: '/calendar', page: '/pages/calendar.js',  requiresAuth: true, module: 'calendar'  },
  { path: '/notes',    page: '/pages/notes.js',     requiresAuth: true, module: 'notes'     },
  { path: '/contacts', page: '/pages/contacts.js',  requiresAuth: true, module: 'contacts'  },
  { path: '/budget',   page: '/pages/budget.js',    requiresAuth: true, module: 'budget'    },
  { path: '/settings', page: '/pages/settings.js',  requiresAuth: true, module: 'settings'  },
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

// --------------------------------------------------------
// Apply user preferences (theme + accent from server profile)
// --------------------------------------------------------
function applyUserPreferences(user) {
  if (!user) return;
  const theme = user.theme || 'system';
  let accent  = user.accent || 'blue';

  // Daily accent rotation
  const rotationEnabled = localStorage.getItem('planner-daily-accent') !== 'false';
  if (rotationEnabled) {
    const today    = new Date().toISOString().slice(0, 10);
    const lastDate = localStorage.getItem('planner-daily-accent-date');
    if (lastDate !== today) {
      const pool = ALL_ACCENTS.filter(a => a !== accent);
      accent = pool[Math.floor(Math.random() * pool.length)];
      try {
        localStorage.setItem('planner-daily-accent-date', today);
        localStorage.setItem('planner-accent', accent);
      } catch { /* ignore */ }
      api.patch('/auth/me/preferences', { accent }).catch(() => {});
    }
  }

  // Apply theme
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  // Sync to localStorage for flash-prevention on next load
  try { localStorage.setItem('planner-theme', theme); } catch { /* ignore */ }
  // Apply accent
  if (accent && accent !== 'blue') {
    document.documentElement.setAttribute('data-accent', accent);
  } else {
    document.documentElement.removeAttribute('data-accent');
  }
  try { localStorage.setItem('planner-accent', accent); } catch { /* ignore */ }
}

// --------------------------------------------------------
// Dynamic stylesheet loading per page module
// --------------------------------------------------------
let activePageStyle = null;

function loadPageStyle(moduleName) {
  if (!moduleName) return { ready: Promise.resolve(), cleanup: () => {} };
  const href = `/styles/${moduleName}.css`;
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

const ROUTE_ORDER = ['/', '/tasks', '/lists', '/calendar', '/meals',
                     '/notes', '/contacts', '/settings'];

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

    await renderPage(route, previousPath);
    updateNav(path);
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
async function renderPage(route, previousPath = null) {
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
    }

    const content = document.getElementById('main-content') || app;

    // Determine direction (previousPath is the old path before navigation)
    const direction = getDirection(previousPath, route.path);
    const outClass  = direction === 'right' ? 'page-transition--out-left' : 'page-transition--out-right';
    const inClass   = direction === 'right' ? 'page-transition--in-right' : 'page-transition--in-left';

    // Briefly fade out old page, if present
    const oldPage = content.querySelector('.page-transition');
    if (oldPage) {
      oldPage.classList.add(outClass);
      await new Promise(r => setTimeout(r, 120));
    }

    // Remove any FABs that were hoisted out of the previous page wrapper.
    content.querySelectorAll(':scope > .page-fab, :scope > .fab-container').forEach(fab => fab.remove());

    // Old content is now gone - old stylesheet can be removed
    const pageWrapper = document.createElement('div');
    pageWrapper.className = 'page-transition';
    pageWrapper.style.opacity = '0';
    content.replaceChildren(pageWrapper);
    style.cleanup();

    await module.render(pageWrapper, { user: currentUser });

    // Hoist any .page-fab buttons out of pageWrapper so they are siblings of
    // the animated element, not children. A CSS transform on a parent creates a
    // new containing block for position:fixed descendants, which makes them jump
    // during the slide-in animation. Moving them one level up avoids this.
    pageWrapper.querySelectorAll('.page-fab, .fab-container').forEach(fab => content.appendChild(fab));

    // Make visible and start animation only after render() + CSS
    pageWrapper.style.opacity = '';
    pageWrapper.classList.add(inClass);
    // Remove animation class after it finishes so that the lingering
    // transform: translateX(0) from `forwards` fill-mode does not create a
    // new containing block, which would break position:fixed children (FABs).
    pageWrapper.addEventListener('animationend', () => {
      pageWrapper.classList.remove(inClass);
    }, { once: true });

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
      <a href="/" data-route="/" class="nav-sidebar__logo" aria-label="${t('nav.dashboard')}"><img src="/icons/logo-p.svg" alt="" class="nav-sidebar__logo-img" aria-hidden="true"><span>Planner</span></a>
      <div class="nav-sidebar__items" role="list">
        ${navItems().map(navItemHtml).join('')}
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
        <div class="nav-bottom__page" role="list">
          ${navItems().slice(0, 5).map(navItemHtml).join('')}
        </div>
        <div class="nav-bottom__page" role="list">
          ${navItems().slice(5).map(navItemHtml).join('')}
        </div>
      </div>
    </nav>

    <div class="toast-container" id="toast-container" aria-live="assertive"></div>
  `;

  // Click handler for all nav links
  container.querySelectorAll('[data-route]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(el.dataset.route);
    });
  });

  // Bottom nav: scroll-snap + dot indicator
  initBottomNavSwipe(container);
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
  const secondPage = navItems().slice(5).map(n => n.path);
  if (secondPage.includes(currentPath)) {
    scroll.scrollTo({ left: scroll.offsetWidth, behavior: 'smooth' });
  }
}

function navItems() {
  return [
    { path: '/',         label: t('nav.dashboard'), icon: 'layout-dashboard' },
    { path: '/tasks',    label: t('nav.tasks'),     icon: 'check-square'     },
    { path: '/lists',    label: t('nav.lists'),     icon: 'list-checks'      },
    { path: '/calendar', label: t('nav.calendar'),  icon: 'calendar'         },
    { path: '/notes',    label: t('nav.notes'),     icon: 'sticky-note'      },
    { path: '/meals',    label: t('nav.meals'),     icon: 'utensils'         },
    { path: '/contacts', label: t('nav.contacts'),  icon: 'book-user'        },
    { path: '/settings', label: t('nav.settings'),  icon: 'settings'         },
  ];
}

function navItemHtml({ path, label, icon }) {
  return `
    <a href="${path}" data-route="${path}" class="nav-item" role="listitem" aria-label="${label}">
      <i data-lucide="${icon}" class="nav-item__icon" aria-hidden="true"></i>
      <span class="nav-item__label">${label}</span>
    </a>
  `;
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
  console.error('[Planner] Unhandled error:', e.error ?? e.message);
  showToast(t('common.unexpectedError'), 'danger');
});

window.addEventListener('unhandledrejection', (e) => {
  // Auth errors are already handled by auth:expired
  if (e.reason?.status === 401) return;
  console.error('[Planner] Unhandled Promise rejection:', e.reason);
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
// Initialisation
// --------------------------------------------------------
(async () => {
  await initI18n();
  navigate(location.pathname, false);
})();

// Global exports
window.planner = {
  navigate,
  showToast,
  setThemeColor,
  restoreThemeColor: () => {
    const route = ROUTES.find((r) => r.path === currentPath);
    updateThemeColorForRoute(route);
  },
};
