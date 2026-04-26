/**
 * Modul: Filebox
 * Zweck: Einfacher Datei-Ablage: Global (alle Nutzer) + Privat (pro Nutzer)
 * Abhängigkeiten: express, multer, node:fs, server/db.js
 *
 * Speicher:
 *   /data/filebox/global/                 ← geteilt
 *   /data/filebox/{username}/             ← pro Nutzer (privat)
 *
 * Host-Bind-Mount möglich — Dateien, die direkt auf dem Host in die
 * entsprechenden Unterordner gelegt werden, erscheinen automatisch in der UI.
 */

import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createLogger } from '../logger.js';
import * as db from '../db.js';

const log    = createLogger('Filebox');
const router = express.Router();

// DATA_DIR > directory of DB_PATH > <repo>/data — keeps Filebox next to the DB
// in dev when no DATA_DIR is set, so we don't try to mkdir /data (EACCES).
function resolveDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.env.DB_PATH)  return path.dirname(process.env.DB_PATH);
  return path.join(import.meta.dirname, '..', '..', 'data');
}
const FILEBOX_ROOT = path.join(resolveDataDir(), 'filebox');
const GLOBAL_DIR   = path.join(FILEBOX_ROOT, 'global');
const MAX_FILE_BYTES = 50 * 1024 * 1024 * 1024; // 50 GiB

// --------------------------------------------------------
// Hilfsfunktionen
// --------------------------------------------------------

