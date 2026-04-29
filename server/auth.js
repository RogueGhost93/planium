/**
 * Modul: Authentifizierung (Auth)
 * Zweck: Login-Route, Session-Middleware, Auth-Guard für geschützte Routen
 * Abhängigkeiten: express, bcrypt, express-session, server/db.js
 */

import express from 'express';
import bcrypt from 'bcrypt';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import * as db from './db.js';
import { generateToken, csrfMiddleware } from './middleware/csrf.js';
import { createLogger } from './logger.js';
import { ensureHouseholdTaskList, shareHouseholdTaskListWithUser } from './services/task-lists.js';

const log = createLogger('Auth');
const router = express.Router();
const NAV_ORDER_KEY = 'main_nav_order';
const APPEARANCE_SYNC_KEY = 'appearance_sync';
const APPEARANCE_PRIORITY_KEY = 'appearance_priority_appearance';
const APPEARANCE_GREETING_WIDGET_ACCENT_FILL_KEY = 'appearance_greeting_widget_accent_fill';
const APPEARANCE_SHOW_QUOTES_KEY = 'appearance_show_quotes';
const APPEARANCE_SHOW_TICKERS_KEY = 'appearance_show_tickers';
const APPEARANCE_DAILY_ACCENT_KEY = 'appearance_daily_accent';
const APPEARANCE_DAILY_ACCENT_DATE_KEY = 'appearance_daily_accent_date';
const APPEARANCE_TICKER_LINK_KEY = 'appearance_ticker_btc_href';
const NAV_ORDER_PATHS = [
  '/',
  '/tasks',
  '/lists',
  '/notes',
  '/notebook',
  '/calendar',
  '/news',
  '/web',
  '/bookmarks',
  '/filebox',
  '/meals',
  '/contacts',
  '/settings',
];

