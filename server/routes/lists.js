/**
 * Modul: Listen (3-Tier: head_lists → lists(sublists) → list_items)
 * Zweck: REST-API für Head-Listen (Tabs), Sublisten (Gruppen), Items.
 *
 * Routen-Reihenfolge: Statische Pfade vor dynamischen.
 */

import { createLogger } from '../logger.js';
import express from 'express';
import * as db from '../db.js';
import { str, collectErrors, MAX_TITLE, MAX_SHORT } from '../middleware/validate.js';

const log = createLogger('Lists');
const router = express.Router();

// --------------------------------------------------------
// Helpers
// --------------------------------------------------------
function headCounts(userId) {
  return db.get().prepare(`
    SELECT
      h.id, h.name, h.sort_order, h.is_private, h.created_by, h.created_at, h.updated_at,
      COALESCE(SUM(CASE WHEN li.id IS NOT NULL AND li.is_checked = 0 THEN 1 ELSE 0 END), 0) AS unchecked_count,
      COALESCE(COUNT(DISTINCT l.id), 0) AS sublist_count
    FROM head_lists h
    LEFT JOIN lists l      ON l.head_list_id = h.id
    LEFT JOIN list_items li ON li.list_id = l.id
    WHERE h.is_private = 0 OR h.created_by = ?
    GROUP BY h.id
    ORDER BY h.sort_order ASC
  `).all(userId);
}

