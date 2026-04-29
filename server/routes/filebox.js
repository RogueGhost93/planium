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
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { createLogger } from '../logger.js';
import * as db from '../db.js';

const log    = createLogger('Filebox');
const router = express.Router();
const execFileAsync = promisify(execFile);

// DATA_DIR > directory of DB_PATH > <repo>/data — keeps Filebox next to the DB
// in dev when no DATA_DIR is set, so we don't try to mkdir /data (EACCES).
function resolveDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.env.DB_PATH)  return path.dirname(process.env.DB_PATH);
  return path.join(import.meta.dirname, '..', '..', 'data');
}
const FILEBOX_ROOT = path.join(resolveDataDir(), 'filebox');
const GLOBAL_DIR   = path.join(FILEBOX_ROOT, 'global');
const SHARE_STAGING_DIR = path.join(FILEBOX_ROOT, '_share');
const MAX_FILE_BYTES = 50 * 1024 * 1024 * 1024; // 50 GiB
const IMAGE_THUMBNAIL_EXTS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'ico', 'avif', 'heic', 'heif', 'tif', 'tiff', 'svg',
]);
const PDF_THUMBNAIL_EXTS = new Set(['pdf']);
const VIDEO_THUMBNAIL_EXTS = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', 'ogv']);

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

function shareBatchIdForUser(userId) {
  return `${userId}-${randomUUID()}`;
}

function shareBatchDir(batchId) {
  return path.join(SHARE_STAGING_DIR, batchId);
}

/** Returns an absolute path inside scopeDir, or null if unsafe. */
function resolveInside(scopeDir, filename) {
  const safe = sanitizeFilename(filename);
  if (!safe) return null;
  const resolved = path.resolve(scopeDir, safe);
  if (!resolved.startsWith(path.resolve(scopeDir) + path.sep)) return null;
  return resolved;
}

function ensureShareBatch(req, res, next) {
  const batchId = shareBatchIdForUser(req.session.userId);
  const dir = shareBatchDir(batchId);
  req.shareBatch = { id: batchId, dir };
  try {
    ensureDir(dir);
    next();
  } catch (err) {
    next(err);
  }
}

function thumbnailKindFor(filename) {
  const ext = path.extname(filename || '').slice(1).toLowerCase();
  if (IMAGE_THUMBNAIL_EXTS.has(ext)) return 'image';
  if (PDF_THUMBNAIL_EXTS.has(ext)) return 'pdf';
  if (VIDEO_THUMBNAIL_EXTS.has(ext)) return 'video';
  return null;
}

