import { randomUUID } from 'crypto';
import * as db from '../db.js';

const SETTINGS_KEY = 'webview_items';
const LEGACY_KEY = 'webview_url';

function normalizeWebviewUrl(rawUrl) {
  const value = (rawUrl ?? '').trim();
  if (!value) return null;

  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function normalizeWebviewName(rawUrl, rawName) {
  const name = (rawName ?? '').trim();
  if (name) return name;
  try {
    return new URL(rawUrl).hostname.replace(/^www\./i, '') || 'Website';
  } catch {
    return 'Website';
  }
}

function normalizeWebviewItem(item, index = 0) {
  const url = normalizeWebviewUrl(item?.url);
  if (!url) return null;

  return {
    id: String(item?.id ?? '').trim() || randomUUID(),
    name: normalizeWebviewName(url, item?.name),
    url,
    show_in_tabs: item?.show_in_tabs === false || item?.showInTabs === false ? false : true,
    sort_order: Number.isFinite(Number(item?.sort_order)) ? Number(item.sort_order) : index,
  };
}

function readStoredItems() {
  const row = db.get().prepare(`SELECT value FROM app_settings WHERE key = ?`).get(SETTINGS_KEY);
  if (row?.value) {
    try {
      const parsed = JSON.parse(row.value);
      if (Array.isArray(parsed)) {
        return parsed.map((item, index) => normalizeWebviewItem(item, index)).filter(Boolean);
      }
    } catch {
      // fall through to legacy/env fallback
    }
  }

  const legacyRow = db.get().prepare(`SELECT value FROM app_settings WHERE key = ?`).get(LEGACY_KEY);
  const legacyUrl = normalizeWebviewUrl(legacyRow?.value);
  if (legacyUrl) {
    return [{
      id: randomUUID(),
      name: 'Website',
      url: legacyUrl,
      show_in_tabs: true,
      sort_order: 0,
    }];
  }

  const envUrl = normalizeWebviewUrl(process.env.PLANIUM_WEBVIEW_URL);
  if (envUrl) {
    return [{
      id: randomUUID(),
      name: 'Website',
      url: envUrl,
      show_in_tabs: true,
      sort_order: 0,
    }];
  }

  return [];
}

function persistItems(items) {
  const normalized = items
    .map((item, index) => normalizeWebviewItem(item, index))
    .filter(Boolean)
    .map((item, index) => ({ ...item, sort_order: index }));

  const stmt = db.get().prepare(`
    INSERT INTO app_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  if (!normalized.length) {
    db.get().prepare('DELETE FROM app_settings WHERE key IN (?, ?)').run(SETTINGS_KEY, LEGACY_KEY);
    return [];
  }

  stmt.run(SETTINGS_KEY, JSON.stringify(normalized));
  db.get().prepare('DELETE FROM app_settings WHERE key = ?').run(LEGACY_KEY);
  return normalized;
}

export function getWebviewItems() {
  return readStoredItems().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

export function getWebviewConfig() {
  const items = getWebviewItems();
  const origins = [...new Set(items.map((item) => {
    try {
      return new URL(item.url).origin;
    } catch {
      return null;
    }
  }).filter(Boolean))];
  return {
    configured: items.length > 0,
    items,
    origins,
  };
}

export function getWebviewOrigins() {
  return getWebviewConfig().origins;
}

export function getWebviewUrl() {
  return getWebviewItems()[0]?.url ?? null;
}

export function getWebviewOrigin() {
  return getWebviewOrigins()[0] ?? null;
}

export function setWebviewItems(items) {
  if (Array.isArray(items)) {
    return persistItems(items);
  }

  if (typeof items === 'string') {
    const url = normalizeWebviewUrl(items);
    if (!url) {
      return persistItems([]);
    }
    return persistItems([{ name: 'Website', url, show_in_tabs: true }]);
  }

  return persistItems([]);
}

export function replaceWebviewItems(items) {
  return persistItems(items);
}
