/**
 * Modul: Kalender (Calendar)
 * Zweck: REST-API-Routen für Kalendereinträge (lokale Termine)
 *        Externe Sync (Google/Apple) folgt in Phase 3, Schritte 14–15.
 * Abhängigkeiten: express, server/db.js, server/auth.js
 */

'use strict';

const express        = require('express');
const router         = express.Router();
const db             = require('../db');
const googleCalendar = require('../services/google-calendar');
const appleCalendar  = require('../services/apple-calendar');
const { requireAdmin } = require('../auth');

const VALID_SOURCES = ['local', 'google', 'apple'];
const DATETIME_RE   = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?Z?)?$/;
const DATE_RE       = /^\d{4}-\d{2}-\d{2}$/;
const COLOR_RE      = /^#[0-9A-Fa-f]{6}$/;

// --------------------------------------------------------
// GET /api/v1/calendar
// Termine in einem Datumsbereich abrufen.
// Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD  (default: aktueller Monat)
//        &assigned_to=<userId>  (optional Filter)
//        &source=local|google|apple  (optional Filter)
// Response: { data: Event[], from, to }
// --------------------------------------------------------
router.get('/', (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const year  = today.slice(0, 4);
    const month = today.slice(5, 7);

    const from = req.query.from || `${year}-${month}-01`;
    const to   = req.query.to   || `${year}-${month}-31`;

    if (!DATE_RE.test(from) || !DATE_RE.test(to))
      return res.status(400).json({ error: 'from/to müssen YYYY-MM-DD sein', code: 400 });

    let sql = `
      SELECT e.*,
             u_assigned.display_name AS assigned_name,
             u_assigned.avatar_color AS assigned_color,
             u_created.display_name  AS creator_name
      FROM calendar_events e
      LEFT JOIN users u_assigned ON u_assigned.id = e.assigned_to
      LEFT JOIN users u_created  ON u_created.id  = e.created_by
      WHERE (
        DATE(e.start_datetime) <= ? AND
        (e.end_datetime IS NULL OR DATE(e.end_datetime) >= ?)
      )
    `;
    const params = [to, from];

    if (req.query.assigned_to) {
      sql += ' AND e.assigned_to = ?';
      params.push(parseInt(req.query.assigned_to, 10));
    }

    if (req.query.source && VALID_SOURCES.includes(req.query.source)) {
      sql += ' AND e.external_source = ?';
      params.push(req.query.source);
    }

    sql += ' ORDER BY e.start_datetime ASC, e.all_day DESC';

    const events = db.get().prepare(sql).all(...params);
    res.json({ data: events, from, to });
  } catch (err) {
    console.error('[calendar/GET /]', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/calendar/upcoming
// Nächste N Termine ab jetzt (für Dashboard-Widget).
// Query: ?limit=5
// Response: { data: Event[] }
// --------------------------------------------------------
router.get('/upcoming', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 5, 20);
    const now   = new Date().toISOString();

    const events = db.get().prepare(`
      SELECT e.*,
             u_assigned.display_name AS assigned_name,
             u_assigned.avatar_color AS assigned_color
      FROM calendar_events e
      LEFT JOIN users u_assigned ON u_assigned.id = e.assigned_to
      WHERE e.start_datetime >= ?
      ORDER BY e.start_datetime ASC
      LIMIT ?
    `).all(now, limit);

    res.json({ data: events });
  } catch (err) {
    console.error('[calendar/GET /upcoming]', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

// --------------------------------------------------------
// Google Calendar Sync-Routen
// Alle vor /:id registriert, um Konflikte zu vermeiden.
// --------------------------------------------------------

/**
 * GET /api/v1/calendar/google/auth
 * Admin only. Leitet zum Google OAuth-Consent-Screen weiter.
 */
router.get('/google/auth', requireAdmin, (req, res) => {
  try {
    const url = googleCalendar.getAuthUrl();
    if (!url) return res.status(503).json({ error: 'Google nicht konfiguriert.', code: 503 });
    res.redirect(url);
  } catch (err) {
    console.error('[calendar/google/auth]', err);
    res.status(503).json({ error: err.message, code: 503 });
  }
});

/**
 * GET /api/v1/calendar/google/callback
 * OAuth-Callback von Google. Tauscht Code gegen Tokens und startet initialen Sync.
 * Query: ?code=...
 */
router.get('/google/callback', async (req, res) => {
  try {
    const { code, error } = req.query;
    if (error) return res.redirect('/settings?sync_error=google');
    if (!code)  return res.status(400).json({ error: 'Kein Code erhalten.', code: 400 });

    await googleCalendar.handleCallback(code);

    // Initialen Sync im Hintergrund starten (kein await — Redirect soll sofort erfolgen)
    googleCalendar.sync().catch((e) => console.error('[Google] Initialer Sync fehlgeschlagen:', e.message));

    res.redirect('/settings?sync_ok=google');
  } catch (err) {
    console.error('[calendar/google/callback]', err);
    res.redirect('/settings?sync_error=google');
  }
});

/**
 * POST /api/v1/calendar/google/sync
 * Manueller Sync-Trigger.
 * Response: { ok: true, lastSync: string }
 */
router.post('/google/sync', async (req, res) => {
  try {
    await googleCalendar.sync();
    const { lastSync } = googleCalendar.getStatus();
    res.json({ ok: true, lastSync });
  } catch (err) {
    console.error('[calendar/google/sync]', err);
    res.status(500).json({ error: err.message, code: 500 });
  }
});

/**
 * GET /api/v1/calendar/google/status
 * Response: { configured, connected, lastSync }
 */
router.get('/google/status', (req, res) => {
  try {
    res.json(googleCalendar.getStatus());
  } catch (err) {
    console.error('[calendar/google/status]', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

/**
 * DELETE /api/v1/calendar/google/disconnect
 * Admin only. Tokens löschen und Verbindung trennen.
 * Response: { ok: true }
 */
router.delete('/google/disconnect', requireAdmin, (req, res) => {
  try {
    googleCalendar.disconnect();
    res.json({ ok: true });
  } catch (err) {
    console.error('[calendar/google/disconnect]', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

// --------------------------------------------------------
// Apple Calendar Sync-Routen
// --------------------------------------------------------

/**
 * GET /api/v1/calendar/apple/status
 * Response: { configured, lastSync }
 */
router.get('/apple/status', (req, res) => {
  try {
    res.json(appleCalendar.getStatus());
  } catch (err) {
    console.error('[calendar/apple/status]', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

/**
 * POST /api/v1/calendar/apple/sync
 * Manueller Sync-Trigger.
 * Response: { ok: true, lastSync: string }
 */
router.post('/apple/sync', async (req, res) => {
  try {
    await appleCalendar.sync();
    const { lastSync } = appleCalendar.getStatus();
    res.json({ ok: true, lastSync });
  } catch (err) {
    console.error('[calendar/apple/sync]', err);
    res.status(500).json({ error: err.message, code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/calendar/:id
// Einzelnen Termin abrufen.
// Response: { data: Event }
// --------------------------------------------------------
router.get('/:id', (req, res) => {
  try {
    const id    = parseInt(req.params.id, 10);
    const event = db.get().prepare(`
      SELECT e.*,
             u_assigned.display_name AS assigned_name,
             u_assigned.avatar_color AS assigned_color,
             u_created.display_name  AS creator_name
      FROM calendar_events e
      LEFT JOIN users u_assigned ON u_assigned.id = e.assigned_to
      LEFT JOIN users u_created  ON u_created.id  = e.created_by
      WHERE e.id = ?
    `).get(id);

    if (!event) return res.status(404).json({ error: 'Termin nicht gefunden', code: 404 });
    res.json({ data: event });
  } catch (err) {
    console.error('[calendar/GET /:id]', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/calendar
// Neuen Termin anlegen.
// Body: { title, description?, start_datetime, end_datetime?,
//         all_day?, location?, color?, assigned_to?,
//         recurrence_rule? }
// Response: { data: Event }
// --------------------------------------------------------
router.post('/', (req, res) => {
  try {
    const {
      title,
      description    = null,
      start_datetime,
      end_datetime   = null,
      all_day        = 0,
      location       = null,
      color          = '#007AFF',
      assigned_to    = null,
      recurrence_rule = null,
    } = req.body;

    if (!title || !title.trim())
      return res.status(400).json({ error: 'Titel ist erforderlich', code: 400 });
    if (!start_datetime || !DATETIME_RE.test(start_datetime))
      return res.status(400).json({ error: 'Gültiges start_datetime erforderlich', code: 400 });
    if (end_datetime && !DATETIME_RE.test(end_datetime))
      return res.status(400).json({ error: 'Ungültiges end_datetime', code: 400 });
    if (color && !COLOR_RE.test(color))
      return res.status(400).json({ error: 'Farbe muss #RRGGBB sein', code: 400 });

    if (assigned_to) {
      const user = db.get().prepare('SELECT id FROM users WHERE id = ?').get(assigned_to);
      if (!user) return res.status(400).json({ error: 'assigned_to: Benutzer nicht gefunden', code: 400 });
    }

    const result = db.get().prepare(`
      INSERT INTO calendar_events
        (title, description, start_datetime, end_datetime, all_day,
         location, color, assigned_to, created_by, recurrence_rule)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      title.trim(), description || null,
      start_datetime, end_datetime || null,
      all_day ? 1 : 0, location || null,
      color, assigned_to || null,
      req.session.userId, recurrence_rule || null
    );

    const event = db.get().prepare(`
      SELECT e.*,
             u_assigned.display_name AS assigned_name,
             u_assigned.avatar_color AS assigned_color,
             u_created.display_name  AS creator_name
      FROM calendar_events e
      LEFT JOIN users u_assigned ON u_assigned.id = e.assigned_to
      LEFT JOIN users u_created  ON u_created.id  = e.created_by
      WHERE e.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json({ data: event });
  } catch (err) {
    console.error('[calendar/POST /]', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

// --------------------------------------------------------
// PUT /api/v1/calendar/:id
// Termin vollständig aktualisieren.
// Body: alle Felder optional außer title + start_datetime
// Response: { data: Event }
// --------------------------------------------------------
router.put('/:id', (req, res) => {
  try {
    const id    = parseInt(req.params.id, 10);
    const event = db.get().prepare('SELECT * FROM calendar_events WHERE id = ?').get(id);
    if (!event) return res.status(404).json({ error: 'Termin nicht gefunden', code: 404 });

    const {
      title, description, start_datetime, end_datetime,
      all_day, location, color, assigned_to, recurrence_rule,
    } = req.body;

    if (title !== undefined && !title.trim())
      return res.status(400).json({ error: 'Titel darf nicht leer sein', code: 400 });
    if (start_datetime !== undefined && !DATETIME_RE.test(start_datetime))
      return res.status(400).json({ error: 'Ungültiges start_datetime', code: 400 });
    if (end_datetime !== undefined && end_datetime && !DATETIME_RE.test(end_datetime))
      return res.status(400).json({ error: 'Ungültiges end_datetime', code: 400 });
    if (color !== undefined && !COLOR_RE.test(color))
      return res.status(400).json({ error: 'Farbe muss #RRGGBB sein', code: 400 });

    db.get().prepare(`
      UPDATE calendar_events
      SET title           = COALESCE(?, title),
          description     = ?,
          start_datetime  = COALESCE(?, start_datetime),
          end_datetime    = ?,
          all_day         = COALESCE(?, all_day),
          location        = ?,
          color           = COALESCE(?, color),
          assigned_to     = ?,
          recurrence_rule = ?
      WHERE id = ?
    `).run(
      title?.trim()  ?? null,
      description !== undefined ? (description || null) : event.description,
      start_datetime ?? null,
      end_datetime !== undefined ? (end_datetime || null) : event.end_datetime,
      all_day !== undefined ? (all_day ? 1 : 0) : null,
      location !== undefined ? (location || null) : event.location,
      color ?? null,
      assigned_to !== undefined ? (assigned_to || null) : event.assigned_to,
      recurrence_rule !== undefined ? (recurrence_rule || null) : event.recurrence_rule,
      id
    );

    const updated = db.get().prepare(`
      SELECT e.*,
             u_assigned.display_name AS assigned_name,
             u_assigned.avatar_color AS assigned_color,
             u_created.display_name  AS creator_name
      FROM calendar_events e
      LEFT JOIN users u_assigned ON u_assigned.id = e.assigned_to
      LEFT JOIN users u_created  ON u_created.id  = e.created_by
      WHERE e.id = ?
    `).get(id);

    res.json({ data: updated });
  } catch (err) {
    console.error('[calendar/PUT /:id]', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/calendar/:id
// Termin löschen.
// Response: 204 No Content
// --------------------------------------------------------
router.delete('/:id', (req, res) => {
  try {
    const id     = parseInt(req.params.id, 10);
    const result = db.get().prepare('DELETE FROM calendar_events WHERE id = ?').run(id);
    if (result.changes === 0)
      return res.status(404).json({ error: 'Termin nicht gefunden', code: 404 });
    res.status(204).end();
  } catch (err) {
    console.error('[calendar/DELETE /:id]', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

module.exports = router;