async function renderPdfThumbnail(filePath, size) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'filebox-thumb-'));
  const basePath = path.join(tempDir, 'page');
  const pngPath = `${basePath}.png`;

  try {
    await execFileAsync('pdftoppm', [
      '-f', '1',
      '-singlefile',
      '-png',
      filePath,
      basePath,
    ]);

    return await (await import('sharp')).default(pngPath)
      .resize({ width: size, height: size, fit: 'cover', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function renderVideoThumbnail(filePath, size) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'filebox-thumb-'));
  const pngPath = path.join(tempDir, 'frame.png');

  try {
    let duration = 0;
    try {
      const probe = await execFileAsync('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath,
      ]);
      duration = Number.parseFloat(String(probe.stdout || '').trim()) || 0;
    } catch (err) {
      log.warn('thumbnail video probe failed', err.message);
    }

    const offset = duration > 0
      ? Math.min(Math.max(duration * 0.1, 0.5), Math.max(duration - 0.1, 0.5))
      : 0.5;

    try {
      await execFileAsync('ffmpeg', [
        '-y',
        '-ss', String(offset),
        '-i', filePath,
        '-frames:v', '1',
        '-an',
        '-loglevel', 'error',
        pngPath,
      ]);
    } catch (err) {
      log.warn('thumbnail video frame failed, retrying at start', err.message);
      await execFileAsync('ffmpeg', [
        '-y',
        '-ss', '0',
        '-i', filePath,
        '-frames:v', '1',
        '-an',
        '-loglevel', 'error',
        pngPath,
      ]);
    }

    return await (await import('sharp')).default(pngPath)
      .resize({ width: size, height: size, fit: 'cover', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
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

const shareStorage = multer.diskStorage({
  destination(req, _file, cb) {
    const batchDir = req.shareBatch?.dir;
    if (!batchDir) return cb(new Error('Missing share batch.'));
    try {
      ensureDir(batchDir);
      cb(null, batchDir);
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

const shareUpload = multer({ storage: shareStorage, limits: { fileSize: MAX_FILE_BYTES } });

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
// POST /api/v1/filebox/share-batches/:batch/commit
// Moves a staged web-share batch into private or global storage.
// --------------------------------------------------------
router.post('/share-batches/:batch/commit', (req, res) => {
  const batch = String(req.params.batch || '');
  const scope = req.body?.scope === 'private' ? 'private' : req.body?.scope === 'global' ? 'global' : null;
  if (!scope) return res.status(400).json({ error: 'Invalid scope.', code: 400 });

  const userPrefix = `${req.session.userId}-`;
  if (!batch.startsWith(userPrefix)) {
    return res.status(403).json({ error: 'Access denied.', code: 403 });
  }

  const sourceDir = shareBatchDir(batch);
  if (!fs.existsSync(sourceDir)) {
    return res.status(404).json({ error: 'Share batch not found.', code: 404 });
  }

  const userSlug = scope === 'private' ? lookupUsername(req.session.userId) : null;
  const targetDir = dirForScope(scope, userSlug);
  if (!targetDir) return res.status(400).json({ error: 'Invalid scope or user.', code: 400 });

  try {
    ensureDir(targetDir);
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true }).filter((e) => e.isFile());
    const files = [];

    for (const entry of entries) {
      const sourcePath = path.join(sourceDir, entry.name);
      const targetPath = path.join(targetDir, entry.name);
      if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { force: true });
      }
      fs.renameSync(sourcePath, targetPath);
      files.push(entry.name);
    }

    fs.rmSync(sourceDir, { recursive: true, force: true });
    log.info('share batch commit', { user: req.session.userId, batch, scope, count: files.length });
    res.json({ ok: true, scope, files });
  } catch (err) {
    log.error('share batch commit', err);
    res.status(500).json({ error: 'Could not finalize shared files.', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/filebox/share-batches/:batch
// Aborts a staged web-share batch.
// --------------------------------------------------------
router.delete('/share-batches/:batch', (req, res) => {
  const batch = String(req.params.batch || '');
  const userPrefix = `${req.session.userId}-`;
  if (!batch.startsWith(userPrefix)) {
    return res.status(403).json({ error: 'Access denied.', code: 403 });
  }

  const sourceDir = shareBatchDir(batch);
  try {
    if (fs.existsSync(sourceDir)) {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
    res.json({ ok: true });
  } catch (err) {
    log.error('share batch abort', err);
    res.status(500).json({ error: 'Could not discard shared files.', code: 500 });
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
// GET /api/v1/filebox/thumbnail/:scope/:filename?size=160
// Generates a small inline preview for image files.
// --------------------------------------------------------
router.get('/thumbnail/:scope/:filename', async (req, res) => {
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
  const kind = thumbnailKindFor(req.params.filename);
  if (!kind) {
    return res.status(404).json({ error: 'Not found.', code: 404 });
  }

  const sizeRaw = Number.parseInt(req.query.size, 10);
  const size = Number.isFinite(sizeRaw) ? Math.min(512, Math.max(64, sizeRaw)) : 160;

  try {
    let buffer;
    if (kind === 'image') {
      const sharpMod = await import('sharp');
      const sharp = sharpMod.default ?? sharpMod;
      buffer = await sharp(filePath)
        .rotate()
        .resize({ width: size, height: size, fit: 'cover', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
    } else if (kind === 'pdf') {
      buffer = await renderPdfThumbnail(filePath, size);
    } else if (kind === 'video') {
      buffer = await renderVideoThumbnail(filePath, size);
    }

    res.set({
      'Content-Type': 'image/webp',
      'Cache-Control': 'private, max-age=3600',
    });
    res.send(buffer);
  } catch (err) {
    log.warn('thumbnail', err.message);
    res.status(404).json({ error: 'Not found.', code: 404 });
  }
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
// Share routers — handle Web Share Target POSTs from the OS share sheet.
// Mounted OUTSIDE /api/v1 because Android share intents can't add
// X-CSRF-Token. CSRF protection: Origin header check + session auth.
// --------------------------------------------------------

function originCheck(req, res, next) {
  const origin = req.headers.origin;
  if (!origin || origin === 'null') return next();
  const host = req.headers.host;
  if (origin === `https://${host}` || origin === `http://${host}`) return next();
  log.warn('share denied: bad origin', { origin });
  res.status(403).send('Forbidden');
}

// Legacy file-only router — kept for PWA installs that still have the old
// manifest pointing at /filebox/share.
const shareRouter = express.Router();

shareRouter.post('/',
  originCheck,
  (req, res, next) => {
    if (!req.session?.userId) return res.redirect('/login?next=/filebox');
    if (!isFileboxEnabled(req.session.userId)) return res.redirect('/filebox?shared=disabled');
    next();
  },
  ensureShareBatch,
  shareUpload.array('files', 50),
  (req, res) => {
    const count = (req.files || []).length;
    log.info('share', { user: req.session.userId, count });
    res.redirect(`/filebox-share-picker?batch=${encodeURIComponent(req.shareBatch.id)}&count=${count}`);
  },
);

shareRouter.use((err, req, res, next) => {
  log.error('share error', err.message || err);
  res.redirect('/filebox?shared=error');
});

// Combined share router at /share — files go to filebox, URLs go to tasks.
const combinedShareRouter = express.Router();

combinedShareRouter.post('/',
  originCheck,
  (req, res, next) => {
    if (!req.session?.userId) return res.redirect('/login');
    if (!isFileboxEnabled(req.session.userId)) return res.redirect('/filebox?shared=disabled');
    next();
  },
  ensureShareBatch,
  shareUpload.array('files', 50),
  (req, res) => {
    const files = req.files || [];
    if (files.length > 0) {
      log.info('share files', { user: req.session.userId, count: files.length });
      return res.redirect(`/filebox-share-picker?batch=${encodeURIComponent(req.shareBatch.id)}&count=${files.length}`);
    }
    // URL/text-only share → picker page so user can choose task or bookmark.
    const url   = req.body?.url || req.body?.text || '';
    const title = req.body?.title || '';
    const params = new URLSearchParams();
    if (url)   params.set('shared_url',   url);
    if (title) params.set('shared_title', title);
    log.info('share link', { user: req.session.userId, url });
    res.redirect(`/share-picker?${params.toString()}`);
  },
);

combinedShareRouter.use((err, req, res, next) => {
  if (err.code === 'FILEBOX_DISABLED') return res.redirect('/filebox?shared=disabled');
  log.error('share error', err.message || err);
  res.redirect('/filebox?shared=error');
});

export default router;
export { shareRouter, combinedShareRouter };
