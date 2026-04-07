/**
 * Modul: Kalender (Calendar)
 * Zweck: REST-API-Routen für Kalendereinträge (lokale Termine)
 *        Externe Sync (Google/Apple) folgt in Phase 3, Schritte 14–15.
 * Abhängigkeiten: express, server/db.js, server/auth.js
 */

import { createLogger } from '../logger.js';
import express from 'express';
import * as db from '../db.js';
import * as googleCalendar from '../services/google-calendar.js';
import * as appleCalendar from '../services/apple-calendar.js';
import { requireAdmin } from '../auth.js';
import { str, color, datetime, rrule, collectErrors, MAX_TITLE, MAX_TEXT, DATE_RE, DATETIME_RE } from '../middleware/validate.js';
import { nextOccurrence } from '../services/recurrence.js';

const log = createLogger('Calendar');

const router         = express.Router();

const VALID_SOURCES = ['local', 'google', 'apple'];

// --------------------------------------------------------
// RRULE-Expansion: alle Vorkommen eines wiederkehrenden Events
// innerhalb [from, to] generieren (inklusive beider Grenzen).
// --------------------------------------------------------

/**
 * @param {object[]} events  Rohe DB-Events (können recurrence_rule haben)
 * @param {string}   from    YYYY-MM-DD
 * @param {string}   to      YYYY-MM-DD
 * @returns {object[]}  Expandiertes, sortiertes Array
 */
function expandRecurringEvents(events, from, to) {
  const result = [];

  for (const event of events) {
    if (!event.recurrence_rule) {
      result.push(event);
      continue;
    }

    // Dauer des Events in ms (für End-Zeit-Berechnung der Instanzen)
    const startMs    = new Date(event.start_datetime).getTime();
    const endMs      = event.end_datetime ? new Date(event.end_datetime).getTime() : null;
    const durationMs = endMs !== null ? endMs - startMs : null;
    // Duration in days for all-day events (for date-only end calculation)
    const isAllDay     = !!event.all_day;
    const durationDays = isAllDay && durationMs !== null ? Math.round(durationMs / 86400000) : 0;

    // Original-Zeit-Teil erhalten (z.B. 'T14:30:00' oder '' bei All-Day)
    const timeSuffix = event.start_datetime.slice(10);

    let currentDate = event.start_datetime.slice(0, 10); // YYYY-MM-DD
    let iterations  = 0;
    const MAX_ITER  = 1000; // Sicherheitsgrenze

    while (currentDate <= to && iterations < MAX_ITER) {
      iterations++;

      // For multi-day events, check if the instance end reaches into [from, to]
      let instanceEnd = currentDate;
      if (isAllDay && durationDays > 0) {
        const d = new Date(currentDate + 'T00:00:00');
        d.setDate(d.getDate() + durationDays);
        instanceEnd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }

      if (currentDate >= from || instanceEnd >= from) {
        const newStart = currentDate + timeSuffix;
        let newEnd = event.end_datetime;
        if (durationMs !== null) {
          if (isAllDay) {
            // Keep date-only format for all-day events
            const d = new Date(currentDate + 'T00:00:00');
            d.setDate(d.getDate() + durationDays);
            newEnd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          } else {
            newEnd = new Date(new Date(newStart).getTime() + durationMs)
              .toISOString()
              .replace('.000Z', 'Z');
          }
        }

        result.push({
          ...event,
          start_datetime:       newStart,
          end_datetime:         newEnd,
          is_recurring_instance: currentDate !== event.start_datetime.slice(0, 10) ? 1 : 0,
        });
      }

      const next = nextOccurrence(currentDate, event.recurrence_rule);
      if (!next || next <= currentDate) break;
      currentDate = next;
    }
  }

  return result.sort((a, b) => a.start_datetime.localeCompare(b.start_datetime));
}

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
      return res.status(400).json({ error: 'from/to must be YYYY-MM-DD', code: 400 });

    let sql = `
      SELECT e.*,
             u_assigned.display_name AS assigned_name,
             u_assigned.avatar_color AS assigned_color,
             u_created.display_name  AS creator_name
      FROM calendar_events e
      LEFT JOIN users u_assigned ON u_assigned.id = e.assigned_to
      LEFT JOIN users u_created  ON u_created.id  = e.created_by
      WHERE (
        (e.recurrence_rule IS NULL AND
          DATE(e.start_datetime) <= ? AND
          (e.end_datetime IS NULL OR DATE(e.end_datetime) >= ?))
        OR
        (e.recurrence_rule IS NOT NULL AND DATE(e.start_datetime) <= ?)
      )
    `;
    const params = [to, from, to];

    if (req.query.assigned_to) {
      sql += ' AND e.assigned_to = ?';
      params.push(parseInt(req.query.assigned_to, 10));
    }

    if (req.query.source && VALID_SOURCES.includes(req.query.source)) {
      sql += ' AND e.external_source = ?';
      params.push(req.query.source);
    }

    sql += ' ORDER BY e.start_datetime ASC, e.all_day DESC';

    const rawEvents = db.get().prepare(sql).all(...params);
    const events    = expandRecurringEvents(rawEvents, from, to);
    res.json({ data: events, from, to });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
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
    const limit   = Math.min(parseInt(req.query.limit, 10) || 5, 20);
    const nowDate = new Date().toISOString().slice(0, 10);
    // Fenster: heute bis 90 Tage voraus (für Wiederholungs-Expansion)
    const future  = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const rawEvents = db.get().prepare(`
      SELECT e.*,
             u_assigned.display_name AS assigned_name,
             u_assigned.avatar_color AS assigned_color
      FROM calendar_events e
      LEFT JOIN users u_assigned ON u_assigned.id = e.assigned_to
      WHERE (
        (e.recurrence_rule IS NULL AND DATE(e.start_datetime) BETWEEN ? AND ?)
        OR
        (e.recurrence_rule IS NOT NULL AND DATE(e.start_datetime) <= ?)
      )
      ORDER BY e.start_datetime ASC
    `).all(nowDate, future, future);

    const expanded = expandRecurringEvents(rawEvents, nowDate, future)
      .filter((e) => e.start_datetime >= new Date().toISOString())
      .slice(0, limit);

    res.json({ data: expanded });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
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
    const url = googleCalendar.getAuthUrl(req.session);
    if (!url) return res.status(503).json({ error: 'Google nicht konfiguriert.', code: 503 });
    res.redirect(url);
  } catch (err) {
    log.error('', err);
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
    const { code, error, state } = req.query;
    if (error) return res.redirect('/settings?sync_error=google');
    if (!code)  return res.status(400).json({ error: 'Kein Code erhalten.', code: 400 });

    // OAuth CSRF-Schutz: state-Parameter validieren
    if (!state || !req.session.googleOAuthState || state !== req.session.googleOAuthState) {
      log.error('OAuth state mismatch');
      return res.redirect('/settings?sync_error=google');
    }
    delete req.session.googleOAuthState;

    await googleCalendar.handleCallback(code);

    // Initialen Sync im Hintergrund starten (kein await - Redirect soll sofort erfolgen)
    googleCalendar.sync().catch((e) => log.error('Initialer Sync fehlgeschlagen:', e.message));

    res.redirect('/settings?sync_ok=google');
  } catch (err) {
    log.error('', err);
    res.redirect('/settings?sync_error=google');
  }
});

