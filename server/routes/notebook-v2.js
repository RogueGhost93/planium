/**
 * Module: Notebook
 * Purpose: Hierarchical note tree with Markdown content and search.
 */

import express from 'express';
import * as db from '../db.js';
import { createLogger } from '../logger.js';
import { str, id, collectErrors, MAX_TITLE, MAX_TEXT } from '../middleware/validate.js';

const log = createLogger('Notebook');
const router = express.Router();

function dbConn() {
  return db.get();
}

function ownedNote(noteId, userId) {
  return dbConn().prepare(`
    SELECT *
    FROM notebook_notes
    WHERE id = ? AND created_by = ?
  `).get(noteId, userId);
}

function normalizeSiblingOrder(parentId, userId) {
  const conn = dbConn();
  const rows = parentId == null
    ? conn.prepare(`
        SELECT id
        FROM notebook_notes
        WHERE created_by = ? AND parent_id IS NULL
        ORDER BY sort_order ASC, created_at ASC, id ASC
      `).all(userId)
    : conn.prepare(`
        SELECT id
        FROM notebook_notes
        WHERE created_by = ? AND parent_id = ?
        ORDER BY sort_order ASC, created_at ASC, id ASC
      `).all(userId, parentId);

  const stmt = conn.prepare(`
    UPDATE notebook_notes
    SET sort_order = ?
    WHERE id = ? AND created_by = ?
  `);

  rows.forEach((row, index) => stmt.run(index, row.id, userId));
}

function isDescendant(noteId, potentialParentId, userId) {
  if (potentialParentId == null) return false;

  const row = dbConn().prepare(`
    WITH RECURSIVE descendants(id) AS (
      SELECT id
      FROM notebook_notes
      WHERE parent_id = ? AND created_by = ?
      UNION ALL
      SELECT n.id
      FROM notebook_notes n
      JOIN descendants d ON n.parent_id = d.id
      WHERE n.created_by = ?
    )
    SELECT 1 AS found
    FROM descendants
    WHERE id = ?
    LIMIT 1
  `).get(noteId, userId, userId, potentialParentId);

  return Boolean(row);
}

function listNotes(userId) {
  return dbConn().prepare(`
    SELECT
      n.id,
      n.title,
      n.content,
      n.parent_id,
      n.sort_order,
      n.created_by,
      n.created_at,
      n.updated_at,
      (
        SELECT COUNT(*)
        FROM notebook_notes c
        WHERE c.parent_id = n.id AND c.created_by = ?
      ) AS child_count
    FROM notebook_notes n
    WHERE n.created_by = ?
    ORDER BY
      CASE WHEN n.parent_id IS NULL THEN 0 ELSE 1 END,
      n.parent_id,
      n.sort_order ASC,
      n.created_at ASC,
      n.id ASC
  `).all(userId, userId);
}

function parseNullableParentId(value) {
  if (value === undefined || value === null || value === '') {
    return { value: null };
  }
  return id(value, 'parent_id');
}

