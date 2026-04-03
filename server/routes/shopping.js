/**
 * Modul: Einkaufslisten (Shopping)
 * Zweck: REST-API-Routen für Einkaufslisten, Artikel, Autocomplete
 * Abhängigkeiten: express, server/db.js
 *
 * Routen-Reihenfolge: Statische Pfade (/suggestions, /items/:id) müssen
 * vor dynamischen (/:listId) registriert sein, damit Express korrekt matcht.
 */

'use strict';

const { createLogger } = require('../logger');
const log = createLogger('Shopping');

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { str, oneOf, collectErrors, MAX_TITLE, MAX_SHORT } = require('../middleware/validate');

// --------------------------------------------------------
// Konstanten
// --------------------------------------------------------

const ITEM_CATEGORIES = [
  'Obst & Gemüse', 'Backwaren', 'Milchprodukte', 'Fleisch & Fisch',
  'Tiefkühl', 'Getränke', 'Haushalt', 'Drogerie', 'Sonstiges',
];

// --------------------------------------------------------
// GET /api/v1/shopping/suggestions?q=…
// Autocomplete-Vorschläge aus bisherigen Artikelnamen.
// Response: { data: string[] }
// --------------------------------------------------------
router.get('/suggestions', (req, res) => {
  try {
    const q = (req.query.q ?? '').trim();
    if (q.length < 1) return res.json({ data: [] });

    const rows = db.get().prepare(`
      SELECT DISTINCT name FROM shopping_items
      WHERE name LIKE ? COLLATE NOCASE
      ORDER BY name ASC
      LIMIT 8
    `).all(`${q}%`);

    res.json({ data: rows.map((r) => r.name) });
  } catch (err) {
    log.error('suggestions Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

// --------------------------------------------------------
// PATCH /api/v1/shopping/items/:itemId
// Artikel aktualisieren (is_checked, name, quantity, category).
// Body: { is_checked?, name?, quantity?, category? }
// Response: { data: ShoppingItem }
// --------------------------------------------------------
router.patch('/items/:itemId', (req, res) => {
  try {
    const item = db.get()
      .prepare('SELECT * FROM shopping_items WHERE id = ?')
      .get(req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Artikel nicht gefunden.', code: 404 });

    const {
      is_checked = item.is_checked,
      name       = item.name,
      quantity   = item.quantity,
      category   = item.category,
    } = req.body;

    if (!name?.trim()) return res.status(400).json({ error: 'name darf nicht leer sein.', code: 400 });
    if (category && !ITEM_CATEGORIES.includes(category))
      return res.status(400).json({ error: 'Ungültige Kategorie.', code: 400 });

    db.get().prepare(`
      UPDATE shopping_items
      SET is_checked = ?, name = ?, quantity = ?, category = ?
      WHERE id = ?
    `).run(is_checked ? 1 : 0, name.trim(), quantity ?? null, category, req.params.itemId);

    const updated = db.get()
      .prepare('SELECT * FROM shopping_items WHERE id = ?')
      .get(req.params.itemId);
    res.json({ data: updated });
  } catch (err) {
    log.error('PATCH items/:id Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/shopping/items/:itemId
// Einzelnen Artikel löschen.
// Response: { ok: true }
// --------------------------------------------------------
router.delete('/items/:itemId', (req, res) => {
  try {
    const result = db.get()
      .prepare('DELETE FROM shopping_items WHERE id = ?')
      .run(req.params.itemId);
    if (result.changes === 0)
      return res.status(404).json({ error: 'Artikel nicht gefunden.', code: 404 });
    res.json({ ok: true });
  } catch (err) {
    log.error('DELETE items/:id Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/shopping
// Alle Einkaufslisten mit Artikel-Zähler.
// Response: { data: ShoppingList[] }
// --------------------------------------------------------
router.get('/', (req, res) => {
  try {
    const lists = db.get().prepare(`
      SELECT
        sl.*,
        COUNT(si.id)                                          AS item_total,
        SUM(CASE WHEN si.is_checked = 1 THEN 1 ELSE 0 END)   AS item_checked
      FROM shopping_lists sl
      LEFT JOIN shopping_items si ON si.list_id = sl.id
      GROUP BY sl.id
      ORDER BY sl.created_at ASC
    `).all();
    res.json({ data: lists });
  } catch (err) {
    log.error('GET / Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/shopping
// Neue Einkaufsliste erstellen.
// Body: { name }
// Response: { data: ShoppingList }
// --------------------------------------------------------
router.post('/', (req, res) => {
  try {
    const vName = str(req.body.name, 'Name', { max: MAX_TITLE });
    if (vName.error) return res.status(400).json({ error: vName.error, code: 400 });

    const result = db.get()
      .prepare('INSERT INTO shopping_lists (name, created_by) VALUES (?, ?)')
      .run(vName.value, req.session.userId);

    const list = db.get()
      .prepare('SELECT * FROM shopping_lists WHERE id = ?')
      .get(result.lastInsertRowid);
    res.status(201).json({ data: list });
  } catch (err) {
    log.error('POST / Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

// --------------------------------------------------------
// PUT /api/v1/shopping/:listId
// Einkaufsliste umbenennen.
// Body: { name }
// Response: { data: ShoppingList }
// --------------------------------------------------------
router.put('/:listId', (req, res) => {
  try {
    const vName = str(req.body.name, 'Name', { max: MAX_TITLE });
    if (vName.error) return res.status(400).json({ error: vName.error, code: 400 });

    const result = db.get()
      .prepare('UPDATE shopping_lists SET name = ? WHERE id = ?')
      .run(vName.value, req.params.listId);
    if (result.changes === 0)
      return res.status(404).json({ error: 'Liste nicht gefunden.', code: 404 });

    const list = db.get()
      .prepare('SELECT * FROM shopping_lists WHERE id = ?')
      .get(req.params.listId);
    res.json({ data: list });
  } catch (err) {
    log.error('PUT /:listId Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/shopping/:listId
// Liste und alle Artikel löschen (CASCADE).
// Response: { ok: true }
// --------------------------------------------------------
router.delete('/:listId', (req, res) => {
  try {
    const result = db.get()
      .prepare('DELETE FROM shopping_lists WHERE id = ?')
      .run(req.params.listId);
    if (result.changes === 0)
      return res.status(404).json({ error: 'Liste nicht gefunden.', code: 404 });
    res.json({ ok: true });
  } catch (err) {
    log.error('DELETE /:listId Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/shopping/:listId/items
// Alle Artikel einer Liste, sortiert nach Supermarkt-Gang-Logik.
// Abgehakte Artikel ans Ende innerhalb ihrer Kategorie.
// Response: { data: ShoppingItem[], list: ShoppingList }
// --------------------------------------------------------
router.get('/:listId/items', (req, res) => {
  try {
    const list = db.get()
      .prepare('SELECT * FROM shopping_lists WHERE id = ?')
      .get(req.params.listId);
    if (!list) return res.status(404).json({ error: 'Liste nicht gefunden.', code: 404 });

    const categoryOrder = ITEM_CATEGORIES.map((c, i) => `WHEN '${c}' THEN ${i}`).join(' ');

    const items = db.get().prepare(`
      SELECT * FROM shopping_items
      WHERE list_id = ?
      ORDER BY
        CASE category ${categoryOrder} ELSE ${ITEM_CATEGORIES.length} END,
        is_checked ASC,
        created_at ASC
    `).all(req.params.listId);

    res.json({ data: items, list });
  } catch (err) {
    log.error('GET /:listId/items Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/shopping/:listId/items
// Artikel zur Liste hinzufügen.
// Body: { name, quantity?, category? }
// Response: { data: ShoppingItem }
// --------------------------------------------------------
router.post('/:listId/items', (req, res) => {
  try {
    const list = db.get()
      .prepare('SELECT id FROM shopping_lists WHERE id = ?')
      .get(req.params.listId);
    if (!list) return res.status(404).json({ error: 'Liste nicht gefunden.', code: 404 });

    const vName = str(req.body.name, 'Name', { max: MAX_TITLE });
    const vQty  = str(req.body.quantity, 'Menge', { max: MAX_SHORT, required: false });
    const vCat  = oneOf(req.body.category || 'Sonstiges', ITEM_CATEGORIES, 'Kategorie');
    const errors = collectErrors([vName, vQty, vCat]);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    const result = db.get().prepare(`
      INSERT INTO shopping_items (list_id, name, quantity, category)
      VALUES (?, ?, ?, ?)
    `).run(req.params.listId, vName.value, vQty.value, vCat.value || 'Sonstiges');

    const item = db.get()
      .prepare('SELECT * FROM shopping_items WHERE id = ?')
      .get(result.lastInsertRowid);
    res.status(201).json({ data: item });
  } catch (err) {
    log.error('POST /:listId/items Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/shopping/:listId/items/checked
// Alle abgehakten Artikel aus einer Liste löschen.
// Response: { deleted: number }
// --------------------------------------------------------
router.delete('/:listId/items/checked', (req, res) => {
  try {
    const result = db.get().prepare(`
      DELETE FROM shopping_items WHERE list_id = ? AND is_checked = 1
    `).run(req.params.listId);
    res.json({ deleted: result.changes });
  } catch (err) {
    log.error('DELETE /:listId/items/checked Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

module.exports = router;
