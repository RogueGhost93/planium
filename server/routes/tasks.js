/**
 * Modul: Aufgaben (Tasks)
 * Zweck: REST-API-Routen für Aufgaben und Teilaufgaben (max. 2 Ebenen)
 * Abhängigkeiten: express, server/db.js
 */

import { createLogger } from '../logger.js';
import express from 'express';
import * as db from '../db.js';
import { nextOccurrence } from '../services/recurrence.js';
import * as v from '../middleware/validate.js';

const log = createLogger('Tasks');

const router = express.Router();

// --------------------------------------------------------
// Konstanten
// --------------------------------------------------------

const VALID_PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'];
const VALID_STATUSES   = ['open', 'in_progress', 'done'];
const VALID_CATEGORIES = ['Household', 'School', 'Shopping', 'Repairs',
                          'Health', 'Finance', 'Leisure', 'Other'];

// --------------------------------------------------------
// Hilfsfunktionen
// --------------------------------------------------------

/** Alle Subtasks einer Aufgabe laden (eine Ebene tief). */
function loadSubtasks(taskId) {
  return db.get().prepare(`
    SELECT t.*, u.display_name AS assigned_name, u.avatar_color AS assigned_color
    FROM tasks t
    LEFT JOIN users u ON t.assigned_to = u.id
    WHERE t.parent_task_id = ?
    ORDER BY t.created_at ASC
  `).all(taskId);
}

/** Fortschritt der Subtasks berechnen (erledigte / gesamt). */
function subtaskProgress(taskId) {
  const row = db.get().prepare(`
    SELECT
      COUNT(*)                          AS total,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
    FROM tasks
    WHERE parent_task_id = ?
  `).get(taskId);
  return { total: row.total ?? 0, done: row.done ?? 0 };
}

/** Eingabe-Validierung für Task-Felder (zentralisiert über validate.js). */
function validateTaskInput(body, isCreate = true) {
  return v.collectErrors([
    v.str(body.title,       'title',       { required: isCreate }),
    v.str(body.description, 'description', { required: false, max: v.MAX_TEXT }),
    v.oneOf(body.priority,  VALID_PRIORITIES, 'priority'),
    v.oneOf(body.status,    VALID_STATUSES,   'status'),
    v.oneOf(body.category,  VALID_CATEGORIES, 'category'),
    v.date(body.due_date,   'due_date'),
    v.time(body.due_time,   'due_time'),
    v.rrule(body.recurrence_rule, 'recurrence_rule'),
  ]);
}