// --------------------------------------------------------
// GET /suggestions?q=…
// --------------------------------------------------------
router.get('/suggestions', (req, res) => {
  try {
    const q = (req.query.q ?? '').trim();
    if (q.length < 1) return res.json({ data: [] });

    const rows = db.get().prepare(`
      SELECT DISTINCT name FROM list_items
      WHERE name LIKE ? COLLATE NOCASE
      ORDER BY name ASC LIMIT 8
    `).all(`${q}%`);
    res.json({ data: rows.map((r) => r.name) });
  } catch (err) {
    log.error('suggestions', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

// --------------------------------------------------------
// Head lists
// --------------------------------------------------------
router.get('/heads', (req, res) => {
  try {
    res.json({ data: headCounts(req.session.userId) });
  } catch (err) {
    log.error('GET /heads', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

router.post('/heads', (req, res) => {
  try {
    const vName = str(req.body.name, 'Name', { max: MAX_TITLE });
    if (vName.error) return res.status(400).json({ error: vName.error, code: 400 });
    const is_private = req.body.is_private !== undefined ? (req.body.is_private ? 1 : 0) : 1;

    const id = db.transaction(() => {
      const maxOrder = db.get()
        .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM head_lists')
        .get().m;
      const { lastInsertRowid } = db.get()
        .prepare('INSERT INTO head_lists (name, sort_order, created_by, is_private) VALUES (?, ?, ?, ?)')
        .run(vName.value, maxOrder + 1, req.session.userId, is_private);
      return lastInsertRowid;
    });

    const head = db.get().prepare('SELECT * FROM head_lists WHERE id = ?').get(id);
    res.status(201).json({ data: { ...head, unchecked_count: 0, sublist_count: 0 } });
  } catch (err) {
    log.error('POST /heads', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

router.put('/heads/:id', (req, res) => {
  try {
    const head = db.get().prepare('SELECT * FROM head_lists WHERE id = ?').get(req.params.id);
    if (!head) return res.status(404).json({ error: 'Nicht gefunden.', code: 404 });
    if (head.created_by !== req.session.userId) return res.status(403).json({ error: 'Forbidden.', code: 403 });

    const vName = str(req.body.name ?? head.name, 'Name', { max: MAX_TITLE });
    if (vName.error) return res.status(400).json({ error: vName.error, code: 400 });
    const is_private = req.body.is_private !== undefined ? (req.body.is_private ? 1 : 0) : head.is_private;

    db.get().prepare('UPDATE head_lists SET name = ?, is_private = ? WHERE id = ?')
      .run(vName.value, is_private, req.params.id);
    res.json({ data: db.get().prepare('SELECT * FROM head_lists WHERE id = ?').get(req.params.id) });
  } catch (err) {
    log.error('PUT /heads/:id', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

router.delete('/heads/:id', (req, res) => {
  try {
    const head = db.get().prepare('SELECT * FROM head_lists WHERE id = ?').get(req.params.id);
    if (!head) return res.status(404).json({ error: 'Nicht gefunden.', code: 404 });
    if (head.created_by !== req.session.userId) return res.status(403).json({ error: 'Forbidden.', code: 403 });
    db.get().prepare('DELETE FROM head_lists WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    log.error('DELETE /heads/:id', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

router.patch('/heads/reorder', (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array.', code: 400 });
    const update    = db.get().prepare('UPDATE head_lists SET sort_order = ? WHERE id = ?');
    const updateAll = db.get().transaction((a) => a.forEach((id, i) => update.run(i, id)));
    updateAll(ids);
    res.json({ ok: true });
  } catch (err) {
    log.error('PATCH /heads/reorder', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

// GET full head with sublists + their items
router.get('/heads/:id/full', (req, res) => {
  try {
    const head = db.get().prepare('SELECT * FROM head_lists WHERE id = ?').get(req.params.id);
    if (!head) return res.status(404).json({ error: 'Nicht gefunden.', code: 404 });

    const sublists = db.get().prepare(`
      SELECT
        l.id, l.name, l.sort_order, l.head_list_id,
        COUNT(li.id)                                       AS item_total,
        SUM(CASE WHEN li.is_checked = 1 THEN 1 ELSE 0 END) AS item_checked
      FROM lists l
      LEFT JOIN list_items li ON li.list_id = l.id
      WHERE l.head_list_id = ?
      GROUP BY l.id
      ORDER BY l.sort_order ASC
    `).all(req.params.id);

    const items = sublists.length
      ? db.get().prepare(`
          SELECT * FROM list_items
          WHERE list_id IN (${sublists.map(() => '?').join(',')})
          ORDER BY is_checked ASC, created_at ASC
        `).all(...sublists.map((s) => s.id))
      : [];

    res.json({ data: { head, sublists, items } });
  } catch (err) {
    log.error('GET /heads/:id/full', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

// Create sublist within a head
router.post('/heads/:id/sublists', (req, res) => {
  try {
    const head = db.get().prepare('SELECT id FROM head_lists WHERE id = ?').get(req.params.id);
    if (!head) return res.status(404).json({ error: 'Head nicht gefunden.', code: 404 });

    const vName = str(req.body.name, 'Name', { max: MAX_TITLE });
    if (vName.error) return res.status(400).json({ error: vName.error, code: 400 });

    const id = db.transaction(() => {
      const maxOrder = db.get()
        .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM lists WHERE head_list_id = ?')
        .get(head.id).m;
      const { lastInsertRowid } = db.get().prepare(`
        INSERT INTO lists (name, head_list_id, created_by, sort_order)
        VALUES (?, ?, ?, ?)
      `).run(vName.value, head.id, req.session.userId, maxOrder + 1);
      return lastInsertRowid;
    });

    const sublist = db.get().prepare(`
      SELECT id, name, sort_order, head_list_id, 0 AS item_total, 0 AS item_checked
      FROM lists WHERE id = ?
    `).get(id);
    res.status(201).json({ data: sublist });
  } catch (err) {
    log.error('POST /heads/:id/sublists', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

// --------------------------------------------------------
// Items — addressed by sublist id (kept on `/:listId`)
// --------------------------------------------------------
router.patch('/items/:itemId', (req, res) => {
  try {
    const item = db.get().prepare('SELECT * FROM list_items WHERE id = ?').get(req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden.', code: 404 });

    const {
      is_checked = item.is_checked,
      name       = item.name,
      quantity   = item.quantity,
    } = req.body;

    if (!name?.trim()) return res.status(400).json({ error: 'name darf nicht leer sein.', code: 400 });

    db.get().prepare(`
      UPDATE list_items SET is_checked = ?, name = ?, quantity = ?
      WHERE id = ?
    `).run(is_checked ? 1 : 0, name.trim(), quantity ?? null, req.params.itemId);

    res.json({ data: db.get().prepare('SELECT * FROM list_items WHERE id = ?').get(req.params.itemId) });
  } catch (err) {
    log.error('PATCH /items/:id', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

router.delete('/items/:itemId', (req, res) => {
  try {
    const result = db.get().prepare('DELETE FROM list_items WHERE id = ?').run(req.params.itemId);
    if (result.changes === 0) return res.status(404).json({ error: 'Nicht gefunden.', code: 404 });
    res.json({ ok: true });
  } catch (err) {
    log.error('DELETE /items/:id', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

// --------------------------------------------------------
// Sublist operations
// --------------------------------------------------------
// Flat list of all sublists (for meal planium pickers etc.)
router.get('/sublists', (req, res) => {
  try {
    const rows = db.get().prepare(`
      SELECT l.id, l.name, l.head_list_id, h.name AS head_name
      FROM lists l
      JOIN head_lists h ON h.id = l.head_list_id
      ORDER BY h.sort_order, l.sort_order
    `).all();
    res.json({ data: rows });
  } catch (err) {
    log.error('GET /sublists', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

router.patch('/sublists/reorder', (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array.', code: 400 });
    const update    = db.get().prepare('UPDATE lists SET sort_order = ? WHERE id = ?');
    const updateAll = db.get().transaction((a) => a.forEach((id, i) => update.run(i, id)));
    updateAll(ids);
    res.json({ ok: true });
  } catch (err) {
    log.error('PATCH /sublists/reorder', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

router.put('/:listId', (req, res) => {
  try {
    const current = db.get().prepare('SELECT * FROM lists WHERE id = ?').get(req.params.listId);
    if (!current) return res.status(404).json({ error: 'Nicht gefunden.', code: 404 });

    const vName = str(req.body.name, 'Name', { max: MAX_TITLE });
    if (vName.error) return res.status(400).json({ error: vName.error, code: 400 });

    db.get().prepare('UPDATE lists SET name = ? WHERE id = ?').run(vName.value, req.params.listId);
    res.json({ data: db.get().prepare('SELECT * FROM lists WHERE id = ?').get(req.params.listId) });
  } catch (err) {
    log.error('PUT /:listId', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

router.delete('/:listId', (req, res) => {
  try {
    const result = db.get().prepare('DELETE FROM lists WHERE id = ?').run(req.params.listId);
    if (result.changes === 0) return res.status(404).json({ error: 'Nicht gefunden.', code: 404 });
    res.json({ ok: true });
  } catch (err) {
    log.error('DELETE /:listId', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

router.post('/:listId/items', (req, res) => {
  try {
    const list = db.get().prepare('SELECT id FROM lists WHERE id = ?').get(req.params.listId);
    if (!list) return res.status(404).json({ error: 'Nicht gefunden.', code: 404 });

    const vName = str(req.body.name, 'Name', { max: MAX_TITLE });
    const vQty  = str(req.body.quantity, 'Menge', { max: MAX_SHORT, required: false });
    const errors = collectErrors([vName, vQty]);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    const result = db.get().prepare(`
      INSERT INTO list_items (list_id, name, quantity)
      VALUES (?, ?, ?)
    `).run(req.params.listId, vName.value, vQty.value);

    res.status(201).json({
      data: db.get().prepare('SELECT * FROM list_items WHERE id = ?').get(result.lastInsertRowid),
    });
  } catch (err) {
    log.error('POST /:listId/items', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

router.delete('/:listId/items/checked', (req, res) => {
  try {
    const result = db.get().prepare(`
      DELETE FROM list_items WHERE list_id = ? AND is_checked = 1
    `).run(req.params.listId);
    res.json({ deleted: result.changes });
  } catch (err) {
    log.error('DELETE /:listId/items/checked', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

export default router;
