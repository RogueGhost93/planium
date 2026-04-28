/**
 * Modul: Dashboard
 * Zweck: Aggregierter Endpoint - liefert Daten aller Dashboard-Widgets in einem Request
 * Abhängigkeiten: express, server/db.js
 */

import { createLogger } from '../logger.js';
import express from 'express';
import * as db from '../db.js';
import { defaultDashboardLayout, normalizeDashboardLayout } from '../../public/lib/dashboard-layout.js';

const log = createLogger('Dashboard');

const router = express.Router();

const DASHBOARD_LAYOUT_KEY = 'dashboard_layout';

function readDashboardLayout(userId) {
  try {
    const row = db.get()
      .prepare(`SELECT value FROM user_settings WHERE user_id = ? AND key = ?`)
      .get(userId, DASHBOARD_LAYOUT_KEY);
    if (!row?.value) return defaultDashboardLayout();
    return normalizeDashboardLayout(JSON.parse(row.value));
  } catch (err) {
    log.error('dashboard layout load:', err.message);
    return defaultDashboardLayout();
  }
}

function saveDashboardLayout(userId, layout) {
  const normalized = normalizeDashboardLayout(layout);
  db.get().prepare(`
    INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
  `).run(userId, DASHBOARD_LAYOUT_KEY, JSON.stringify(normalized));
  return normalized;
}

/**
 * GET /api/v1/dashboard
 * Liefert aggregierte Daten für alle Dashboard-Widgets.
 * Jedes Widget-Objekt hat ein eigenes `error`-Feld falls die Abfrage fehlschlägt -
 * so bricht ein fehlerhaftes Widget nicht das gesamte Dashboard.
 *
 * Response: {
 *   upcomingEvents: CalendarEvent[],   // Nächste 5 Termine
 *   urgentTasks:    Task[],            // High/Urgent mit Fälligkeit ≤ 48h
 *   todayMeals:     Meal[],            // Mahlzeiten für heute
 *   pinnedNotes:    Note[],            // Angepinnte Notizen (max. 3)
 *   users:          User[]             // Alle User (für Avatar-Farben)
 * }
 */
router.get('/', (req, res) => {
  try {
  const d = db.get();
  const result = {};

  // Heute und +48h als ISO-Strings
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const deadline48h = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();

  // Anstehende Termine (nächste 5, ab jetzt)
  try {
    result.upcomingEvents = d.prepare(`
      SELECT
        ce.*,
        u.display_name  AS assigned_name,
        u.avatar_color  AS assigned_color
      FROM calendar_events ce
      LEFT JOIN users u ON ce.assigned_to = u.id
      WHERE ce.start_datetime >= ?
      ORDER BY ce.start_datetime ASC
      LIMIT 6
    `).all(now.toISOString());
  } catch (err) {
    log.error('upcomingEvents-Fehler:', err.message);
    result.upcomingEvents = [];
  }

  // Offene Aufgaben: alle nicht-erledigten, sortiert nach Priorität und Fälligkeit
  try {
    result.urgentTasks = d.prepare(`
      SELECT
        t.*,
        u.display_name AS assigned_name,
        u.avatar_color AS assigned_color
      FROM tasks t
      LEFT JOIN users u ON t.assigned_to = u.id
      WHERE t.status != 'done'
        AND (t.due_date IS NULL OR t.due_date <= date('now', '+60 days'))
      ORDER BY
        CASE t.priority WHEN 'urgent' THEN 0 ELSE 1 END,
        CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
        t.due_date ASC,
        CASE WHEN t.due_time IS NULL THEN 1 ELSE 0 END,
        t.due_time ASC
    `).all();
  } catch (err) {
    log.error('urgentTasks-Fehler:', err.message);
    result.urgentTasks = [];
  }

  // Heutiges Essen
  try {
    result.todayMeals = d.prepare(`
      SELECT * FROM meals
      WHERE date = ?
      ORDER BY
        CASE meal_type
          WHEN 'breakfast' THEN 0
          WHEN 'lunch'     THEN 1
          WHEN 'dinner'    THEN 2
          WHEN 'snack'     THEN 3
        END
    `).all(todayStr);
  } catch (err) {
    log.error('todayMeals-Fehler:', err.message);
    result.todayMeals = [];
  }

  // Neueste Notizen (gepinnte zuerst, dann aktuellste)
  try {
    result.pinnedNotes = d.prepare(`
      SELECT n.*, u.display_name AS author_name, u.avatar_color AS author_color
      FROM notes n
      LEFT JOIN users u ON n.created_by = u.id
      WHERE (n.created_by = ? OR n.shared = 1)
        AND n.pinned = 1
      ORDER BY n.updated_at DESC
    `).all(req.session.userId);
  } catch (err) {
    log.error('pinnedNotes-Fehler:', err.message);
    result.pinnedNotes = [];
  }

  // Alle User (für Avatar-Farben in Widgets)
  try {
    result.users = d.prepare(
      'SELECT id, display_name, avatar_color FROM users ORDER BY display_name'
    ).all();
  } catch (err) {
    result.users = [];
  }

  // Personal task lists (owned + shared with this user) + their items
  try {
    const uid = req.session.userId;
    result.personalLists = d.prepare(`
      SELECT
        l.id, l.name, l.color, l.owner_id, l.sort_order,
        u.display_name AS owner_name,
        (l.owner_id = ?) AS is_owner,
        EXISTS (SELECT 1 FROM task_list_shares s WHERE s.list_id = l.id) AS has_shares
      FROM task_lists l
      LEFT JOIN users u ON u.id = l.owner_id
      WHERE l.owner_id = ?
         OR EXISTS (SELECT 1 FROM task_list_shares s
                    WHERE s.list_id = l.id AND s.user_id = ?)
      ORDER BY l.sort_order ASC, l.created_at ASC
    `).all(uid, uid, uid).map((l) => ({ ...l, is_owner: !!l.is_owner, has_shares: !!l.has_shares }));

    result.personalItems = d.prepare(`
      SELECT t.id, t.list_id, t.title, t.done, t.sort_order, t.priority, t.due_date,
             t.is_recurring, t.recurrence_rule, t.description
      FROM personal_tasks t
      JOIN task_lists l ON l.id = t.list_id
      WHERE (l.owner_id = ?
             OR EXISTS (SELECT 1 FROM task_list_shares s
                        WHERE s.list_id = l.id AND s.user_id = ?))
      ORDER BY
        t.done ASC,
        CASE t.priority WHEN 'urgent' THEN 0 ELSE 1 END,
        CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
        t.due_date ASC,
        t.sort_order ASC, t.id ASC
    `).all(uid, uid);
  } catch (err) {
    log.error('personalLists-Fehler:', err.message);
    result.personalLists = [];
    result.personalItems = [];
  }

  // 3-tier lists: head_lists → sublists (lists) → list_items
  try {
    result.heads = d.prepare(`
      SELECT
        h.id, h.name, h.sort_order,
        COALESCE(SUM(CASE WHEN li.is_checked = 0 THEN 1 ELSE 0 END), 0) AS unchecked_count
      FROM head_lists h
      LEFT JOIN lists l      ON l.head_list_id = h.id
      LEFT JOIN list_items li ON li.list_id = l.id
      WHERE h.is_private = 0 OR h.created_by = ?
      GROUP BY h.id
      ORDER BY h.sort_order ASC
    `).all(req.session.userId);

    result.sublists = d.prepare(`
      SELECT
        l.id, l.name, l.head_list_id, l.sort_order,
        COALESCE(SUM(CASE WHEN li.is_checked = 0 THEN 1 ELSE 0 END), 0) AS unchecked_count
      FROM lists l
      JOIN head_lists h ON h.id = l.head_list_id
      LEFT JOIN list_items li ON li.list_id = l.id
      WHERE h.is_private = 0 OR h.created_by = ?
      GROUP BY l.id
      ORDER BY l.sort_order ASC
    `).all(req.session.userId);

    result.listItems = d.prepare(`
      SELECT li.id, li.list_id, li.name, li.quantity
      FROM list_items li
      WHERE li.is_checked = 0
      ORDER BY li.id ASC
    `).all();
  } catch (err) {
    log.error('lists-Fehler:', err.message);
    result.heads = [];
    result.sublists = [];
    result.listItems = [];
  }

  result.layout = readDashboardLayout(req.session.userId);

  res.json(result);
  } catch (err) {
    log.error('Kritischer Fehler:', err.message);
    res.status(500).json({ error: 'Dashboard konnte nicht geladen werden.', code: 500 });
  }
});

