/**
 * Modul: FreshRSS Integration
 * Zweck: Proxy-Routen zur FreshRSS-Instanz (Google Reader API) + Config-Management
 * Abhängigkeiten: express, server/db.js
 */

import express from 'express';
import * as db from '../db.js';
import { createLogger } from '../logger.js';

const log    = createLogger('FreshRSS');
const router = express.Router();

// Cache: Auth-Token (1h) und Headlines (15 min) — keyed by credentials
// so multiple users with different FreshRSS instances don't collide.
let tokenCache    = new Map(); // cacheKey -> { token, ts }
let headlineCache = new Map(); // `${cacheKey}:${limit}` -> { data, ts }
const TOKEN_TTL_MS    = 60 * 60 * 1000;
const HEADLINE_TTL_MS = 15 * 60 * 1000;

function cacheKeyFor(url, username) {
  return `${url}::${username}`;
}
const DEFAULT_HEADLINE_COUNT = 20;
const MAX_HEADLINE_COUNT     = 200;

// --------------------------------------------------------
// Hilfsfunktionen
// --------------------------------------------------------

function getGlobalConfig() {
  const stmt = db.get().prepare('SELECT key, value FROM app_settings WHERE key IN (?, ?, ?)');
  const rows = stmt.all('freshrss_url', 'freshrss_username', 'freshrss_password');
  const map  = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    url:      map.freshrss_url      || null,
    username: map.freshrss_username || null,
    password: map.freshrss_password || null,
  };
}

function getUserOverride(userId) {
  if (!userId) return { url: null, username: null, password: null };
  const stmt = db.get().prepare(
    'SELECT key, value FROM user_settings WHERE user_id = ? AND key IN (?, ?, ?)'
  );
  const rows = stmt.all(
    userId,
    'freshrss_url', 'freshrss_username', 'freshrss_password'
  );
  const map  = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    url:       map.freshrss_url      || null,
    username:  map.freshrss_username || null,
    password:  map.freshrss_password || null,
  };
}

function getConfig(userId) {
  const override = getUserOverride(userId);
  const hasOverride = override.url || override.username || override.password;
  if (hasOverride) {
    return { url: override.url, username: override.username, password: override.password };
  }
  return { url: null, username: null, password: null };
}

function parseHeadlineLimit(value) {
  const requested = Number.parseInt(value, 10);
  if (!Number.isFinite(requested)) return DEFAULT_HEADLINE_COUNT;
  return Math.min(MAX_HEADLINE_COUNT, Math.max(1, requested));
}

function plainText(value) {
  return String(value ?? '').replace(/<[^>]*>/g, '').trim();
}

function normalizeUrl(value) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function normalizeTimestamp(item) {
  const seconds = Number(item.published ?? item.updated);
  if (Number.isFinite(seconds) && seconds > 0) {
    return new Date(seconds * 1000).toISOString();
  }

  const msec = Number(item.crawlTimeMsec);
  if (Number.isFinite(msec) && msec > 0) {
    return new Date(msec).toISOString();
  }

  return null;
}

/**
 * Authenticate via GReader API and return an Auth token.
 * Caches the token for TOKEN_TTL_MS.
 */
async function getAuthToken(url, username, password) {
  const key = cacheKeyFor(url, username);
  const cached = tokenCache.get(key);
  if (cached?.token && Date.now() - cached.ts < TOKEN_TTL_MS) {
    return cached.token;
  }

  const { default: fetch } = await import('node-fetch');
  const loginUrl = `${url}/api/greader.php/accounts/ClientLogin`;
  const body     = new URLSearchParams({ Email: username, Passwd: password });

  const res = await fetch(loginUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
    signal:  AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    const err    = new Error(`FreshRSS login failed with status ${res.status}`);
    err.status   = res.status;
    throw err;
  }

  const text  = await res.text();
  const match = text.match(/^Auth=(.+)$/m);
  if (!match) {
    throw new Error('FreshRSS login response did not contain Auth token');
  }

  const token = match[1].trim();
  tokenCache.set(key, { token, ts: Date.now() });
  return token;
}