// --------------------------------------------------------
// GET /api/v1/tasks
// Listet Top-Level-Aufgaben mit optionalen Filtern.
// Query-Parameter: status, priority, assigned_to, category
// Response: { data: Task[] }  (jede Task enthält subtask_progress)
// --------------------------------------------------------
router.get('/', (req, res) => {
  try {
    const { status, priority, assigned_to, category } = req.query;

    let sql = `
      SELECT
        t.*,
        u.display_name AS assigned_name,
        u.avatar_color AS assigned_color,
        (SELECT COUNT(*) FROM tasks s WHERE s.parent_task_id = t.id)                           AS subtask_total,
        (SELECT COUNT(*) FROM tasks s WHERE s.parent_task_id = t.id AND s.status = 'done')     AS subtask_done
      FROM tasks t
      LEFT JOIN users u ON t.assigned_to = u.id
      WHERE t.parent_task_id IS NULL
    `;
    const params = [];

    if (status)      { sql += ' AND t.status = ?';      params.push(status); }
    if (priority)    { sql += ' AND t.priority = ?';    params.push(priority); }
    if (assigned_to) { sql += ' AND t.assigned_to = ?'; params.push(Number(assigned_to)); }
    if (category)    { sql += ' AND t.category = ?';    params.push(category); }

    sql += `
      ORDER BY
        CASE t.status WHEN 'done' THEN 1 ELSE 0 END,
        CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
        t.due_date ASC,
        CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
                        WHEN 'medium' THEN 2 ELSE 3 END,
        t.created_at DESC
    `;

    res.json({ data: db.get().prepare(sql).all(...params) });
  } catch (err) {
    log.error('GET / Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/tasks/due-notifications
// Returns tasks due today and tomorrow for the current user's household.
// Response: { today: Task[], tomorrow: Task[] }
// --------------------------------------------------------
router.get('/due-notifications', (req, res) => {
  try {
    const now = new Date();
    const today    = now.toISOString().slice(0, 10);
    const tomorrow = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);

    const todayTasks = db.get().prepare(`
      SELECT t.*, u.display_name AS assigned_name, u.avatar_color AS assigned_color
      FROM tasks t
      LEFT JOIN users u ON t.assigned_to = u.id
      WHERE t.due_date = ? AND t.status != 'done' AND t.parent_task_id IS NULL
      ORDER BY
        CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
                        WHEN 'medium' THEN 2 ELSE 3 END,
        t.due_time ASC
    `).all(today);

    const tomorrowTasks = db.get().prepare(`
      SELECT t.*, u.display_name AS assigned_name, u.avatar_color AS assigned_color
      FROM tasks t
      LEFT JOIN users u ON t.assigned_to = u.id
      WHERE t.due_date = ? AND t.status != 'done' AND t.parent_task_id IS NULL
      ORDER BY
        CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
                        WHEN 'medium' THEN 2 ELSE 3 END,
        t.due_time ASC
    `).all(tomorrow);

    res.json({ today: todayTasks, tomorrow: tomorrowTasks });
  } catch (err) {
    log.error('GET /due-notifications Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/tasks/:id
// Einzelne Aufgabe mit Subtasks.
// Response: { data: Task & { subtasks: Task[] } }
// --------------------------------------------------------
router.get('/:id', (req, res) => {
  try {
    const task = db.get().prepare(`
      SELECT t.*, u.display_name AS assigned_name, u.avatar_color AS assigned_color
      FROM tasks t
      LEFT JOIN users u ON t.assigned_to = u.id
      WHERE t.id = ? AND t.parent_task_id IS NULL
    `).get(req.params.id);

    if (!task) return res.status(404).json({ error: 'Aufgabe nicht gefunden.', code: 404 });

    task.subtasks = loadSubtasks(task.id);
    res.json({ data: task });
  } catch (err) {
    log.error('GET /:id Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/tasks
// Neue Aufgabe erstellen.
// Body: { title, description?, category?, priority?, due_date?, due_time?,
//         assigned_to?, parent_task_id? }
// Response: { data: Task }
// --------------------------------------------------------
router.post('/', (req, res) => {
  try {
    const errors = validateTaskInput(req.body, true);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    const {
      title,
      description     = null,
      category        = 'Sonstiges',
      priority        = 'medium',
      due_date        = null,
      due_time        = null,
      assigned_to     = null,
      parent_task_id  = null,
      is_recurring    = 0,
      recurrence_rule = null,
    } = req.body;

    // Tiefe begrenzen: Subtasks dürfen keine eigenen Subtasks haben (max. 2 Ebenen)
    if (parent_task_id) {
      const parent = db.get().prepare('SELECT parent_task_id FROM tasks WHERE id = ?')
        .get(parent_task_id);
      if (!parent) return res.status(404).json({ error: 'Parent task not found.', code: 404 });
      if (parent.parent_task_id)
        return res.status(400).json({ error: 'Maximal 2 Verschachtelungsebenen erlaubt.', code: 400 });
    }

    const result = db.get().prepare(`
      INSERT INTO tasks
        (title, description, category, priority, due_date, due_time,
         assigned_to, created_by, parent_task_id, is_recurring, recurrence_rule)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      title.trim(), description, category, priority,
      due_date, due_time, assigned_to, req.session.userId, parent_task_id,
      is_recurring ? 1 : 0, recurrence_rule
    );

    const task = db.get().prepare(`
      SELECT t.*, u.display_name AS assigned_name, u.avatar_color AS assigned_color
      FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id
      WHERE t.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json({ data: task });
  } catch (err) {
    log.error('POST / Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

// --------------------------------------------------------
// PUT /api/v1/tasks/:id
// Aufgabe vollständig aktualisieren.
// Body: { title, description?, category?, priority?, status?,
//         due_date?, due_time?, assigned_to? }
// Response: { data: Task }
// --------------------------------------------------------
router.put('/:id', (req, res) => {
  try {
    const task = db.get().prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Aufgabe nicht gefunden.', code: 404 });

    const errors = validateTaskInput(req.body, false);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    const {
      title           = task.title,
      description     = task.description,
      category        = task.category,
      priority        = task.priority,
      status          = task.status,
      due_date        = task.due_date,
      due_time        = task.due_time,
      assigned_to     = task.assigned_to,
      is_recurring    = task.is_recurring,
      recurrence_rule = task.recurrence_rule,
    } = req.body;

    db.get().prepare(`
      UPDATE tasks SET
        title = ?, description = ?, category = ?, priority = ?,
        status = ?, due_date = ?, due_time = ?, assigned_to = ?,
        is_recurring = ?, recurrence_rule = ?
      WHERE id = ?
    `).run(title.trim(), description, category, priority,
           status, due_date, due_time, assigned_to,
           is_recurring ? 1 : 0, recurrence_rule, req.params.id);

    const updated = db.get().prepare(`
      SELECT t.*, u.display_name AS assigned_name, u.avatar_color AS assigned_color
      FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id
      WHERE t.id = ?
    `).get(req.params.id);
    updated.subtasks = loadSubtasks(updated.id);

    res.json({ data: updated });
  } catch (err) {
    log.error('PUT /:id Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

// --------------------------------------------------------
// PATCH /api/v1/tasks/:id/status
// Status einer Aufgabe schnell wechseln (z.B. Swipe-Geste / Checkbox).
// Body: { status: 'open' | 'in_progress' | 'done' }
// Response: { data: { id, status } }
// --------------------------------------------------------
router.patch('/:id/status', (req, res) => {
  try {
    const { status } = req.body;
    if (!VALID_STATUSES.includes(status))
      return res.status(400).json({ error: `Invalid status. Allowed: ${VALID_STATUSES.join(', ')}`, code: 400 });

    const result = db.get().prepare('UPDATE tasks SET status = ? WHERE id = ?')
      .run(status, req.params.id);

    if (result.changes === 0)
      return res.status(404).json({ error: 'Aufgabe nicht gefunden.', code: 404 });

    // Recurring task: reschedule in place instead of spawning a duplicate.
    // Update due_date to the next occurrence and reset status to 'open' so
    // the task simply moves forward — no second copy, no 'done' clutter.
    if (status === 'done') {
      const task = db.get().prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
      if (task?.is_recurring && task.recurrence_rule && !task.parent_task_id) {
        const nextDate = nextOccurrence(task.due_date, task.recurrence_rule);
        if (nextDate) {
          db.get().prepare(`
            UPDATE tasks SET status = 'open', due_date = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
            WHERE id = ?
          `).run(nextDate, task.id);
          // Return the rescheduled status so the client can update its state
          return res.json({ data: { id: Number(req.params.id), status: 'open', due_date: nextDate, rescheduled: true } });
        }
      }
    }

    res.json({ data: { id: Number(req.params.id), status } });
  } catch (err) {
    log.error('PATCH /:id/status Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/tasks/:id
// Aufgabe löschen (Subtasks werden per CASCADE mitgelöscht).
// Response: { ok: true }
// --------------------------------------------------------
router.delete('/:id', (req, res) => {
  try {
    const result = db.get().prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
    if (result.changes === 0)
      return res.status(404).json({ error: 'Aufgabe nicht gefunden.', code: 404 });
    res.json({ ok: true });
  } catch (err) {
    log.error('DELETE /:id Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/tasks/meta/options
// Liefert Filteroptionen: alle User + gültige Werte für Dropdowns.
// Response: { users, priorities, statuses, categories }
// --------------------------------------------------------
router.get('/meta/options', (req, res) => {
  try {
    const users = db.get().prepare(
      'SELECT id, display_name, avatar_color FROM users ORDER BY display_name'
    ).all();
    res.json({ users, priorities: VALID_PRIORITIES, statuses: VALID_STATUSES, categories: VALID_CATEGORIES });
  } catch (err) {
    log.error('GET /meta/options Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

export default router;
