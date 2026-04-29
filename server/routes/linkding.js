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

function getGlobalConfig() {
  const stmt = db.get().prepare('SELECT key, value FROM app_settings WHERE key IN (?, ?)');
  const rows = stmt.all('linkding_url', 'linkding_api_token');
  const map  = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { url: map.linkding_url || null, token: map.linkding_api_token || null };
}

function getUserOverride(userId) {
  if (!userId) return { url: null, token: null };
  const stmt = db.get().prepare(
    'SELECT key, value FROM user_settings WHERE user_id = ? AND key IN (?, ?)'
  );
  const rows = stmt.all(userId, 'linkding_url', 'linkding_api_token');
  const map  = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    url: map.linkding_url || null,
    token: map.linkding_api_token || null,
  };
}

function getConfig(userId) {
  const override = getUserOverride(userId);
  if (override.url || override.token) {
    return { url: override.url, token: override.token };
  }
  return { url: null, token: null };
}

// Exported for the bookmarks route, which also needs per-user creds.
export { getConfig as getLinkdingConfig };

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
    const { url, token } = getConfig(req.session.userId);
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
  const { url, token } = getConfig(req.session.userId);
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

// --------------------------------------------------------
// GET /api/v1/linkding/bookmarks
// Fetches bookmarks from Linkding with optional filters.
// Query: ?search=&tags=&limit=&offset=&unread=
// Response: { results: [], count: N }
// --------------------------------------------------------
router.get('/bookmarks', async (req, res) => {
  const { url, token } = getConfig(req.session.userId);
  if (!url || !token) {
    return res.status(503).json({ error: 'Linkding not configured', code: 503 });
  }

  try {
    const search = req.query.search ? String(req.query.search).slice(0, 200) : '';
    const tagsInput = req.query.tags ? (Array.isArray(req.query.tags) ? req.query.tags : [req.query.tags]) : [];
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const statusFilter = req.query.statusFilter || 'all';

    console.log('=== BOOKMARKS REQUEST ===');
    console.log('statusFilter:', statusFilter);
    console.log('search:', search);
    console.log('tags:', tagsInput);

    // Choose endpoint based on status filter
    // Linkding uses different endpoints for archived bookmarks
    let endpoint = '/bookmarks/';
    if (statusFilter === 'archived') {
      endpoint = '/bookmarks/archived/';
      console.log('Using archived endpoint');
    }

    let path = `${endpoint}?limit=${limit}&offset=${offset}`;

    // Build search query - combine search terms and tags using Linkding's query syntax
    let queryParts = [];
    if (search) {
      queryParts.push(search);
    }

    // Add tags using Linkding's #tagname syntax with AND logic
    if (tagsInput.length > 0) {
      tagsInput.forEach(tag => {
        if (tag && typeof tag === 'string') {
          queryParts.push(`#${tag}`);
        }
      });
    }

    // Handle unread/read filters
    // Linkding BookmarkSearch accepts unread parameter with values: "off", "yes", "no"
    if (statusFilter === 'unread') {
      path += '&unread=yes';
      console.log('Applied: unread=yes');
    } else if (statusFilter === 'read') {
      path += '&unread=no';
      console.log('Applied: unread=no');
    } else if (statusFilter === 'untagged') {
      // Use search syntax for untagged - requires ! prefix
      queryParts.push('!untagged');
      console.log('Applied: search filter !untagged');
    }

    // Add regular search queries if any
    if (queryParts.length > 0) {
      const fullQuery = queryParts.join(' and ');
      path += `&q=${encodeURIComponent(fullQuery)}`;
      console.log('Final search query:', fullQuery);
    }

    console.log('Final Linkding path:', path);
    const data = await linkdingFetch(url, token, path);
    console.log('Response count:', data?.count, '| results:', data?.results?.length);

    // Make favicon_url absolute using the Linkding base URL
    if (data?.results) {
      data.results = data.results.map(b => ({
        ...b,
        favicon_url: b.favicon_url
          ? (b.favicon_url.startsWith('http') ? b.favicon_url : `${url}${b.favicon_url}`)
          : null,
      }));
    }

    res.json(data);
  } catch (err) {
    log.error('bookmarks GET', err);
    if (err.status === 401) return res.status(401).json({ error: 'Invalid Linkding token', code: 401 });
    res.status(502).json({ error: 'Could not reach Linkding', code: 502 });
  }
});

