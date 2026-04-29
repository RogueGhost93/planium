/**
 * Modul: Mealie Integration
 * Zweck: Proxy-Routen zur Mealie-Instanz + Config-Management
 * Abhängigkeiten: express, server/db.js
 */

import express from 'express';
import * as db from '../db.js';
import { createLogger } from '../logger.js';

const log    = createLogger('Mealie');
const router = express.Router();

// --------------------------------------------------------
// Hilfsfunktionen
// --------------------------------------------------------

function getGlobalConfig() {
  const stmt = db.get().prepare('SELECT key, value FROM app_settings WHERE key IN (?, ?)');
  const rows = stmt.all('mealie_url', 'mealie_token');
  const map  = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { url: map.mealie_url || null, token: map.mealie_token || null };
}

function getUserOverride(userId) {
  if (!userId) return { url: null, token: null };
  const stmt = db.get().prepare(
    'SELECT key, value FROM user_settings WHERE user_id = ? AND key IN (?, ?)'
  );
  const rows = stmt.all(userId, 'mealie_url', 'mealie_token');
  const map  = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    url: map.mealie_url || null,
    token: map.mealie_token || null,
  };
}

function getConfig(userId) {
  const override = getUserOverride(userId);
  if (override.url || override.token) {
    return { url: override.url, token: override.token };
  }
  return { url: null, token: null };
}