/**
 * POST /api/v1/calendar/google/sync
 * Manueller Sync-Trigger.
 * Response: { ok: true, lastSync: string }
 */
router.post('/google/sync', requireAdmin, async (req, res) => {
  try {
    await googleCalendar.sync();
    const { lastSync } = googleCalendar.getStatus();
    res.json({ ok: true, lastSync });
  } catch (err) {
    log.error('', err);
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
    log.error('', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
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
    log.error('', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
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
    log.error('', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

/**
 * POST /api/v1/calendar/apple/sync
 * Manueller Sync-Trigger.
 * Response: { ok: true, lastSync: string }
 */
router.post('/apple/sync', requireAdmin, async (req, res) => {
  try {
    await appleCalendar.sync();
    const { lastSync } = appleCalendar.getStatus();
    res.json({ ok: true, lastSync });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: err.message, code: 500 });
  }
});

/**
 * POST /api/v1/calendar/apple/connect
 * Apple-CalDAV-Credentials speichern und Verbindung testen.
 * Body: { url, username, password }
 * Response: { ok: true, calendarCount: number }
 */
router.post('/apple/connect', requireAdmin, async (req, res) => {
  const { url, username, password } = req.body;
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return res.status(400).json({ error: 'url must be a valid HTTP(S) URL.', code: 400 });
  }
  if (!username || typeof username !== 'string' || username.length > 254) {
    return res.status(400).json({ error: 'username is missing or invalid.', code: 400 });
  }
  if (!password || typeof password !== 'string' || password.length < 1) {
    return res.status(400).json({ error: 'password fehlt.', code: 400 });
  }

  try {
    // Zuerst temporär setzen, damit testConnection() sie findet
    appleCalendar.saveCredentials(url.trim(), username.trim(), password);
    const result = await appleCalendar.testConnection();
    res.json({ ok: true, calendarCount: result.calendarCount });
  } catch (err) {
    // Bei Fehler: gespeicherte Credentials wieder löschen
    appleCalendar.clearCredentials();
    log.error('', err);
    res.status(400).json({ error: err.message.replace('[Apple] ', ''), code: 400 });
  }
});

/**
 * DELETE /api/v1/calendar/apple/disconnect
 * Apple-CalDAV-Credentials löschen.
 * Response: 204
 */
router.delete('/apple/disconnect', requireAdmin, (req, res) => {
  try {
    appleCalendar.clearCredentials();
    res.status(204).end();
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
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
    log.error('', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
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
    const vTitle = str(req.body.title, 'Titel', { max: MAX_TITLE });
    const vDesc  = str(req.body.description, 'Beschreibung', { max: MAX_TEXT, required: false });
    const vStart = datetime(req.body.start_datetime, 'Startdatum', true);
    const vEnd   = datetime(req.body.end_datetime, 'Enddatum');
    const vColor = color(req.body.color || '#007AFF', 'Farbe');
    const vLoc   = str(req.body.location, 'Ort', { max: MAX_TITLE, required: false });
    const vRrule = rrule(req.body.recurrence_rule, 'Wiederholung');
    const errors = collectErrors([vTitle, vDesc, vStart, vEnd, vColor, vLoc, vRrule]);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    const { all_day = 0, assigned_to = null } = req.body;

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
      vTitle.value, vDesc.value,
      vStart.value, vEnd.value,
      all_day ? 1 : 0, vLoc.value,
      vColor.value, assigned_to || null,
      req.session.userId, vRrule.value
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
    log.error('', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
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

    const checks = [];
    if (req.body.title          !== undefined) checks.push(str(req.body.title, 'Titel', { max: MAX_TITLE, required: false }));
    if (req.body.description    !== undefined) checks.push(str(req.body.description, 'Beschreibung', { max: MAX_TEXT, required: false }));
    if (req.body.start_datetime !== undefined) checks.push(datetime(req.body.start_datetime, 'Startdatum'));
    if (req.body.end_datetime   !== undefined) checks.push(datetime(req.body.end_datetime, 'Enddatum'));
    if (req.body.color          !== undefined) checks.push(color(req.body.color, 'Farbe'));
    if (req.body.location       !== undefined) checks.push(str(req.body.location, 'Ort', { max: MAX_TITLE, required: false }));
    if (req.body.recurrence_rule !== undefined) checks.push(rrule(req.body.recurrence_rule, 'Wiederholung'));
    const errors = collectErrors(checks);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    const {
      title, description, start_datetime, end_datetime,
      all_day, location, color: colorVal, assigned_to, recurrence_rule,
    } = req.body;

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
      colorVal ?? null,
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
    log.error('', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/calendar/:id
// Termin löschen.
// Response: 204 No Content
// --------------------------------------------------------
// --------------------------------------------------------
// DELETE /api/v1/calendar/clear?scope=imported|all
// Delete imported events (external_uid IS NOT NULL) or all events.
// Response: { data: { deleted: number } }
// --------------------------------------------------------
router.delete('/clear', (req, res) => {
  try {
    const scope = req.query.scope;
    if (scope !== 'imported' && scope !== 'all')
      return res.status(400).json({ error: 'scope must be "imported" or "all"', code: 400 });

    const sql = scope === 'imported'
      ? 'DELETE FROM calendar_events WHERE external_uid IS NOT NULL'
      : 'DELETE FROM calendar_events';

    const result = db.get().prepare(sql).run();
    res.json({ data: { deleted: result.changes } });
  } catch (err) {
    log.error('clear events', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const id     = parseInt(req.params.id, 10);
    const result = db.get().prepare('DELETE FROM calendar_events WHERE id = ?').run(id);
    if (result.changes === 0)
      return res.status(404).json({ error: 'Event not found', code: 404 });
    res.status(204).end();
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/calendar/import
// Import events from an ICS file.
// Body: { ics: string }
// Response: { data: { imported: number } }
// --------------------------------------------------------
router.post('/import', (req, res) => {
  try {
    const ics = req.body?.ics;
    if (!ics || typeof ics !== 'string')
      return res.status(400).json({ error: 'ICS content required', code: 400 });

    const events = parseICS(ics);
    if (!events.length)
      return res.status(400).json({ error: 'No valid events found in file', code: 400 });

    const insert = db.get().prepare(`
      INSERT INTO calendar_events
        (title, description, start_datetime, end_datetime, all_day,
         location, color, created_by, recurrence_rule, external_uid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const exists = db.get().prepare(
      'SELECT 1 FROM calendar_events WHERE external_uid = ?'
    );

    const userId = req.session.userId;
    let imported = 0;
    let skipped  = 0;
    db.get().transaction(() => {
      for (const e of events) {
        if (e.uid && exists.get(e.uid)) { skipped++; continue; }
        insert.run(
          e.title, e.description, e.start_datetime, e.end_datetime,
          e.all_day, e.location, '#007AFF', userId, e.recurrence_rule,
          e.uid ?? null
        );
        imported++;
      }
    })();

    log.info(`Imported ${imported}, skipped ${skipped} (already exist)`);
    res.json({ data: { imported, skipped } });
  } catch (err) {
    log.error('ICS import', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

// --------------------------------------------------------
// ICS parsing helpers
// --------------------------------------------------------

function parseICS(text) {
  // Unfold continued lines (RFC 5545 §3.1: CRLF + SPACE/TAB = continuation)
  const unfolded = text.replace(/\r?\n[ \t]/g, '');

  const events = [];
  const blockRe = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/gi;
  let blockMatch;

  while ((blockMatch = blockRe.exec(unfolded)) !== null) {
    const block = blockMatch[1];

    // Extract a property: returns { params, value } or null
    const get = (prop) => {
      const re = new RegExp(`^${prop}((?:;[^:]*)*):(.*?)$`, 'im');
      const m  = re.exec(block);
      if (!m) return null;
      return { params: m[1].toUpperCase(), value: m[2].trim() };
    };

    // Skip events with no title
    const summaryField = get('SUMMARY');
    const title = summaryField ? unescapeICS(summaryField.value).trim().slice(0, 200) : '';
    if (!title) continue;

    const dtstart = get('DTSTART');
    if (!dtstart) continue;

    const dtend  = get('DTEND');
    const rruleF = get('RRULE');
    const descF  = get('DESCRIPTION');
    const locF   = get('LOCATION');
    const uidF   = get('UID');

    const allDay = dtstart.params.includes('VALUE=DATE');

    let startDatetime, endDatetime;

    if (allDay) {
      startDatetime = icsDateToISO(dtstart.value);
      // ICS all-day DTEND is the exclusive next day — store start as end
      endDatetime = startDatetime;
    } else {
      const startIsUTC = dtstart.value.endsWith('Z') || dtstart.value.endsWith('z');
      startDatetime = icsDatetimeToISO(dtstart.value, startIsUTC);
      if (dtend) {
        const endIsUTC = dtend.value.endsWith('Z') || dtend.value.endsWith('z');
        endDatetime = icsDatetimeToISO(dtend.value, endIsUTC);
      } else {
        // No DTEND: default +1 hour
        const d = new Date(startDatetime);
        d.setHours(d.getHours() + 1);
        endDatetime = d.toISOString().slice(0, 16);
      }
    }

    if (!startDatetime) continue;

    events.push({
      title,
      description:     descF   ? unescapeICS(descF.value).slice(0, 2000)  : null,
      start_datetime:  startDatetime,
      end_datetime:    endDatetime,
      all_day:         allDay ? 1 : 0,
      location:        locF    ? unescapeICS(locF.value).slice(0, 200)    : null,
      recurrence_rule: rruleF  ? rruleF.value.slice(0, 500)               : null,
      uid:             uidF    ? uidF.value.slice(0, 255)                  : null,
    });
  }

  return events;
}

/** YYYYMMDD → YYYY-MM-DD */
function icsDateToISO(s) {
  if (!/^\d{8}$/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** YYYYMMDDTHHmmss[Z] → YYYY-MM-DDTHH:mm
 *  isUTC=true: convert from UTC to server local time */
function icsDatetimeToISO(s, isUTC) {
  const clean = s.replace(/Z$/i, '');
  const m = clean.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
  if (isUTC) {
    // Shift UTC → server local (relies on server being in user's timezone)
    const d = new Date(iso + 'Z');
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }
  return iso; // TZID-qualified → treat as local time
}

/** Unescape ICS text field values */
function unescapeICS(s) {
  return String(s || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g,  ',')
    .replace(/\\;/g,  ';')
    .replace(/\\\\/g, '\\');
}

export default router;
