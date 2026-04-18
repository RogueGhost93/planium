/**
 * Modul: Persönliche Aufgabenlisten (Personal Task Lists)
 * Zweck: REST-API für solo Todo-Listen pro Benutzer mit optionalem Teilen.
 *        Owner darf umbenennen, löschen und Freigaben verwalten.
 *        Geteilte Benutzer dürfen Items lesen, anlegen, bearbeiten, löschen.
 * Abhängigkeiten: express, server/db.js, validate.js
 */

import { createLogger } from '../logger.js';
import express from 'express';
import * as db from '../db.js';
import { str, color, oneOf, date, collectErrors, MAX_TITLE } from '../middleware/validate.js';

const VALID_PERSONAL_PRIORITIES = ['none', 'urgent'];

const log = createLogger('PersonalLists');
const router = express.Router();

// --------------------------------------------------------
// Helpers
// --------------------------------------------------------

/** Owner-only access: returns row only if user owns the list. */
function ownedList(listId, userId) {
  return db.get()
    .prepare('SELECT * FROM task_lists WHERE id = ? AND owner_id = ?')
    .get(listId, userId);
}

/** Read/write access: returns row if user owns OR is shared on the list. */
function accessibleList(listId, userId) {
  return db.get().prepare(`
    SELECT l.* FROM task_lists l
    WHERE l.id = ?
      AND (l.owner_id = ?
           OR EXISTS (SELECT 1 FROM task_list_shares s
                      WHERE s.list_id = l.id AND s.user_id = ?))
  `).get(listId, userId, userId);
}