// --------------------------------------------------------
// GET /api/v1/linkding/favicon?url=<encoded_url>
// Proxies a favicon from the Linkding instance (browser can't reach internal host).
// Only proxies URLs that belong to the configured Linkding instance (SSRF guard).
// --------------------------------------------------------
router.get('/favicon', async (req, res) => {
  const { url: baseUrl, token } = getConfig(req.session.userId);
  if (!baseUrl || !token) return res.status(503).end();

  const faviconUrl = req.query.url;
  if (!faviconUrl || typeof faviconUrl !== 'string') return res.status(400).end();

  if (!faviconUrl.startsWith(baseUrl)) return res.status(403).end();

  try {
    const imgRes = await fetch(faviconUrl, {
      headers: { Authorization: `Token ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!imgRes.ok) return res.status(404).end();

    const ct = imgRes.headers.get('content-type') || 'image/png';
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(await imgRes.arrayBuffer()));
  } catch {
    res.status(404).end();
  }
});

// --------------------------------------------------------
// GET /api/v1/linkding/tags
// Fetches all tags from Linkding.
// Response: [{ name: string, count: number }, ...]
// --------------------------------------------------------
router.get('/tags', async (req, res) => {
  const { url, token } = getConfig(req.session.userId);
  if (!url || !token) {
    return res.status(503).json({ error: 'Linkding not configured', code: 503 });
  }

  try {
    // Fetch all tags with pagination support
    let allTags = [];
    let limit = 200;
    let offset = 0;
    let pageCount = 0;
    let hasMore = true;

    while (hasMore) {
      const path = `/tags/?limit=${limit}&offset=${offset}`;
      console.log(`Backend - Fetching tags page, path: ${path}`);
      const data = await linkdingFetch(url, token, path);

      console.log(`Backend - Response type: ${typeof data}, isArray: ${Array.isArray(data)}, keys: ${Object.keys(data || {}).join(',')}`);

      const tags = Array.isArray(data) ? data : data.results ?? [];
      console.log(`Backend - Page ${pageCount}: got ${tags.length} tags, total so far: ${allTags.length + tags.length}`);

      if (tags.length === 0) {
        hasMore = false;
      } else {
        allTags = allTags.concat(tags);
        offset += limit;
        pageCount++;
        // Check if we got less than the limit (indicates last page)
        if (tags.length < limit) {
          hasMore = false;
        }
      }
    }

    console.log('Backend - Tags loaded, total count:', allTags.length, 'pages:', pageCount);
    res.json(allTags);
  } catch (err) {
    log.error('tags GET', err);
    if (err.status === 401) return res.status(401).json({ error: 'Invalid Linkding token', code: 401 });
    res.status(502).json({ error: 'Could not reach Linkding', code: 502 });
  }
});

// --------------------------------------------------------
// PATCH /api/v1/linkding/bookmarks/:id
// Updates a bookmark (url, title, description, tags, read status, archive, etc).
// Body: { url?: string, title?: string, description?: string, tag_names?: string[], unread?: bool, archived?: bool }
// Response: { success: true }
// --------------------------------------------------------
router.patch('/bookmarks/:id', async (req, res) => {
  const { url, token } = getConfig(req.session.userId);
  if (!url || !token) {
    return res.status(503).json({ error: 'Linkding not configured', code: 503 });
  }

  const bookmarkId = req.params.id;
  if (!bookmarkId || !/^\d+$/.test(bookmarkId)) {
    return res.status(400).json({ error: 'Invalid bookmark ID', code: 400 });
  }

  try {
    const body = {};

    // URL field
    if (req.body.url !== undefined) {
      if (typeof req.body.url !== 'string' || !req.body.url.trim()) {
        return res.status(400).json({ error: 'URL must be a non-empty string', code: 400 });
      }
      try {
        new URL(req.body.url.trim());
        body.url = req.body.url.trim();
      } catch {
        return res.status(400).json({ error: 'Invalid URL format', code: 400 });
      }
    }

    // Title field
    if (req.body.title !== undefined) {
      body.title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
    }

    // Description field
    if (req.body.description !== undefined) {
      body.description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
    }

    // Tags field - Linkding expects tag_names as array of strings
    if (req.body.tag_names !== undefined) {
      if (Array.isArray(req.body.tag_names)) {
        body.tag_names = req.body.tag_names
          .map(tag => (typeof tag === 'string' ? tag.trim() : ''))
          .filter(tag => tag.length > 0);
      } else {
        return res.status(400).json({ error: 'tag_names must be an array', code: 400 });
      }
    }

    // Status fields - Linkding uses is_archived and unread
    if (req.body.unread !== undefined) body.unread = !!req.body.unread;
    if (req.body.archived !== undefined) body.is_archived = !!req.body.archived;

    if (Object.keys(body).length === 0) {
      return res.status(400).json({ error: 'No fields to update', code: 400 });
    }

    console.log('PATCH request to Linkding:', `/bookmarks/${bookmarkId}/`, 'body:', body);
    const result = await linkdingFetch(url, token, `/bookmarks/${bookmarkId}/`, 'PATCH', body);
    console.log('PATCH response:', result);
    res.json({ success: true });
  } catch (err) {
    log.error('bookmark PATCH', err);
    if (err.status === 401) return res.status(401).json({ error: 'Invalid Linkding token', code: 401 });
    if (err.status === 404) return res.status(404).json({ error: 'Bookmark not found', code: 404 });
    res.status(502).json({ error: 'Could not reach Linkding', code: 502 });
  }
});

// --------------------------------------------------------
// POST /api/v1/linkding/bookmarks
// Creates a new bookmark.
// Body: { url: string, title?: string, description?: string, tag_names?: string[], unread?: bool }
// Response: { success: true, id: number }
// --------------------------------------------------------
router.post('/bookmarks', async (req, res) => {
  const { url, token } = getConfig(req.session.userId);
  if (!url || !token) {
    return res.status(503).json({ error: 'Linkding not configured', code: 503 });
  }
  const bookmarkUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  if (!bookmarkUrl) return res.status(400).json({ error: 'URL required', code: 400 });
  try { new URL(bookmarkUrl); } catch {
    return res.status(400).json({ error: 'Invalid URL', code: 400 });
  }
  const body = { url: bookmarkUrl };
  if (req.body.title)       body.title       = String(req.body.title).trim();
  if (req.body.description) body.description = String(req.body.description).trim();
  if (Array.isArray(req.body.tag_names)) {
    body.tag_names = req.body.tag_names.map(t => String(t).trim()).filter(Boolean);
  }
  if (req.body.unread !== undefined) body.unread = !!req.body.unread;
  try {
    const result = await linkdingFetch(url, token, '/bookmarks/', 'POST', body);
    res.json({ success: true, id: result.id });
  } catch (err) {
    log.error('bookmark POST', err);
    if (err.status === 401) return res.status(401).json({ error: 'Invalid Linkding token', code: 401 });
    res.status(502).json({ error: 'Could not reach Linkding', code: 502 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/linkding/bookmarks/:id
// Deletes a bookmark.
// Response: { success: true }
// --------------------------------------------------------
router.delete('/bookmarks/:id', async (req, res) => {
  const { url, token } = getConfig(req.session.userId);
  if (!url || !token) {
    return res.status(503).json({ error: 'Linkding not configured', code: 503 });
  }

  const bookmarkId = req.params.id;
  if (!bookmarkId || !/^\d+$/.test(bookmarkId)) {
    return res.status(400).json({ error: 'Invalid bookmark ID', code: 400 });
  }

  try {
    const deleteUrl = `${url}/api/bookmarks/${bookmarkId}/`;
    const res2 = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Token ${token}`,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res2.ok && res2.status !== 204) {
      const err = new Error(`Linkding responded with ${res2.status}`);
      err.status = res2.status;
      throw err;
    }

    res.json({ success: true });
  } catch (err) {
    log.error('bookmark DELETE', err);
    if (err.status === 401) return res.status(401).json({ error: 'Invalid Linkding token', code: 401 });
    if (err.status === 404) return res.status(404).json({ error: 'Bookmark not found', code: 404 });
    res.status(502).json({ error: 'Could not reach Linkding', code: 502 });
  }
});

// --------------------------------------------------------
// GET /api/v1/linkding/my-config
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
// PUT /api/v1/linkding/my-config
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
      "DELETE FROM user_settings WHERE user_id = ? AND key IN ('linkding_use_global', 'linkding_url', 'linkding_api_token')"
    );
    db.get().transaction(() => {
      removeLegacyShared.run(userId);
      if (normalizedUrl !== undefined) upsert.run(userId, 'linkding_url', normalizedUrl);
      if (token !== undefined && token !== null && String(token).trim()) {
        upsert.run(userId, 'linkding_api_token', String(token).trim());
      }
    })();
    res.json({ ok: true });
  } catch (err) {
    log.error('my-config PUT', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/linkding/my-config
// --------------------------------------------------------
router.delete('/my-config', (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.status(401).json({ error: 'Not logged in', code: 401 });
  try {
    db.get().prepare(
      "DELETE FROM user_settings WHERE user_id = ? AND key IN ('linkding_use_global', 'linkding_url', 'linkding_api_token')"
    ).run(userId);
    res.json({ ok: true });
  } catch (err) {
    log.error('my-config DELETE', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

export default router;