// --------------------------------------------------------
// Session-Store (better-sqlite3, gleiche DB-Instanz wie App)
// Eigene Implementierung - kein connect-sqlite3 (nutzt sqlite3-Bindings,
// die separat kompiliert werden müssten und die Fehlerquelle waren).
// --------------------------------------------------------
class BetterSQLiteStore extends session.Store {
  constructor() {
    super();
    // Tabelle anlegen falls nicht vorhanden
    db.get().exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid        TEXT PRIMARY KEY,
        sess       TEXT NOT NULL,
        expired_at INTEGER NOT NULL
      )
    `);
    // Abgelaufene Sessions regelmäßig aufräumen (alle 15 Minuten)
    setInterval(() => {
      db.get().prepare('DELETE FROM sessions WHERE expired_at <= ?').run(Date.now());
    }, 15 * 60_000).unref();
  }

  get(sid, callback) {
    try {
      const row = db.get()
        .prepare('SELECT sess FROM sessions WHERE sid = ? AND expired_at > ?')
        .get(sid, Date.now());
      callback(null, row ? JSON.parse(row.sess) : null);
    } catch (err) {
      callback(err);
    }
  }

  set(sid, sess, callback) {
    try {
      const ttl = sess.cookie?.maxAge ?? 7 * 24 * 60 * 60 * 1000;
      const expiredAt = Date.now() + ttl;
      db.get()
        .prepare('INSERT OR REPLACE INTO sessions (sid, sess, expired_at) VALUES (?, ?, ?)')
        .run(sid, JSON.stringify(sess), expiredAt);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  destroy(sid, callback) {
    try {
      db.get().prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  touch(sid, sess, callback) {
    try {
      const ttl = sess.cookie?.maxAge ?? 7 * 24 * 60 * 60 * 1000;
      const expiredAt = Date.now() + ttl;
      db.get()
        .prepare('UPDATE sessions SET expired_at = ? WHERE sid = ?')
        .run(expiredAt, sid);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }
}

const sessionStore = new BetterSQLiteStore();

/**
 * Session-Middleware konfigurieren.
 * Wird in server/index.js eingebunden.
 */
if (!process.env.SESSION_SECRET) {
  throw new Error(
    '[Auth] SESSION_SECRET must be set in .env before starting the server.\n' +
    '       Generate one with: openssl rand -hex 32\n' +
    '       Then add SESSION_SECRET=<value> to your .env file.'
  );
}

const sessionMiddleware = session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: 'planium.sid',
  cookie: {
    httpOnly: true,
    // secure=true by default; set SESSION_SECURE=false in .env to allow HTTP (local dev without reverse proxy)
    secure: process.env.SESSION_SECURE !== 'false',
    // 'lax' lets the session cookie survive Web Share Target POST navigations
    // (Android share sheet → /filebox/share). CSRF token header still protects
    // all /api/v1 endpoints; cross-site form POSTs can't add custom headers.
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 Tage in ms
  },
});

// --------------------------------------------------------
// Rate Limiting für Login
// --------------------------------------------------------
const loginLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
  max: parseInt(process.env.RATE_LIMIT_MAX_ATTEMPTS) || 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait a moment.', code: 429 },
});

// --------------------------------------------------------
// Auth-Guard Middleware
// --------------------------------------------------------

/**
 * Prüft ob der Request authentifiziert ist.
 * Schützt alle API-Routen außer /auth/login.
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  res.status(401).json({ error: 'Not authenticated.', code: 401 });
}

/**
 * Prüft ob der authentifizierte User Admin-Rolle hat.
 */
function requireAdmin(req, res, next) {
  if (req.session && req.session.role === 'admin') {
    return next();
  }
  res.status(403).json({ error: 'Forbidden.', code: 403 });
}

function normalizeNavOrder(raw) {
  const source = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const order = [];
  for (const path of source) {
    if (!NAV_ORDER_PATHS.includes(path) || seen.has(path)) continue;
    seen.add(path);
    order.push(path);
  }
  for (const path of NAV_ORDER_PATHS) {
    if (seen.has(path)) continue;
    seen.add(path);
    order.push(path);
  }
  return order;
}

function readNavOrderForUser(userId) {
  const row = readUserSettings(userId, [NAV_ORDER_KEY])[NAV_ORDER_KEY];
  if (!row) return null;
  try {
    return normalizeNavOrder(JSON.parse(row));
  } catch {
    return null;
  }
}

function readUserSettings(userId, keys) {
  if (!keys.length) return {};
  const placeholders = keys.map(() => '?').join(', ');
  const rows = db.get()
    .prepare(`SELECT key, value FROM user_settings WHERE user_id = ? AND key IN (${placeholders})`)
    .all(userId, ...keys);
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

function upsertUserSettings(userId, entries) {
  const stmt = db.get().prepare(`
    INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
  `);

  for (const [key, value] of Object.entries(entries)) {
    if (value == null) continue;
    stmt.run(userId, key, String(value));
  }
}

function parseBoolSetting(value, defaultValue = false) {
  if (value == null) return defaultValue;
  return value === '1' || value === 'true' || value === true;
}

function readAppearanceSettingsForUser(userId) {
  const settings = readUserSettings(userId, [
    APPEARANCE_SYNC_KEY,
    APPEARANCE_PRIORITY_KEY,
    APPEARANCE_GREETING_WIDGET_ACCENT_FILL_KEY,
    APPEARANCE_SHOW_QUOTES_KEY,
    APPEARANCE_SHOW_TICKERS_KEY,
    APPEARANCE_DAILY_ACCENT_KEY,
    APPEARANCE_DAILY_ACCENT_DATE_KEY,
    APPEARANCE_TICKER_LINK_KEY,
  ]);

  return {
    appearance_sync: parseBoolSetting(settings[APPEARANCE_SYNC_KEY], false),
    appearance_priority_appearance: settings[APPEARANCE_PRIORITY_KEY] || 'accent',
    appearance_greeting_widget_accent_fill: parseBoolSetting(settings[APPEARANCE_GREETING_WIDGET_ACCENT_FILL_KEY], false),
    appearance_show_quotes: parseBoolSetting(settings[APPEARANCE_SHOW_QUOTES_KEY], true),
    appearance_show_tickers: parseBoolSetting(settings[APPEARANCE_SHOW_TICKERS_KEY], true),
    appearance_daily_accent: parseBoolSetting(settings[APPEARANCE_DAILY_ACCENT_KEY], false),
    appearance_daily_accent_date: settings[APPEARANCE_DAILY_ACCENT_DATE_KEY] || '',
    appearance_ticker_btc_href: settings[APPEARANCE_TICKER_LINK_KEY] || '',
  };
}

function buildPublicUser(user) {
  const publicUser = { ...user };
  delete publicUser.password_hash;
  publicUser.nav_order = readNavOrderForUser(user.id);
  Object.assign(publicUser, readAppearanceSettingsForUser(user.id));
  return publicUser;
}

// --------------------------------------------------------
// Routen
// --------------------------------------------------------

/**
 * Returns true if no admin account exists yet.
 * Used to gate the first-run /setup endpoint and the GUI redirect.
 */
function isSetupRequired() {
  const row = db.get()
    .prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
    .get();
  return !row;
}

/**
 * GET /api/v1/auth/setup-required
 * Response: { required: boolean }
 * Public — used by the SPA on boot to decide whether to redirect to /setup.
 */
router.get('/setup-required', (req, res) => {
  try {
    res.json({ required: isSetupRequired() });
  } catch (err) {
    log.error('Setup-Status-Fehler:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

/**
 * POST /api/v1/auth/setup
 * Body: { username, display_name, password }
 * Creates the first admin account. Hard-gated: rejected once any admin exists.
 * Public — no auth/CSRF, by design (no session yet on first run).
 */
router.post('/setup', loginLimiter, async (req, res) => {
  try {
    if (!isSetupRequired()) {
      return res.status(409).json({ error: 'Setup has already been completed.', code: 409 });
    }

    const { username, display_name, password } = req.body;

    if (!username || !display_name || !password) {
      return res.status(400).json({ error: 'Username, display name and password are required.', code: 400 });
    }

    if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username)) {
      return res.status(400).json({ error: 'Username must be 3-64 characters and may only contain letters, numbers, dots, hyphens and underscores.', code: 400 });
    }

    if (display_name.length > 128) {
      return res.status(400).json({ error: 'Display name must be 128 characters or fewer.', code: 400 });
    }

    if (password.length < 8 || password.length > 1024) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.', code: 400 });
    }

    const avatarColors = ['#007AFF', '#34C759', '#FF9500', '#FF3B30', '#AF52DE', '#FF2D55'];
    const avatarColor = avatarColors[Math.floor(Math.random() * avatarColors.length)];

    const hash = await bcrypt.hash(password, 12);

    const result = db.get()
      .prepare(`
        INSERT INTO users (username, display_name, password_hash, avatar_color, role)
        VALUES (?, ?, ?, ?, 'admin')
      `)
      .run(username, display_name, hash, avatarColor);

    ensureHouseholdTaskList(result.lastInsertRowid);

    res.status(201).json({
      user: {
        id: result.lastInsertRowid,
        username,
        display_name,
        avatar_color: avatarColor,
        role: 'admin',
      },
    });
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Username already taken.', code: 409 });
    }
    log.error('Setup-Fehler:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

/**
 * POST /api/v1/auth/login
 * Body: { username: string, password: string }
 * Response: { user: { id, username, display_name, avatar_color, role } }
 */
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.', code: 400 });
    }

    if (username.length > 64 || password.length > 1024) {
      return res.status(400).json({ error: 'Input too long.', code: 400 });
    }

    const user = db.get().prepare('SELECT * FROM users WHERE username = ?').get(username);

    if (!user) {
      // Timing-Attack-Schutz: trotzdem bcrypt ausführen
      await bcrypt.compare(password, '$2b$12$invalidhashfortimingprotection000000000000000000000');
      return res.status(401).json({ error: 'Invalid credentials.', code: 401 });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials.', code: 401 });
    }

    req.session.regenerate((err) => {
      if (err) {
        log.error('Session-Regenerierung fehlgeschlagen:', err);
        return res.status(500).json({ error: 'Internal server error.', code: 500 });
      }

      req.session.userId    = user.id;
      req.session.role      = user.role;
      req.session.csrfToken = generateToken();

      // CSRF-Token als Cookie setzen (nicht httpOnly → lesbar für JS)
      res.cookie('csrf-token', req.session.csrfToken, {
        httpOnly: false,
        sameSite: 'strict',
        secure: process.env.SESSION_SECURE !== 'false',
        maxAge: 1000 * 60 * 60 * 24 * 7,
      });

      res.json({ user: buildPublicUser(user) });
    });
  } catch (err) {
    log.error('Login-Fehler:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

/**
 * POST /api/v1/auth/logout
 * Response: { ok: true }
 */
router.post('/logout', requireAuth, csrfMiddleware, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      log.error('Logout-Fehler:', err);
      return res.status(500).json({ error: 'Logout failed.', code: 500 });
    }
    res.clearCookie('planium.sid');
    res.json({ ok: true });
  });
});

/**
 * GET /api/v1/auth/me
 * Response: { user: { id, username, display_name, avatar_color, role } }
 */
router.get('/me', requireAuth, (req, res) => {
  try {
    const user = db.get()
      .prepare('SELECT id, username, display_name, avatar_color, role, theme, accent, quick_link, notify_popup, notify_sound, notify_time, notify_interval, notify_tone FROM users WHERE id = ?')
      .get(req.session.userId);

    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'User not found.', code: 401 });
    }

    res.json({ user: buildPublicUser(user) });
  } catch (err) {
    log.error('/me Fehler:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

/**
 * GET /api/v1/auth/users
 * Admin only. Listet alle Familienmitglieder.
 * Response: { data: User[] }
 */
router.get('/users', requireAuth, requireAdmin, (req, res) => {
  try {
    const users = db.get()
      .prepare('SELECT id, username, display_name, avatar_color, role, created_at FROM users ORDER BY display_name')
      .all();
    res.json({ data: users });
  } catch (err) {
    log.error('Users-Fehler:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

/**
 * POST /api/v1/auth/users
 * Admin only. Erstellt neues Familienmitglied.
 * Body: { username, display_name, password, avatar_color?, role? }
 * Response: { user: { id, username, display_name, avatar_color, role } }
 */
router.post('/users', requireAuth, requireAdmin, csrfMiddleware, async (req, res) => {
  try {
    const { username, display_name, password, avatar_color = '#007AFF', role = 'member' } = req.body;

    if (!username || !display_name || !password) {
      return res.status(400).json({ error: 'Username, display name and password are required.', code: 400 });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.', code: 400 });
    }

    if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username)) {
      return res.status(400).json({ error: 'Username must be 3-64 characters and may only contain letters, numbers, dots, hyphens and underscores.', code: 400 });
    }

    if (display_name.length > 128) {
      return res.status(400).json({ error: 'Display name must be 128 characters or fewer.', code: 400 });
    }

    if (!['admin', 'member'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role.', code: 400 });
    }

    const hash = await bcrypt.hash(password, 12);

    const result = db.get()
      .prepare(`
        INSERT INTO users (username, display_name, password_hash, avatar_color, role)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(username, display_name, hash, avatar_color, role);

