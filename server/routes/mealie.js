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

function getConfig() {
  const stmt = db.get().prepare('SELECT key, value FROM app_settings WHERE key IN (?, ?)');
  const rows = stmt.all('mealie_url', 'mealie_token');
  const map  = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { url: map.mealie_url || null, token: map.mealie_token || null };
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
    const { url, token } = getConfig();
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
// GET /api/v1/mealie/recipes
// Query: ?search=&page=&perPage=
// Proxies to Mealie GET /api/recipes
// --------------------------------------------------------
router.get('/recipes', async (req, res) => {
  try {
    const { url, token } = getConfig();
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
    const { url, token } = getConfig();
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

export default router;
