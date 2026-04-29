export const DASHBOARD_WIDGETS = [
  { id: 'quote-widget', labelKey: 'dashboard.quoteOfTheDay', defaultSpan: 'full', visibleByDefault: true },
  { id: 'tasks-widget', labelKey: 'nav.tasks', defaultSpan: '2', visibleByDefault: true },
  { id: 'events-widget', labelKey: 'nav.calendar', defaultSpan: '1', visibleByDefault: true },
  { id: 'shopping-widget', labelKey: 'nav.lists', defaultSpan: '2', visibleByDefault: true },
  { id: 'quick-notes-widget', labelKey: 'dashboard.quickNotesTitle', defaultSpan: '1', visibleByDefault: true },
];

const DASHBOARD_WIDGET_VISIBILITY_KEY_BASE = 'planium-dashboard-widget-visibility';

function dashboardVariantSuffix() {
  if (typeof window === 'undefined' || !window.location) return '';
  return window.location.pathname === '/dashboard-test' ? '-test' : '';
}

function dashboardWidgetVisibilityKey() {
  return `${DASHBOARD_WIDGET_VISIBILITY_KEY_BASE}${dashboardVariantSuffix()}`;
}

const DASHBOARD_WIDGET_SPANS = new Set(['1', '2', 'full']);
const DASHBOARD_WIDGET_HEIGHTS = new Set(['xxs', 'xs', 'short', 'normal', 'tall', 'xlarge']);
const DASHBOARD_LAYOUT_TOKEN = /^[A-Za-z0-9:_-]+$/;

function normalizeDashboardWidgetIds(value) {
  const values = Array.isArray(value)
    ? value
    : value instanceof Set
      ? [...value]
      : [];
  const seen = new Set();
  const result = [];
  for (const id of values) {
    if (typeof id !== 'string' || !DASHBOARD_LAYOUT_TOKEN.test(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function readStoredDashboardWidgetHiddenIds() {
  const raw = localStorage.getItem(dashboardWidgetVisibilityKey());
  if (raw == null) return null;
  try {
    return normalizeDashboardWidgetIds(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function loadDashboardWidgetHiddenIds(fallbackHidden = []) {
  const stored = readStoredDashboardWidgetHiddenIds();
  if (stored !== null) return new Set(stored);

  const hidden = normalizeDashboardWidgetIds(fallbackHidden);
  if (hidden.length > 0) {
    localStorage.setItem(dashboardWidgetVisibilityKey(), JSON.stringify(hidden));
  }
  return new Set(hidden);
}

export function saveDashboardWidgetHiddenIds(hiddenIds = []) {
  const hidden = normalizeDashboardWidgetIds(hiddenIds);
  localStorage.setItem(dashboardWidgetVisibilityKey(), JSON.stringify(hidden));
  return hidden;
}

export function defaultDashboardLayout() {
  return {
    order: DASHBOARD_WIDGETS.map((widget) => widget.id),
    hidden: DASHBOARD_WIDGETS.filter((widget) => widget.visibleByDefault === false).map((widget) => widget.id),
    spans: DASHBOARD_WIDGETS.reduce((acc, widget) => {
      acc[widget.id] = widget.defaultSpan ?? '1';
      return acc;
    }, {}),
    heights: DASHBOARD_WIDGETS.reduce((acc, widget) => {
      acc[widget.id] = 'normal';
      return acc;
    }, {}),
  };
}

export function normalizeDashboardLayoutForDevice(value) {
  const layout = normalizeDashboardLayout(value);
  const hidden = loadDashboardWidgetHiddenIds(layout.hidden);
  return {
    ...layout,
    hidden: [...hidden],
  };
}

export function stripDashboardLayoutVisibility(value) {
  const { hidden: _hidden, ...layout } = normalizeDashboardLayout(value);
  return layout;
}

export function dashboardWidgetHeightClass(height = 'normal') {
  return `widget-layout--height-${height}`;
}

export function nextDashboardWidgetHeight(height = 'normal') {
  if (height === 'xxs') return 'xs';
  if (height === 'xs') return 'short';
  if (height === 'short') return 'normal';
  if (height === 'normal') return 'tall';
  if (height === 'tall') return 'xlarge';
  return 'xxs';
}

export function dashboardWidgetHeightLabel(height = 'normal') {
  if (height === 'xxs') return 'XXS';
  if (height === 'xs') return 'XS';
  if (height === 'short') return 'S';
  if (height === 'normal') return 'M';
  if (height === 'tall') return 'L';
  if (height === 'xlarge') return 'XL';
  return 'M';
}

export function normalizeDashboardLayout(value) {
  const defaults = defaultDashboardLayout();
  const layout = value && typeof value === 'object' ? value : {};
  const order = Array.isArray(layout.order) ? layout.order : [];
  const hidden = Array.isArray(layout.hidden) ? layout.hidden : [];
  const spans = layout.spans && typeof layout.spans === 'object' ? layout.spans : {};
  const heights = layout.heights && typeof layout.heights === 'object' ? layout.heights : {};
  const seen = new Set();
  const normalizedOrder = [];

  for (const id of order) {
    if (typeof id !== 'string' || !DASHBOARD_LAYOUT_TOKEN.test(id) || seen.has(id)) continue;
    seen.add(id);
    normalizedOrder.push(id);
  }
  for (const widget of DASHBOARD_WIDGETS) {
    if (seen.has(widget.id)) continue;
    seen.add(widget.id);
    normalizedOrder.push(widget.id);
  }

  const normalizedHidden = [];
  const hiddenSeen = new Set();
  for (const id of hidden) {
    if (typeof id !== 'string' || !DASHBOARD_LAYOUT_TOKEN.test(id) || hiddenSeen.has(id)) continue;
    hiddenSeen.add(id);
    normalizedHidden.push(id);
  }

  return {
    order: normalizedOrder,
    hidden: normalizedHidden,
    spans: Object.keys(spans).reduce((acc, key) => {
      const value = String(spans[key]);
      if (DASHBOARD_LAYOUT_TOKEN.test(key) && DASHBOARD_WIDGET_SPANS.has(value)) {
        acc[key] = value;
      }
      return acc;
    }, DASHBOARD_WIDGETS.reduce((acc, widget) => {
      const value = String(spans[widget.id] ?? defaults.spans[widget.id] ?? '1');
      acc[widget.id] = DASHBOARD_WIDGET_SPANS.has(value) ? value : (defaults.spans[widget.id] ?? '1');
      return acc;
    }, {})),
    heights: Object.keys(heights).reduce((acc, key) => {
      const value = String(heights[key]);
      if (DASHBOARD_LAYOUT_TOKEN.test(key) && DASHBOARD_WIDGET_HEIGHTS.has(value)) {
        acc[key] = value;
      }
      return acc;
    }, DASHBOARD_WIDGETS.reduce((acc, widget) => {
      const value = String(heights[widget.id] ?? defaults.heights[widget.id] ?? 'normal');
      acc[widget.id] = DASHBOARD_WIDGET_HEIGHTS.has(value) ? value : (defaults.heights[widget.id] ?? 'normal');
      return acc;
    }, {})),
  };
}

export function dashboardWidgetLabelMap(t) {
  return DASHBOARD_WIDGETS.reduce((acc, widget) => {
    acc[widget.id] = t(widget.labelKey);
    return acc;
  }, {});
}