    shareHouseholdTaskListWithUser(result.lastInsertRowid);

    res.status(201).json({
      user: { id: result.lastInsertRowid, username, display_name, avatar_color, role },
    });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Username already taken.', code: 409 });
    }
    log.error('User-Erstellen-Fehler:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

/**
 * PATCH /api/v1/auth/me/password
 * Ändert das eigene Passwort.
 * Body: { current_password: string, new_password: string }
 * Response: { ok: true }
 */
router.patch('/me/preferences', requireAuth, csrfMiddleware, (req, res) => {
  const VALID_THEMES  = ['system', 'light', 'dark', 'obsidian', 'midnight-forest', 'noir', 'deep-ocean', 'aubergine', 'parchment', 'frost', 'glacier', 'arctic'];
  const VALID_ACCENTS = ['blue', 'indigo', 'violet', 'purple', 'pink', 'rose', 'red', 'orange', 'amber', 'gold', 'lime', 'green', 'teal', 'cyan', 'sky', 'slate'];
  const VALID_TONES   = ['short', 'default', 'long', 'gentle', 'alert'];
  const VALID_PRIORITY = ['accent', 'flags', 'both'];
  const {
    theme,
    accent,
    quick_link,
    notify_popup,
    notify_sound,
    notify_time,
    notify_interval,
    notify_tone,
    nav_order,
    appearance_sync,
    appearance_priority_appearance,
    appearance_greeting_widget_accent_fill,
    appearance_show_quotes,
    appearance_show_tickers,
    appearance_daily_accent,
    appearance_daily_accent_date,
    appearance_ticker_btc_href,
  } = req.body;
  if (theme  && !VALID_THEMES.includes(theme))   return res.status(400).json({ error: 'Invalid theme.',  code: 400 });
  if (accent && !VALID_ACCENTS.includes(accent))  return res.status(400).json({ error: 'Invalid accent.', code: 400 });
  if (notify_time != null && !/^\d{2}:\d{2}$/.test(notify_time)) return res.status(400).json({ error: 'Invalid notify_time.', code: 400 });
  if (notify_interval != null && (typeof notify_interval !== 'number' || notify_interval < 1 || notify_interval > 24)) return res.status(400).json({ error: 'Invalid notify_interval.', code: 400 });
  if (notify_tone != null && !VALID_TONES.includes(notify_tone)) return res.status(400).json({ error: 'Invalid notify_tone.', code: 400 });
  if (appearance_priority_appearance != null && !VALID_PRIORITY.includes(appearance_priority_appearance)) {
    return res.status(400).json({ error: 'Invalid appearance priority.', code: 400 });
  }
  if (appearance_ticker_btc_href != null && String(appearance_ticker_btc_href).length > 2048) {
    return res.status(400).json({ error: 'Ticker link is too long.', code: 400 });
  }
  if (nav_order != null && (!Array.isArray(nav_order) || nav_order.some((path) => !NAV_ORDER_PATHS.includes(path)))) {
    return res.status(400).json({ error: 'Invalid nav_order.', code: 400 });
  }
  const updates = []; const params = [];
  if (theme)  { updates.push('theme = ?');  params.push(theme);  }
  if (accent) { updates.push('accent = ?'); params.push(accent); }
  if (quick_link != null) { updates.push('quick_link = ?'); params.push(String(quick_link).slice(0, 2048)); }
  if (notify_popup != null)    { updates.push('notify_popup = ?');    params.push(notify_popup ? 1 : 0); }
  if (notify_sound != null)    { updates.push('notify_sound = ?');    params.push(notify_sound ? 1 : 0); }
  if (notify_time != null)     { updates.push('notify_time = ?');     params.push(notify_time); }
  if (notify_interval != null) { updates.push('notify_interval = ?'); params.push(notify_interval); }
  if (notify_tone != null)     { updates.push('notify_tone = ?');     params.push(notify_tone); }
  if (appearance_sync != null) {
    upsertUserSettings(req.session.userId, {
      [APPEARANCE_SYNC_KEY]: appearance_sync ? '1' : '0',
    });
  }
  upsertUserSettings(req.session.userId, {
    ...(appearance_priority_appearance != null ? { [APPEARANCE_PRIORITY_KEY]: appearance_priority_appearance } : {}),
    ...(appearance_greeting_widget_accent_fill != null ? { [APPEARANCE_GREETING_WIDGET_ACCENT_FILL_KEY]: appearance_greeting_widget_accent_fill ? '1' : '0' } : {}),
    ...(appearance_show_quotes != null ? { [APPEARANCE_SHOW_QUOTES_KEY]: appearance_show_quotes ? '1' : '0' } : {}),
    ...(appearance_show_tickers != null ? { [APPEARANCE_SHOW_TICKERS_KEY]: appearance_show_tickers ? '1' : '0' } : {}),
    ...(appearance_daily_accent != null ? { [APPEARANCE_DAILY_ACCENT_KEY]: appearance_daily_accent ? '1' : '0' } : {}),
    ...(appearance_daily_accent_date != null ? { [APPEARANCE_DAILY_ACCENT_DATE_KEY]: appearance_daily_accent_date } : {}),
    ...(appearance_ticker_btc_href != null ? { [APPEARANCE_TICKER_LINK_KEY]: String(appearance_ticker_btc_href).slice(0, 2048) } : {}),
  });
  if (updates.length) {
    params.push(req.session.userId);
    db.get().prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }
  if (nav_order != null) {
    const normalizedNavOrder = normalizeNavOrder(nav_order);
    db.get().prepare(`
      INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
      ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
    `).run(req.session.userId, NAV_ORDER_KEY, JSON.stringify(normalizedNavOrder));
  }
  res.json({ ok: true });
});

router.patch('/me/password', requireAuth, csrfMiddleware, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Current and new password are required.', code: 400 });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.', code: 400 });
    }

    const user = db.get().prepare('SELECT password_hash FROM users WHERE id = ?').get(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found.', code: 404 });

    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect.', code: 401 });

    const hash = await bcrypt.hash(new_password, 12);
    db.get().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.session.userId);

    // Alle anderen Sessions dieses Users invalidieren (aktuelle behalten)
    const currentSid = req.sessionID;
    const allSessions = db.get().prepare('SELECT sid, sess FROM sessions').all();
    for (const row of allSessions) {
      if (row.sid === currentSid) continue;
      try {
        const sess = JSON.parse(row.sess);
        if (sess.userId === req.session.userId) {
          db.get().prepare('DELETE FROM sessions WHERE sid = ?').run(row.sid);
        }
      } catch { /* ignore malformed session */ }
    }

    res.json({ ok: true });
  } catch (err) {
    log.error('Passwort-Aendern-Fehler:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.post('/me/verify-password', requireAuth, csrfMiddleware, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Password is required.', code: 400 });
    }

    const user = db.get().prepare('SELECT password_hash FROM users WHERE id = ?').get(req.session.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.', code: 404 });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Password is incorrect.', code: 401 });
    }

    res.json({ ok: true });
  } catch (err) {
    log.error('Passwort-Verifikation fehlgeschlagen:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

/**
 * DELETE /api/v1/auth/users/:id
 * Admin only. Löscht ein Familienmitglied.
 * Response: { ok: true }
 */
router.delete('/users/:id', requireAuth, requireAdmin, csrfMiddleware, (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);

    if (userId === req.session.userId) {
      return res.status(400).json({ error: 'Cannot delete your own account.', code: 400 });
    }

    const result = db.get().prepare('DELETE FROM users WHERE id = ?').run(userId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'User not found.', code: 404 });
    }

    // Alle aktiven Sessions des geloeschten Users invalidieren
    const allSessions = db.get().prepare('SELECT sid, sess FROM sessions').all();
    for (const row of allSessions) {
      try {
        const sess = JSON.parse(row.sess);
        if (sess.userId === userId) {
          db.get().prepare('DELETE FROM sessions WHERE sid = ?').run(row.sid);
        }
      } catch { /* ignore malformed session */ }
    }

    res.json({ ok: true });
  } catch (err) {
    log.error('User-Loeschen-Fehler:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

export { router, sessionMiddleware, requireAuth, requireAdmin };
