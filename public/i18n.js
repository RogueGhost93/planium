/**
 * i18n - Translation module (English only)
 * Provides t(), initI18n(), getLocale(), formatDate(), formatTime()
 */

let translations = {};

/** Load English translations on app start */
export async function initI18n() {
  const resp = await fetch('/locales/en.json');
  if (!resp.ok) throw new Error('Failed to load translations');
  translations = await resp.json();
  document.documentElement.lang = 'en';
}

/** Resolve dot-notation key in nested object */
function resolve(obj, key) {
  return key.split('.').reduce((o, k) => (o != null ? o[k] : undefined), obj);
}

/** Translate key with optional {{variable}} interpolation */
export function t(key, params = {}) {
  let str = resolve(translations, key) ?? key;
  for (const [k, v] of Object.entries(params)) {
    str = str.replaceAll(`{{${k}}}`, String(v));
  }
  return str;
}

/** Current locale */
export function getLocale() {
  return 'en';
}

/** Format date using browser locale */
export function formatDate(date) {
  if (date == null) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

/** Format time using browser locale */
export function formatTime(date) {
  if (date == null) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}