router.get('/layout', (req, res) => {
  try {
    res.json({ data: { layout: readDashboardLayout(req.session.userId) } });
  } catch (err) {
    log.error('dashboard layout GET:', err.message);
    res.status(500).json({ error: 'Layout konnte nicht geladen werden.', code: 500 });
  }
});

/**
 * PUT /api/v1/dashboard/layout
 * Saves the widget order and span layout for the current user.
 */
router.put('/layout', (req, res) => {
  try {
    const normalized = saveDashboardLayout(req.session.userId, req.body?.layout ?? req.body ?? {});
    res.json({ ok: true, data: { layout: normalized } });
  } catch (err) {
    log.error('dashboard layout save:', err.message);
    res.status(500).json({ error: 'Layout konnte nicht gespeichert werden.', code: 500 });
  }
});

/**
 * GET /api/v1/dashboard/quick-note?scope=public|private
 * Returns the shared (public) quick note, or the caller's private note.
 */
router.get('/quick-note', (req, res) => {
  try {
    const scope = req.query.scope === 'private' ? 'private' : 'public';
    let text = '';
    if (scope === 'public') {
      const row = db.get()
        .prepare("SELECT value FROM app_settings WHERE key = 'quick_note_public'")
        .get();
      text = row?.value ?? '';
    } else {
      const row = db.get()
        .prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = 'quick_note'")
        .get(req.session.userId);
      text = row?.value ?? '';
    }
    res.json({ data: { text } });
  } catch (err) {
    log.error('quick-note GET:', err.message);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

/**
 * PUT /api/v1/dashboard/quick-note?scope=public|private
 * Saves the shared (public) quick note, or the caller's private note.
 * Body: { text }
 */
router.put('/quick-note', (req, res) => {
  try {
    const scope = req.query.scope === 'private' ? 'private' : 'public';
    const text = String(req.body.text ?? '').slice(0, 10000);
    if (scope === 'public') {
      db.get().prepare(`
        INSERT INTO app_settings (key, value) VALUES ('quick_note_public', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(text);
    } else {
      db.get().prepare(`
        INSERT INTO user_settings (user_id, key, value) VALUES (?, 'quick_note', ?)
        ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
      `).run(req.session.userId, text);
    }
    res.json({ ok: true });
  } catch (err) {
    log.error('quick-note PUT:', err.message);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

export default router;
