export const DASHBOARD_WIDGETS = [
  { id: 'quote-widget', labelKey: 'dashboard.quoteOfTheDay', defaultSpan: 'full', visibleByDefault: true },
  { id: 'tasks-widget', labelKey: 'nav.tasks', defaultSpan: '2', visibleByDefault: true },
  { id: 'events-widget', labelKey: 'nav.calendar', defaultSpan: '1', visibleByDefault: true },
  { id: 'shopping-widget', labelKey: 'nav.lists', defaultSpan: '2', visibleByDefault: true },
  { id: 'quick-notes-widget', labelKey: 'dashboard.quickNotesTitle', defaultSpan: '1', visibleByDefault: true },
];

const DASHBOARD_WIDGET_IDS = new Set(DASHBOARD_WIDGETS.map((widget) => widget.id));
const DASHBOARD_WIDGET_SPANS = new Set(['1', '2', 'full']);

export function defaultDashboardLayout() {
  return {
    order: DASHBOARD_WIDGETS.map((widget) => widget.id),
    hidden: DASHBOARD_WIDGETS.filter((widget) => widget.visibleByDefault === false).map((widget) => widget.id),
    spans: DASHBOARD_WIDGETS.reduce((acc, widget) => {
      acc[widget.id] = widget.defaultSpan ?? '1';
      return acc;
    }, {}),
  };
}

export function normalizeDashboardLayout(value) {
  const defaults = defaultDashboardLayout();
  const layout = value && typeof value === 'object' ? value : {};
  const order = Array.isArray(layout.order) ? layout.order : [];
  const hidden = Array.isArray(layout.hidden) ? layout.hidden : [];
  const spans = layout.spans && typeof layout.spans === 'object' ? layout.spans : {};
  const seen = new Set();
  const normalizedOrder = [];

  for (const id of order) {
    if (!DASHBOARD_WIDGET_IDS.has(id) || seen.has(id)) continue;
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
    if (!DASHBOARD_WIDGET_IDS.has(id) || hiddenSeen.has(id)) continue;
    hiddenSeen.add(id);
    normalizedHidden.push(id);
  }

  return {
    order: normalizedOrder,
    hidden: normalizedHidden,
    spans: DASHBOARD_WIDGETS.reduce((acc, widget) => {
      const value = String(spans[widget.id] ?? defaults.spans[widget.id] ?? '1');
      acc[widget.id] = DASHBOARD_WIDGET_SPANS.has(value) ? value : (defaults.spans[widget.id] ?? '1');
      return acc;
    }, {}),
  };
}

export function dashboardWidgetLabelMap(t) {
  return DASHBOARD_WIDGETS.reduce((acc, widget) => {
    acc[widget.id] = t(widget.labelKey);
    return acc;
  }, {});
}
