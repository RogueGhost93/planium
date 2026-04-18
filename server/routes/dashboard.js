/**
 * Modul: Dashboard
 * Zweck: Aggregierter Endpoint - liefert Daten aller Dashboard-Widgets in einem Request
 * Abhängigkeiten: express, server/db.js
 */

import { createLogger } from '../logger.js';
import express from 'express';
import * as db from '../db.js';

const log = createLogger('Dashboard');

const router = express.Router();

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
      LIMIT 5
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
      ORDER BY n.pinned DESC, n.updated_at DESC
    `).all();
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
        (l.owner_id = ?) AS is_owner
      FROM task_lists l
      LEFT JOIN users u ON u.id = l.owner_id
      WHERE l.owner_id = ?
         OR EXISTS (SELECT 1 FROM task_list_shares s
                    WHERE s.list_id = l.id AND s.user_id = ?)
      ORDER BY l.sort_order ASC, l.created_at ASC
    `).all(uid, uid, uid).map((l) => ({ ...l, is_owner: !!l.is_owner }));

    result.personalItems = d.prepare(`
      SELECT t.id, t.list_id, t.title, t.done, t.sort_order, t.priority, t.due_date
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
      GROUP BY h.id
      ORDER BY h.sort_order ASC
    `).all();

    result.sublists = d.prepare(`
      SELECT
        l.id, l.name, l.head_list_id, l.sort_order,
        COALESCE(SUM(CASE WHEN li.is_checked = 0 THEN 1 ELSE 0 END), 0) AS unchecked_count
      FROM lists l
      LEFT JOIN list_items li ON li.list_id = l.id
      GROUP BY l.id
      ORDER BY l.sort_order ASC
    `).all();

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

  res.json(result);
  } catch (err) {
    log.error('Kritischer Fehler:', err.message);
    res.status(500).json({ error: 'Dashboard konnte nicht geladen werden.', code: 500 });
  }
});

export default router;