async function mealieFetch(baseUrl, token, path, params = {}) {
  const qs  = new URLSearchParams(params).toString();
  const url = `${baseUrl}/api${path}${qs ? '?' + qs : ''}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const err  = new Error(`Mealie responded with ${res.status}`);
    err.status = res.status;
    throw err;
  }

  return res.json();
}

// --------------------------------------------------------
// GET /api/v1/mealie/status
// Gibt zurück ob Mealie konfiguriert ist.
// Response: { configured: bool, url: string|null }
// --------------------------------------------------------
router.get('/status', async (req, res) => {
  try {
    const { url, token } = getConfig(req.session.userId);
    if (!url || !token) {
      return res.json({ configured: false, url: null, groupSlug: null });
    }

    let groupSlug = null;
    try {
      const group = await mealieFetch(url, token, '/groups/self');
      groupSlug = group?.slug ?? null;
    } catch {
      // non-fatal — URL will fall back to /g/home/r/
    }

    res.json({ configured: true, url, groupSlug });
  } catch (err) {
    log.error('status', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/mealie/config  (Admin only)
// Body: { url, token }
// Response: { ok: true }
// --------------------------------------------------------
router.post('/config', (req, res) => {
  if (req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Admin required', code: 403 });
  }

  const { url, token } = req.body;
  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'url is required', code: 400 });
  }
  if (!token || typeof token !== 'string' || !token.trim()) {
    return res.status(400).json({ error: 'token is required', code: 400 });
  }

  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return res.status(400).json({ error: 'Invalid URL', code: 400 });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'URL must use http or https', code: 400 });
  }

  try {
    const upsert = db.get().prepare(`
      INSERT INTO app_settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    db.get().transaction(() => {
      upsert.run('mealie_url',   parsed.origin + parsed.pathname.replace(/\/$/, ''));
      upsert.run('mealie_token', token.trim());
    })();
    res.json({ ok: true });
  } catch (err) {
    log.error('config POST', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/mealie/config  (Admin only)
// Response: { ok: true }
// --------------------------------------------------------
router.delete('/config', (req, res) => {
  if (req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Admin required', code: 403 });
  }
  try {
    db.get().prepare("DELETE FROM app_settings WHERE key IN ('mealie_url', 'mealie_token')").run();
    res.json({ ok: true });
  } catch (err) {
    log.error('config DELETE', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/mealie/test
// Tests the connection by fetching one recipe.
// Response: { ok: true, count: N } | { ok: false, error: string }
// --------------------------------------------------------
router.get('/test', async (req, res) => {
  const { url, token } = getConfig(req.session.userId);
  if (!url || !token) {
    return res.json({ ok: false, error: 'Mealie is not configured.' });
  }
  try {
    const data = await mealieFetch(url, token, '/recipes', { page: 1, perPage: 1 });
    return res.json({ ok: true, count: data?.total ?? 0 });
  } catch (err) {
    const msg = err.status === 401 ? 'Invalid token (401)' : `Request failed: ${err.message}`;
    return res.json({ ok: false, error: msg });
  }
});

// --------------------------------------------------------
// GET /api/v1/mealie/recipes
// Query: ?search=&page=&perPage=
// Proxies to Mealie GET /api/recipes
// --------------------------------------------------------
router.get('/recipes', async (req, res) => {
  try {
    const { url, token } = getConfig(req.session.userId);
    if (!url || !token) {
      return res.status(503).json({ error: 'Mealie not configured', code: 503 });
    }

    const { search = '', page = 1, perPage = 32 } = req.query;
    const params = { page: parseInt(page, 10) || 1, perPage: parseInt(perPage, 10) || 32 };
    if (search) params.search = String(search).slice(0, 200);

    const data = await mealieFetch(url, token, '/recipes', params);
    res.json(data);
  } catch (err) {
    log.error('recipes GET', err);
    if (err.status === 401) return res.status(401).json({ error: 'Invalid Mealie token', code: 401 });
    res.status(502).json({ error: 'Could not reach Mealie', code: 502 });
  }
});

// --------------------------------------------------------
// GET /api/v1/mealie/recipes/:slug
// Proxies to Mealie GET /api/recipes/{slug}
// --------------------------------------------------------
router.get('/recipes/:slug', async (req, res) => {
  try {
    const { url, token } = getConfig(req.session.userId);
    if (!url || !token) {
      return res.status(503).json({ error: 'Mealie not configured', code: 503 });
    }

    const slug = req.params.slug;
    if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
      return res.status(400).json({ error: 'Invalid slug', code: 400 });
    }

    const data = await mealieFetch(url, token, `/recipes/${slug}`);
    res.json(data);
  } catch (err) {
    log.error('recipe detail GET', err);
    if (err.status === 404) return res.status(404).json({ error: 'Recipe not found', code: 404 });
    if (err.status === 401) return res.status(401).json({ error: 'Invalid Mealie token', code: 401 });
    res.status(502).json({ error: 'Could not reach Mealie', code: 502 });
  }
});

// --------------------------------------------------------
// GET /api/v1/mealie/my-config
// Returns the current user's configuration.
// Response: { url, token, configured }
// --------------------------------------------------------
router.get('/my-config', (req, res) => {
  try {
    const override = getUserOverride(req.session.userId);
    res.json({
      url: override.url,
      token: override.token ? '••••••' : null,
      configured: !!(override.url && override.token),
    });
  } catch (err) {
    log.error('my-config GET', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

// --------------------------------------------------------
// PUT /api/v1/mealie/my-config
// Body: { url?: string, token?: string }
// Omitted/empty url or token leaves the stored value alone.
// Response: { ok: true }
// --------------------------------------------------------
router.put('/my-config', (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.status(401).json({ error: 'Not logged in', code: 401 });

  const { url, token } = req.body ?? {};

  let normalizedUrl;
  if (url !== undefined && url !== null && String(url).trim()) {
    try {
      const parsed = new URL(String(url).trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return res.status(400).json({ error: 'URL must use http or https', code: 400 });
      }
      normalizedUrl = parsed.origin + parsed.pathname.replace(/\/$/, '');
    } catch {
      return res.status(400).json({ error: 'Invalid URL', code: 400 });
    }
  }

  try {
    const upsert = db.get().prepare(`
      INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
      ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
    `);
    const removeLegacyShared = db.get().prepare(
      "DELETE FROM user_settings WHERE user_id = ? AND key IN ('mealie_use_global', 'mealie_url', 'mealie_token')"
    );
    db.get().transaction(() => {
      removeLegacyShared.run(userId);
      if (normalizedUrl !== undefined) upsert.run(userId, 'mealie_url', normalizedUrl);
      if (token !== undefined && token !== null && String(token).trim()) {
        upsert.run(userId, 'mealie_token', String(token).trim());
      }
    })();
    res.json({ ok: true });
  } catch (err) {
    log.error('my-config PUT', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/mealie/my-config
// Clears the user's personal configuration.
// --------------------------------------------------------
router.delete('/my-config', (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.status(401).json({ error: 'Not logged in', code: 401 });
  try {
    db.get().prepare(
      "DELETE FROM user_settings WHERE user_id = ? AND key IN ('mealie_use_global', 'mealie_url', 'mealie_token')"
    ).run(userId);
    res.json({ ok: true });
  } catch (err) {
    log.error('my-config DELETE', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

export default router;