/** Lowercases + strips username to filesystem-safe chars. */
function sanitizeUsername(username) {
  return String(username || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

/** Rejects path traversal, slashes, null bytes, empty names. */
function sanitizeFilename(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed || trimmed === '.' || trimmed === '..') return null;
  if (/[/\\\0]/.test(trimmed)) return null;
  if (trimmed.includes('..')) return null;
  if (trimmed.length > 255) return null;
  return trimmed;
}

function lookupUsername(userId) {
  const row = db.get().prepare('SELECT username FROM users WHERE id = ?').get(userId);
  return row?.username ? sanitizeUsername(row.username) : null;
}

function dirForScope(scope, userSlug) {
  if (scope === 'global') return GLOBAL_DIR;
  if (scope === 'private' && userSlug) return path.join(FILEBOX_ROOT, userSlug);
  return null;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
}

/** Returns an absolute path inside scopeDir, or null if unsafe. */
function resolveInside(scopeDir, filename) {
  const safe = sanitizeFilename(filename);
  if (!safe) return null;
  const resolved = path.resolve(scopeDir, safe);
  if (!resolved.startsWith(path.resolve(scopeDir) + path.sep)) return null;
  return resolved;
}

function isFileboxEnabled(userId) {
  const row = db.get()
    .prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?')
    .get(userId, 'filebox_enabled');
  return row?.value === '1';
}

function requireEnabled(req, res, next) {
  if (!isFileboxEnabled(req.session.userId)) {
    return res.status(403).json({ error: 'Filebox is disabled for this user.', code: 403 });
  }
  next();
}

// --------------------------------------------------------
// Multer config — dynamic destination based on scope + user
// --------------------------------------------------------

const storage = multer.diskStorage({
  destination(req, _file, cb) {
    const scope    = req.query.scope === 'private' ? 'private' : 'global';
    const userSlug = scope === 'private' ? lookupUsername(req.session.userId) : null;
    const dir      = dirForScope(scope, userSlug);
    if (!dir) return cb(new Error('Invalid scope or user.'));
    try {
      ensureDir(dir);
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename(_req, file, cb) {
    const safe = sanitizeFilename(file.originalname);
    if (!safe) return cb(new Error('Invalid filename.'));
    cb(null, safe);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES },
});

// --------------------------------------------------------
// GET /api/v1/filebox/status
// Returns whether the feature is enabled for the current user.
// --------------------------------------------------------
router.get('/status', (req, res) => {
  res.json({ enabled: isFileboxEnabled(req.session.userId) });
});

// --------------------------------------------------------
// POST /api/v1/filebox/settings  { enabled: bool }
// Per-user opt-in toggle.
// --------------------------------------------------------
router.post('/settings', (req, res) => {
  const enabled = req.body?.enabled === true;
  db.get().prepare(`
    INSERT INTO user_settings (user_id, key, value)
    VALUES (?, 'filebox_enabled', ?)
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
  `).run(req.session.userId, enabled ? '1' : '0');

  // Lazily create this user's private dir on first enable so host operators
  // can bind-mount it immediately.
  if (enabled) {
    const userSlug = lookupUsername(req.session.userId);
    if (userSlug) {
      try {
        ensureDir(GLOBAL_DIR);
        ensureDir(path.join(FILEBOX_ROOT, userSlug));
      } catch (err) {
        log.warn('Could not create filebox dirs:', err.message);
      }
    }
  }

  res.json({ ok: true, enabled });
});

// All routes below require the user to have enabled the feature.
router.use(requireEnabled);

// --------------------------------------------------------
// GET /api/v1/filebox/files?scope=global|private
// Lists files with size + modified time.
// --------------------------------------------------------
router.get('/files', (req, res) => {
  const scope    = req.query.scope === 'private' ? 'private' : 'global';
  const userSlug = scope === 'private' ? lookupUsername(req.session.userId) : null;
  const dir      = dirForScope(scope, userSlug);
  if (!dir) return res.status(400).json({ error: 'Invalid scope.', code: 400 });

  try {
    ensureDir(dir);
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile())
      .map((e) => {
        const stat = fs.statSync(path.join(dir, e.name));
        return {
          name:       e.name,
          size:       stat.size,
          modifiedAt: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    res.json({ scope, files });
  } catch (err) {
    log.error('list', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/filebox/upload?scope=global|private
// Multipart upload. Field name: "file" (multiple allowed).
// --------------------------------------------------------
router.post('/upload', upload.array('file'), (req, res) => {
  const files = (req.files || []).map((f) => ({
    name: f.filename,
    size: f.size,
    mime: f.mimetype,
  }));
  log.info('upload', { scope: req.query.scope, count: files.length, files });
  res.json({ ok: true, files });
});

// --------------------------------------------------------
// POST /api/v1/filebox/upload-raw?scope=global|private&filename=foo.iso
// Raw-binary fallback for browsers/PWAs that mangle multipart uploads
// (notably Brave Android in standalone mode). Streams the request body
// straight to disk — no multer, no body parser involved.
// --------------------------------------------------------
router.post('/upload-raw', async (req, res) => {
  const scope    = req.query.scope === 'private' ? 'private' : 'global';
  const userSlug = scope === 'private' ? lookupUsername(req.session.userId) : null;
  const dir      = dirForScope(scope, userSlug);
  if (!dir) return res.status(400).json({ error: 'Invalid scope or user.', code: 400 });

  const safe = sanitizeFilename(req.query.filename);
  if (!safe) return res.status(400).json({ error: 'Invalid filename.', code: 400 });

  try {
    ensureDir(dir);
  } catch (err) {
    log.error('upload-raw mkdir', err.message);
    return res.status(500).json({ error: 'Storage error.', code: 500 });
  }

  const filePath = path.join(dir, safe);
  let bytes = 0;
  req.on('data', (chunk) => { bytes += chunk.length; });

  try {
    await pipeline(req, fs.createWriteStream(filePath));
    log.info('upload-raw', { scope, name: safe, size: bytes });
    res.json({ ok: true, files: [{ name: safe, size: bytes }] });
  } catch (err) {
    log.error('upload-raw', err.message);
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    res.status(500).json({ error: 'Upload failed.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/filebox/download/:scope/:filename
// Streams file as attachment. Name is validated inside scope dir.
// --------------------------------------------------------
router.get('/download/:scope/:filename', (req, res) => {
  const scope    = req.params.scope === 'private' ? 'private' : req.params.scope === 'global' ? 'global' : null;
  if (!scope) return res.status(400).json({ error: 'Invalid scope.', code: 400 });

  const userSlug = scope === 'private' ? lookupUsername(req.session.userId) : null;
  const dir      = dirForScope(scope, userSlug);
  if (!dir) return res.status(400).json({ error: 'Invalid scope.', code: 400 });

  const filePath = resolveInside(dir, req.params.filename);
  if (!filePath) return res.status(400).json({ error: 'Invalid filename.', code: 400 });
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return res.status(404).json({ error: 'Not found.', code: 404 });
  }

  res.download(filePath, req.params.filename, (err) => {
    if (err && !res.headersSent) {
      log.error('download', err);
      res.status(500).json({ error: 'Download failed', code: 500 });
    }
  });
});

// --------------------------------------------------------
// DELETE /api/v1/filebox/:scope/:filename
// --------------------------------------------------------
router.delete('/:scope/:filename', (req, res) => {
  const scope    = req.params.scope === 'private' ? 'private' : req.params.scope === 'global' ? 'global' : null;
  if (!scope) return res.status(400).json({ error: 'Invalid scope.', code: 400 });

  const userSlug = scope === 'private' ? lookupUsername(req.session.userId) : null;
  const dir      = dirForScope(scope, userSlug);
  if (!dir) return res.status(400).json({ error: 'Invalid scope.', code: 400 });

  const filePath = resolveInside(dir, req.params.filename);
  if (!filePath) return res.status(400).json({ error: 'Invalid filename.', code: 400 });
  if (!fs.existsSync(filePath)) return res.json({ ok: true }); // idempotent

  try {
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (err) {
    log.error('delete', err);
    res.status(500).json({ error: 'Delete failed', code: 500 });
  }
});

// --------------------------------------------------------
// Multer error handler (too large, etc.)
// --------------------------------------------------------
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message, code: 400 });
  }
  next(err);
});

// --------------------------------------------------------
// Share router — handles Web Share Target POSTs from the OS share sheet.
// Mounted at /filebox/share (NOT under /api/v1) because Android share intents
// can't add the X-CSRF-Token header. CSRF protection is provided by:
//   1. Origin header check — must be empty/null/own-origin (blocks cross-site
//      form POSTs from a malicious page; share intents have a null Origin).
//   2. Session auth — only logged-in users save files.
// Files default to the user's PRIVATE folder.
// --------------------------------------------------------
const shareRouter = express.Router();

function originCheck(req, res, next) {
  const origin = req.headers.origin;
  if (!origin || origin === 'null') return next();
  const host = req.headers.host;
  if (origin === `https://${host}` || origin === `http://${host}`) return next();
  log.warn('share denied: bad origin', { origin });
  res.status(403).send('Forbidden');
}

function requireAuthOrLogin(req, res, next) {
  if (req.session?.userId) return next();
  res.redirect('/login?next=/filebox');
}

shareRouter.post('/',
  originCheck,
  requireAuthOrLogin,
  (req, res, next) => {
    if (!isFileboxEnabled(req.session.userId)) {
      return res.redirect('/filebox?shared=disabled');
    }
    // Shared files land in the user's private folder by default.
    req.query.scope = 'private';
    next();
  },
  upload.array('files', 50),
  (req, res) => {
    const count = (req.files || []).length;
    log.info('share', { user: req.session.userId, count });
    res.redirect(`/filebox?shared=${count}`);
  },
);

shareRouter.use((err, req, res, next) => {
  log.error('share error', err.message || err);
  res.redirect('/filebox?shared=error');
});

export default router;
export { shareRouter };
