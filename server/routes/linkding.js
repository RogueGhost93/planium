/**
 * Modul: Linkding Integration
 * Zweck: Proxy-Routen zur Linkding-Instanz + Config-Management
 * Abhängigkeiten: express, server/db.js
 */

import express from 'express';
import * as db from '../db.js';
import { createLogger } from '../logger.js';

const log    = createLogger('Linkding');
const router = express.Router();

// --------------------------------------------------------
// Hilfsfunktionen
// --------------------------------------------------------

function getConfig() {
  const stmt = db.get().prepare('SELECT key, value FROM app_settings WHERE key IN (?, ?)');
  const rows = stmt.all('linkding_url', 'linkding_api_token');
  const map  = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { url: map.linkding_url || null, token: map.linkding_api_token || null };
}

async function linkdingFetch(baseUrl, token, path, method = 'GET', body = null) {
  const url = `${baseUrl}/api${path}`;
  const options = {
    method,
    headers: {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);

  if (!res.ok) {
    const err  = new Error(`Linkding responded with ${res.status}`);
    err.status = res.status;
    throw err;
  }

  return res.json();
}

// --------------------------------------------------------
// GET /api/v1/linkding/status
// Returns whether Linkding is configured.
// Response: { configured: bool, url: string|null }
// --------------------------------------------------------
router.get('/status', async (req, res) => {
  try {
    const { url, token } = getConfig();
    if (!url || !token) {
      return res.json({ configured: false, url: null });
    }

    res.json({ configured: true, url });
  } catch (err) {
    log.error('status', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/linkding/config  (Admin only)
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
      upsert.run('linkding_url',   parsed.origin + parsed.pathname.replace(/\/$/, ''));
      upsert.run('linkding_api_token', token.trim());
    })();
    res.json({ ok: true });
  } catch (err) {
    log.error('config POST', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/linkding/config  (Admin only)
// Response: { ok: true }
// --------------------------------------------------------
router.delete('/config', (req, res) => {
  if (req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Admin required', code: 403 });
  }
  try {
    db.get().prepare("DELETE FROM app_settings WHERE key IN ('linkding_url', 'linkding_api_token')").run();
    res.json({ ok: true });
  } catch (err) {
    log.error('config DELETE', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/linkding/test
// Tests the connection by fetching one bookmark.
// Response: { ok: true, count: N } | { ok: false, error: string }
// --------------------------------------------------------
router.get('/test', async (req, res) => {
  const { url, token } = getConfig();
  if (!url || !token) {
    return res.json({ ok: false, error: 'Linkding is not configured.' });
  }
  try {
    const data = await linkdingFetch(url, token, '/bookmarks/?limit=1');
    return res.json({ ok: true, count: data?.count ?? 0 });
  } catch (err) {
    const msg = err.status === 401 ? 'Invalid token (401)' : `Request failed: ${err.message}`;
    return res.json({ ok: false, error: msg });
  }
});

export default router;