// --------------------------------------------------------
// GET /api/v1/personal-lists
// All lists owned by the current user OR shared with them, with item counts.
// Each list is annotated with is_owner (1/0), owner_name, shared_user_ids.
// --------------------------------------------------------
router.get('/', (req, res) => {
  try {
    const uid = req.session.userId;
    const lists = db.get().prepare(`
      SELECT
        l.*,
        u.display_name AS owner_name,
        (l.owner_id = ?) AS is_owner,
        COALESCE(SUM(CASE WHEN t.done = 0 THEN 1 ELSE 0 END), 0) AS pending_count,
        COALESCE(COUNT(t.id), 0) AS total_count
      FROM task_lists l
      LEFT JOIN users u           ON u.id = l.owner_id
      LEFT JOIN personal_tasks t  ON t.list_id = l.id
      WHERE l.owner_id = ?
         OR EXISTS (SELECT 1 FROM task_list_shares s
                    WHERE s.list_id = l.id AND s.user_id = ?)
      GROUP BY l.id
      ORDER BY l.sort_order ASC, l.created_at ASC
    `).all(uid, uid, uid);

    // Attach shared_user_ids only for lists this user owns (privacy)
    const ownedIds = lists.filter((l) => l.is_owner).map((l) => l.id);
    let sharesByList = {};
    if (ownedIds.length) {
      const placeholders = ownedIds.map(() => '?').join(',');
      const rows = db.get()
        .prepare(`SELECT list_id, user_id FROM task_list_shares WHERE list_id IN (${placeholders})`)
        .all(...ownedIds);
      sharesByList = rows.reduce((acc, r) => {
        (acc[r.list_id] = acc[r.list_id] || []).push(r.user_id);
        return acc;
      }, {});
    }
    for (const l of lists) {
      l.shared_user_ids = l.is_owner ? (sharesByList[l.id] || []) : null;
      l.is_owner = !!l.is_owner;
    }

    res.json({ data: lists });
  } catch (err) {
    log.error('GET /', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/personal-lists
// Body: { name, color? }
// --------------------------------------------------------
router.post('/', (req, res) => {
  try {
    const vName  = str(req.body.name, 'name', { max: MAX_TITLE });
    const vColor = color(req.body.color, 'color');
    const errs = collectErrors([vName, vColor]);
    if (errs.length) return res.status(400).json({ error: errs.join(' '), code: 400 });

    const id = db.transaction(() => {
      const maxOrder = db.get()
        .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM task_lists WHERE owner_id = ?')
        .get(req.session.userId).m;
      const result = db.get().prepare(`
        INSERT INTO task_lists (owner_id, name, color, sort_order)
        VALUES (?, ?, ?, ?)
      `).run(req.session.userId, vName.value, vColor.value || '#2563EB', maxOrder + 1);
      return result.lastInsertRowid;
    });

    const list = db.get().prepare('SELECT * FROM task_lists WHERE id = ?').get(id);
    res.status(201).json({
      data: {
        ...list,
        is_owner: true,
        owner_name: null,
        shared_user_ids: [],
        pending_count: 0,
        total_count: 0,
      },
    });
  } catch (err) {
    log.error('POST /', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

// --------------------------------------------------------
// PUT /api/v1/personal-lists/:id   (owner-only)
// Body: { name?, color? }
// --------------------------------------------------------
router.put('/:id', (req, res) => {
  try {
    const list = ownedList(req.params.id, req.session.userId);
    if (!list) return res.status(404).json({ error: 'Not found.', code: 404 });

    const checks = [];
    if (req.body.name  !== undefined) checks.push(str(req.body.name, 'name', { max: MAX_TITLE }));
    if (req.body.color !== undefined) checks.push(color(req.body.color, 'color'));
    const errs = collectErrors(checks);
    if (errs.length) return res.status(400).json({ error: errs.join(' '), code: 400 });

    const newName  = req.body.name  !== undefined ? req.body.name.trim() : list.name;
    const newColor = req.body.color !== undefined ? req.body.color       : list.color;

    db.get().prepare('UPDATE task_lists SET name = ?, color = ? WHERE id = ?')
      .run(newName, newColor, req.params.id);

    res.json({ data: db.get().prepare('SELECT * FROM task_lists WHERE id = ?').get(req.params.id) });
  } catch (err) {
    log.error('PUT /:id', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/personal-lists/:id   (owner-only)
// Cascades to all items + shares.
// --------------------------------------------------------
router.delete('/:id', (req, res) => {
  try {
    const list = ownedList(req.params.id, req.session.userId);
    if (!list) return res.status(404).json({ error: 'Not found.', code: 404 });

    db.get().prepare('DELETE FROM task_lists WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    log.error('DELETE /:id', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/personal-lists/:id/items
// Pending first, then done; insertion order within each.
// Accessible to owner OR shared users.
// --------------------------------------------------------
router.get('/:id/items', (req, res) => {
  try {
    const list = accessibleList(req.params.id, req.session.userId);
    if (!list) return res.status(404).json({ error: 'Not found.', code: 404 });

    const items = db.get().prepare(`
      SELECT * FROM personal_tasks
      WHERE list_id = ?
      ORDER BY
        done ASC,
        CASE priority WHEN 'urgent' THEN 0 ELSE 1 END,
        CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,
        due_date ASC,
        sort_order ASC, id ASC
    `).all(req.params.id);
    res.json({ data: items });
  } catch (err) {
    log.error('GET /:id/items', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/personal-lists/:id/items
// Body: { title }
// Accessible to owner OR shared users.
// --------------------------------------------------------
router.post('/:id/items', (req, res) => {
  try {
    const list = accessibleList(req.params.id, req.session.userId);
    if (!list) return res.status(404).json({ error: 'Not found.', code: 404 });

    const v = str(req.body.title, 'title', { max: MAX_TITLE });
    if (v.error) return res.status(400).json({ error: v.error, code: 400 });

    const id = db.transaction(() => {
      const maxOrder = db.get()
        .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM personal_tasks WHERE list_id = ?')
        .get(req.params.id).m;
      const result = db.get().prepare(`
        INSERT INTO personal_tasks (list_id, title, sort_order)
        VALUES (?, ?, ?)
      `).run(req.params.id, v.value, maxOrder + 1);
      return result.lastInsertRowid;
    });

    res.status(201).json({
      data: db.get().prepare('SELECT * FROM personal_tasks WHERE id = ?').get(id),
    });
  } catch (err) {
    log.error('POST /:id/items', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

// --------------------------------------------------------
// PATCH /api/v1/personal-lists/:id/items/:itemId
// Body: { title?, done? }
// Accessible to owner OR shared users.
// --------------------------------------------------------
router.patch('/:id/items/:itemId', (req, res) => {
  try {
    const list = accessibleList(req.params.id, req.session.userId);
    if (!list) return res.status(404).json({ error: 'Not found.', code: 404 });

    const item = db.get()
      .prepare('SELECT * FROM personal_tasks WHERE id = ? AND list_id = ?')
      .get(req.params.itemId, req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found.', code: 404 });

    const updates = [];
    const params  = [];

    if (req.body.title !== undefined) {
      const v = str(req.body.title, 'title', { max: MAX_TITLE });
      if (v.error) return res.status(400).json({ error: v.error, code: 400 });
      updates.push('title = ?');
      params.push(v.value);
    }

    if (req.body.done !== undefined) {
      updates.push('done = ?');
      params.push(req.body.done ? 1 : 0);
    }

    if (req.body.priority !== undefined) {
      const raw = req.body.priority === null || req.body.priority === '' ? 'none' : req.body.priority;
      const v = oneOf(raw, VALID_PERSONAL_PRIORITIES, 'priority');
      if (v.error) return res.status(400).json({ error: v.error, code: 400 });
      updates.push('priority = ?');
      params.push(v.value || 'none');
    }

    if (req.body.due_date !== undefined) {
      if (req.body.due_date === null || req.body.due_date === '') {
        updates.push('due_date = NULL');
      } else {
        const v = date(req.body.due_date, 'due_date');
        if (v.error) return res.status(400).json({ error: v.error, code: 400 });
        updates.push('due_date = ?');
        params.push(v.value);
      }
    }

    if (!updates.length) return res.json({ data: item });

    params.push(req.params.itemId);
    db.get().prepare(`UPDATE personal_tasks SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    res.json({
      data: db.get().prepare('SELECT * FROM personal_tasks WHERE id = ?').get(req.params.itemId),
    });
  } catch (err) {
    log.error('PATCH /:id/items/:itemId', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/personal-lists/:id/items/:itemId
// Accessible to owner OR shared users.
// --------------------------------------------------------
router.delete('/:id/items/:itemId', (req, res) => {
  try {
    const list = accessibleList(req.params.id, req.session.userId);
    if (!list) return res.status(404).json({ error: 'Not found.', code: 404 });

    const result = db.get()
      .prepare('DELETE FROM personal_tasks WHERE id = ? AND list_id = ?')
      .run(req.params.itemId, req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Item not found.', code: 404 });
    res.json({ ok: true });
  } catch (err) {
    log.error('DELETE /:id/items/:itemId', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/personal-lists/:id/clear-done
// Bulk-removes all done items from a list.
// Accessible to owner OR shared users.
// --------------------------------------------------------
router.post('/:id/clear-done', (req, res) => {
  try {
    const list = accessibleList(req.params.id, req.session.userId);
    if (!list) return res.status(404).json({ error: 'Not found.', code: 404 });

    const result = db.get()
      .prepare('DELETE FROM personal_tasks WHERE list_id = ? AND done = 1')
      .run(req.params.id);
    res.json({ ok: true, deleted: result.changes });
  } catch (err) {
    log.error('POST /:id/clear-done', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/personal-lists/:id/shares   (owner-only)
// Returns list of users currently shared on this list.
// --------------------------------------------------------
router.get('/:id/shares', (req, res) => {
  try {
    const list = ownedList(req.params.id, req.session.userId);
    if (!list) return res.status(404).json({ error: 'Not found.', code: 404 });

    const rows = db.get().prepare(`
      SELECT u.id, u.display_name, u.avatar_color
      FROM task_list_shares s
      JOIN users u ON u.id = s.user_id
      WHERE s.list_id = ?
      ORDER BY u.display_name
    `).all(req.params.id);
    res.json({ data: rows });
  } catch (err) {
    log.error('GET /:id/shares', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

// --------------------------------------------------------
// PUT /api/v1/personal-lists/:id/shares   (owner-only)
// Body: { user_ids: number[] } — replaces share set with this exact list.
// Cannot include the owner. Unknown user_ids are ignored.
// --------------------------------------------------------
router.put('/:id/shares', (req, res) => {
  try {
    const list = ownedList(req.params.id, req.session.userId);
    if (!list) return res.status(404).json({ error: 'Not found.', code: 404 });

    if (!Array.isArray(req.body.user_ids)) {
      return res.status(400).json({ error: 'user_ids must be an array.', code: 400 });
    }
    const requested = req.body.user_ids
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n > 0 && n !== list.owner_id);

    db.transaction(() => {
      db.get().prepare('DELETE FROM task_list_shares WHERE list_id = ?').run(req.params.id);
      if (requested.length) {
        const stmt = db.get().prepare(
          'INSERT OR IGNORE INTO task_list_shares (list_id, user_id) ' +
          'SELECT ?, id FROM users WHERE id = ?'
        );
        for (const uid of requested) stmt.run(req.params.id, uid);
      }
    })();

    const rows = db.get().prepare(`
      SELECT u.id, u.display_name, u.avatar_color
      FROM task_list_shares s
      JOIN users u ON u.id = s.user_id
      WHERE s.list_id = ?
      ORDER BY u.display_name
    `).all(req.params.id);
    res.json({ data: rows });
  } catch (err) {
    log.error('PUT /:id/shares', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

export default router;