// --------------------------------------------------------
// GET /api/v1/freshrss/status
// Response: { configured: bool }
// --------------------------------------------------------
router.get('/status', (req, res) => {
  try {
    const { url, username, password } = getConfig(req.session.userId);
    res.json({ configured: !!(url && username && password) });
  } catch (err) {
    log.error('status', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/freshrss/config  (Admin only)
// Body: { url, username, password }
// Response: { ok: true }
// --------------------------------------------------------
router.post('/config', (req, res) => {
  if (req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Admin required', code: 403 });
  }

  const { url, username, password } = req.body;

  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'url is required', code: 400 });
  }
  if (!username || typeof username !== 'string' || !username.trim()) {
    return res.status(400).json({ error: 'username is required', code: 400 });
  }
  if (!password || typeof password !== 'string' || !password.trim()) {
    return res.status(400).json({ error: 'password is required', code: 400 });
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
      upsert.run('freshrss_url',      parsed.origin + parsed.pathname.replace(/\/$/, ''));
      upsert.run('freshrss_username', username.trim());
      upsert.run('freshrss_password', password.trim());
    })();

    // Invalidate caches on config change
    tokenCache.clear();
    headlineCache.clear();

    res.json({ ok: true });
  } catch (err) {
    log.error('config POST', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/freshrss/config  (Admin only)
// Response: { ok: true }
// --------------------------------------------------------
router.delete('/config', (req, res) => {
  if (req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Admin required', code: 403 });
  }
  try {
    db.get().prepare(
      "DELETE FROM app_settings WHERE key IN ('freshrss_url', 'freshrss_username', 'freshrss_password')"
    ).run();

    tokenCache.clear();
    headlineCache.clear();

    res.json({ ok: true });
  } catch (err) {
    log.error('config DELETE', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/freshrss/test
// Tests the connection and returns a human-readable result.
// Response: { ok: true, count: N } | { ok: false, error: string }
// --------------------------------------------------------
router.get('/test', async (req, res) => {
  const { url, username, password } = getConfig(req.session.userId);

  if (!url || !username || !password) {
    return res.json({ ok: false, error: 'FreshRSS is not configured.' });
  }

  try {
    // Force re-auth for the test (bypass token cache for this cred set)
    const key = cacheKeyFor(url, username);
    const savedToken = tokenCache.get(key);
    tokenCache.delete(key);
    let token;
    try {
      token = await getAuthToken(url, username, password);
    } catch (authErr) {
      if (savedToken) tokenCache.set(key, savedToken); // restore
      return res.json({ ok: false, error: `Login failed: ${authErr.message}` });
    }

    const { default: fetch } = await import('node-fetch');
    const streamUrl = `${url}/api/greader.php/reader/api/0/stream/contents/user/-/state/com.google/reading-list`
      + `?n=5&output=json`;

    const streamRes = await fetch(streamUrl, {
      headers: { Authorization: `GoogleLogin auth=${token}` },
      signal:  AbortSignal.timeout(8000),
    });

    if (!streamRes.ok) {
      return res.json({ ok: false, error: `Stream request failed with HTTP ${streamRes.status}` });
    }

    const json = await streamRes.json();
    const count = (json.items ?? []).length;
    return res.json({ ok: true, count });
  } catch (err) {
    log.warn('test GET:', err.message);
    return res.json({ ok: false, error: err.message });
  }
});

// --------------------------------------------------------
// GET /api/v1/freshrss/icon?domain=<hostname>
// Proxies a favicon from DuckDuckGo's ip3 service. Same-origin so it
// survives phone networks / browser shields that block icons.duckduckgo.com.
// Named /icon not /favicon to avoid Brave/uBlock filter-list rules matching "favicon".
// --------------------------------------------------------
router.get('/icon', async (req, res) => {
  const domain = req.query.domain;
  if (typeof domain !== 'string' || domain.length === 0 || domain.length > 253
      || !/^[a-z0-9.-]+$/i.test(domain)
      || domain.startsWith('.') || domain.endsWith('.')) {
    return res.status(400).end();
  }

  try {
    const { default: fetch } = await import('node-fetch');
    const imgRes = await fetch(`https://icons.duckduckgo.com/ip3/${domain}.ico`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!imgRes.ok) return res.status(404).setHeader('Cache-Control', 'no-store').end();

    const ct = imgRes.headers.get('content-type') || 'image/x-icon';
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(await imgRes.arrayBuffer()));
  } catch {
    res.status(404).setHeader('Cache-Control', 'no-store').end();
  }
});

// --------------------------------------------------------
// GET /api/v1/freshrss/headlines?limit=20
// Returns latest headlines from all feeds.
// Response: { data: [{ title, url, source, publishedAt }] } | { data: null }
// --------------------------------------------------------
router.get('/headlines', async (req, res) => {
  try {
    const { url, username, password } = getConfig(req.session.userId);
    const limit = parseHeadlineLimit(req.query.limit);

    if (!url || !username || !password) {
      return res.json({ data: null });
    }

    // Serve from cache if fresh — cache keyed per cred set + limit
    const key = `${cacheKeyFor(url, username)}:${limit}`;
    const cached = headlineCache.get(key);
    if (cached?.data && Date.now() - cached.ts < HEADLINE_TTL_MS) {
      return res.json({ data: cached.data });
    }

    const { default: fetch } = await import('node-fetch');
    const token = await getAuthToken(url, username, password);

    const streamUrl = `${url}/api/greader.php/reader/api/0/stream/contents/user/-/state/com.google/reading-list`
      + `?n=${limit}&output=json`;

    const streamRes = await fetch(streamUrl, {
      headers: { Authorization: `GoogleLogin auth=${token}` },
      signal:  AbortSignal.timeout(8000),
    });

    if (!streamRes.ok) {
      // Token may have expired — clear it so the next request re-authenticates
      if (streamRes.status === 401) tokenCache.delete(cacheKeyFor(url, username));
      log.warn(`Stream request failed: ${streamRes.status}`);
      return res.json({ data: null });
    }

    const json = await streamRes.json();
    const items = (json.items ?? []).map((item) => ({
      title:       plainText(item.title),
      url:         normalizeUrl(item.canonical?.[0]?.href ?? item.alternate?.[0]?.href),
      source:      plainText(item.origin?.title) || 'FreshRSS',
      sourceUrl:   normalizeUrl(item.origin?.htmlUrl),
      publishedAt: normalizeTimestamp(item),
    })).filter((h) => h.title);

    headlineCache.set(key, { data: items, ts: Date.now() });
    res.json({ data: items });
  } catch (err) {
    log.warn('headlines GET:', err.message);
    res.json({ data: null });
  }
});

// --------------------------------------------------------
// GET /api/v1/freshrss/my-config
// --------------------------------------------------------
router.get('/my-config', (req, res) => {
  try {
    const override = getUserOverride(req.session.userId);
    res.json({
      url: override.url,
      username: override.username,
      password: override.password ? '••••••' : null,
      configured: !!(override.url && override.username && override.password),
    });
  } catch (err) {
    log.error('my-config GET', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

// --------------------------------------------------------
// PUT /api/v1/freshrss/my-config
// Body: { url?, username?, password? }
// --------------------------------------------------------
router.put('/my-config', (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.status(401).json({ error: 'Not logged in', code: 401 });

  const { url, username, password } = req.body ?? {};

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
      "DELETE FROM user_settings WHERE user_id = ? AND key IN ('freshrss_use_global', 'freshrss_url', 'freshrss_username', 'freshrss_password')"
    );
    db.get().transaction(() => {
      removeLegacyShared.run(userId);
      if (normalizedUrl !== undefined) upsert.run(userId, 'freshrss_url', normalizedUrl);
      if (username !== undefined && username !== null && String(username).trim()) {
        upsert.run(userId, 'freshrss_username', String(username).trim());
      }
      if (password !== undefined && password !== null && String(password).trim()) {
        upsert.run(userId, 'freshrss_password', String(password).trim());
      }
    })();
    tokenCache.clear();
    headlineCache.clear();
    res.json({ ok: true });
  } catch (err) {
    log.error('my-config PUT', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/freshrss/my-config
// --------------------------------------------------------
router.delete('/my-config', (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.status(401).json({ error: 'Not logged in', code: 401 });
  try {
    db.get().prepare(
      "DELETE FROM user_settings WHERE user_id = ? AND key IN ('freshrss_use_global', 'freshrss_url', 'freshrss_username', 'freshrss_password')"
    ).run(userId);
    tokenCache.clear();
    headlineCache.clear();
    res.json({ ok: true });
  } catch (err) {
    log.error('my-config DELETE', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

export default router;
