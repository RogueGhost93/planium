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
        CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
        t.due_date ASC,
        CASE t.priority
          WHEN 'urgent' THEN 0
          WHEN 'high'   THEN 1
          WHEN 'medium' THEN 2
          WHEN 'low'    THEN 3
          ELSE 4
        END
      LIMIT 5
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
      LIMIT 3
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

  // Unchecked shopping items per list (max 5 items per list, all lists)
  try {
    result.shoppingLists = d.prepare(`
      SELECT
        sl.id,
        sl.name,
        COUNT(si.id) AS unchecked_count
      FROM shopping_lists sl
      JOIN shopping_items si ON si.list_id = sl.id AND si.is_checked = 0
      GROUP BY sl.id
      ORDER BY sl.sort_order ASC
    `).all();

    result.shoppingItems = d.prepare(`
      SELECT si.id, si.list_id, si.name, si.quantity
      FROM shopping_items si
      JOIN shopping_lists sl ON sl.id = si.list_id
      WHERE si.is_checked = 0
      ORDER BY sl.sort_order ASC, si.id ASC
    `).all();
  } catch (err) {
    log.error('shoppingItems-Fehler:', err.message);
    result.shoppingLists = [];
    result.shoppingItems = [];
  }

  res.json(result);
  } catch (err) {
    log.error('Kritischer Fehler:', err.message);
    res.status(500).json({ error: 'Dashboard konnte nicht geladen werden.', code: 500 });
  }
});

export default router;