router.get('/', (req, res) => {
  try {
    const userId = req.session.userId;
    res.json({ data: listNotes(userId) });
  } catch (err) {
    log.error('GET /', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

router.get('/search', (req, res) => {
  try {
    const userId = req.session.userId;
    const query = String(req.query.q ?? '').trim();
    if (!query) {
      return res.json({ data: [] });
    }

    const escLike = (value) => value.replace(/[\\%_]/g, '\\$&');
    const likePattern = `%${escLike(query)}%`;

    const results = dbConn().prepare(`
      SELECT
        n.id,
        n.title,
        n.content,
        n.parent_id,
        n.sort_order,
        n.updated_at,
        CASE
          WHEN lower(n.content) LIKE lower(?) ESCAPE '\\' THEN
            substr(
              n.content,
              CASE
                WHEN instr(lower(n.content), lower(?)) > 40
                  THEN instr(lower(n.content), lower(?)) - 40
                ELSE 1
              END,
              140
            )
          WHEN lower(n.title) LIKE lower(?) ESCAPE '\\' THEN
            n.content
          ELSE NULL
        END AS excerpt,
        CASE
          WHEN lower(n.title) LIKE lower(?) ESCAPE '\\' THEN 0
          WHEN lower(n.content) LIKE lower(?) ESCAPE '\\' THEN 1
          ELSE 2
        END AS relevance
      FROM notebook_notes n
      WHERE n.created_by = ?
        AND (
          lower(n.title) LIKE lower(?) ESCAPE '\\'
          OR lower(n.content) LIKE lower(?) ESCAPE '\\'
          OR EXISTS (
            SELECT 1
            FROM notebook_notes_fts fts
            WHERE fts.rowid = n.id AND fts MATCH ?
          )
        )
      ORDER BY relevance ASC, n.updated_at DESC
      LIMIT 50
    `).all(
      likePattern,
      query,
      query,
      likePattern,
      likePattern,
      likePattern,
      userId,
      likePattern,
      likePattern,
      query,
    );

    res.json({ data: results });
  } catch (err) {
    log.error('GET /search', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

router.get('/:id', (req, res) => {
  try {
    const userId = req.session.userId;
    const noteId = parseInt(req.params.id, 10);
    if (!noteId) {
      return res.status(400).json({ error: 'Invalid note ID.', code: 400 });
    }

    const note = ownedNote(noteId, userId);
    if (!note) {
      return res.status(404).json({ error: 'Note not found.', code: 404 });
    }

    const children = dbConn().prepare(`
      SELECT id
      FROM notebook_notes
      WHERE created_by = ? AND parent_id = ?
      ORDER BY sort_order ASC, created_at ASC, id ASC
    `).all(userId, noteId);

    res.json({
      data: {
        ...note,
        child_count: children.length,
      },
    });
  } catch (err) {
    log.error('GET /:id', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

router.post('/', (req, res) => {
  try {
    const userId = req.session.userId;
    const vTitle = req.body.title === undefined
      ? { value: 'Untitled' }
      : str(req.body.title, 'title', { max: MAX_TITLE });
    const vContent = req.body.content === undefined
      ? { value: '' }
      : str(req.body.content, 'content', { max: MAX_TEXT, required: false });
    const vParent = parseNullableParentId(req.body.parent_id);
    const errs = collectErrors([vTitle, vContent, vParent]);

    if (errs.length) {
      return res.status(400).json({ error: errs.join(' '), code: 400 });
    }

    const parentId = vParent.value;
    if (parentId != null && !ownedNote(parentId, userId)) {
      return res.status(404).json({ error: 'Parent note not found.', code: 404 });
    }

    const nextSortOrder = parentId == null
      ? dbConn().prepare(`
          SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order
          FROM notebook_notes
          WHERE created_by = ? AND parent_id IS NULL
        `).get(userId).next_sort_order
      : dbConn().prepare(`
          SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order
          FROM notebook_notes
          WHERE created_by = ? AND parent_id = ?
        `).get(userId, parentId).next_sort_order;

    const result = dbConn().prepare(`
      INSERT INTO notebook_notes (title, content, parent_id, sort_order, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(vTitle.value, vContent.value || '', parentId, nextSortOrder, userId);

    normalizeSiblingOrder(parentId, userId);

    const note = ownedNote(result.lastInsertRowid, userId);
    res.status(201).json({ data: note });
  } catch (err) {
    log.error('POST /', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

router.put('/:id', (req, res) => {
  try {
    const userId = req.session.userId;
    const noteId = parseInt(req.params.id, 10);
    if (!noteId) {
      return res.status(400).json({ error: 'Invalid note ID.', code: 400 });
    }

    const note = ownedNote(noteId, userId);
    if (!note) {
      return res.status(404).json({ error: 'Note not found.', code: 404 });
    }

    const updates = {};
    const errs = [];

    if (req.body.title !== undefined) {
      const v = str(req.body.title, 'title', { max: MAX_TITLE });
      if (v.error) errs.push(v.error);
      else updates.title = v.value;
    }

    if (req.body.content !== undefined) {
      const v = str(req.body.content, 'content', { max: MAX_TEXT, required: false });
      if (v.error) errs.push(v.error);
      else updates.content = v.value || '';
    }

    let nextParentId = note.parent_id;
    if (req.body.parent_id !== undefined) {
      const v = parseNullableParentId(req.body.parent_id);
      if (v.error) {
        errs.push(v.error);
      } else {
        nextParentId = v.value;
        if (nextParentId === noteId) {
          errs.push('Cannot move note to itself.');
        } else if (nextParentId != null) {
          const parent = ownedNote(nextParentId, userId);
          if (!parent) {
            errs.push('Parent note not found.');
          } else if (isDescendant(noteId, nextParentId, userId)) {
            errs.push('Cannot move note into one of its descendants.');
          } else {
            updates.parent_id = nextParentId;
          }
        } else {
          updates.parent_id = null;
        }
      }
    }

    if (req.body.sort_order !== undefined) {
      const v = id(req.body.sort_order, 'sort_order');
      if (v.error) errs.push(v.error);
      else updates.sort_order = v.value;
    }

    if (errs.length) {
      return res.status(400).json({ error: errs.join(' '), code: 400 });
    }

    const oldParentId = note.parent_id;

    if (Object.keys(updates).length) {
      const fields = Object.keys(updates);
      const values = fields.map((key) => updates[key]);
      values.push(noteId, userId);

      dbConn().prepare(`
        UPDATE notebook_notes
        SET ${fields.map((key) => `${key} = ?`).join(', ')}
        WHERE id = ? AND created_by = ?
      `).run(...values);

      const parentsToNormalize = new Set([oldParentId, nextParentId]);
      parentsToNormalize.forEach((parentId) => normalizeSiblingOrder(parentId, userId));
    }

    const updated = ownedNote(noteId, userId);
    res.json({ data: updated });
  } catch (err) {
    log.error('PUT /:id', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const userId = req.session.userId;
    const noteId = parseInt(req.params.id, 10);
    if (!noteId) {
      return res.status(400).json({ error: 'Invalid note ID.', code: 400 });
    }

    const note = ownedNote(noteId, userId);
    if (!note) {
      return res.status(404).json({ error: 'Note not found.', code: 404 });
    }

    const parentId = note.parent_id;
    dbConn().prepare(`
      DELETE FROM notebook_notes
      WHERE id = ? AND created_by = ?
    `).run(noteId, userId);

    normalizeSiblingOrder(parentId, userId);
    res.status(204).end();
  } catch (err) {
    log.error('DELETE /:id', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

export default router;
