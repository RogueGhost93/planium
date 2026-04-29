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
const NOTEBOOK_TEXT_MAX = Number.MAX_SAFE_INTEGER;

function dbConn() {
  return db.get();
}

function noteById(noteId, userId, { trashed = false } = {}) {
  return dbConn().prepare(`
    SELECT *
    FROM notebook_notes
    WHERE id = ? AND created_by = ? AND trashed_at IS ${trashed ? 'NOT NULL' : 'NULL'}
  `).get(noteId, userId);
}

function ownedNote(noteId, userId) {
  return noteById(noteId, userId);
}

function activeNoteById(noteId, userId) {
  return dbConn().prepare(`
    SELECT *
    FROM notebook_notes
    WHERE id = ? AND created_by = ? AND trashed_at IS NULL AND locked_at IS NULL
  `).get(noteId, userId);
}

function lockedNoteById(noteId, userId) {
  return dbConn().prepare(`
    SELECT *
    FROM notebook_notes
    WHERE id = ? AND created_by = ? AND trashed_at IS NULL AND locked_at IS NOT NULL
  `).get(noteId, userId);
}

function normalizeSiblingOrder(parentId, userId, { locked = false } = {}) {
  const conn = dbConn();
  const rows = parentId == null
    ? conn.prepare(`
        SELECT id
        FROM notebook_notes
        WHERE created_by = ? AND parent_id IS NULL AND trashed_at IS NULL AND locked_at ${locked ? 'IS NOT NULL' : 'IS NULL'}
        ORDER BY sort_order ASC, created_at ASC, id ASC
      `).all(userId)
    : conn.prepare(`
        SELECT id
        FROM notebook_notes
        WHERE created_by = ? AND parent_id = ? AND trashed_at IS NULL AND locked_at ${locked ? 'IS NOT NULL' : 'IS NULL'}
        ORDER BY sort_order ASC, created_at ASC, id ASC
      `).all(userId, parentId);

  const stmt = conn.prepare(`
    UPDATE notebook_notes
    SET sort_order = ?
    WHERE id = ? AND created_by = ?
  `);

  rows.forEach((row, index) => stmt.run(index, row.id, userId));
}

function subtreeIds(noteId, userId) {
  return dbConn().prepare(`
    WITH RECURSIVE subtree(id) AS (
      SELECT id
      FROM notebook_notes
      WHERE id = ? AND created_by = ?
      UNION ALL
      SELECT n.id
      FROM notebook_notes n
      JOIN subtree s ON n.parent_id = s.id
      WHERE n.created_by = ?
    )
    SELECT id FROM subtree
  `).all(noteId, userId, userId).map((row) => row.id);
}

function anyTrashedAncestor(noteId, userId) {
  let current = dbConn().prepare(`
    SELECT parent_id, trashed_at
    FROM notebook_notes
    WHERE id = ? AND created_by = ?
  `).get(noteId, userId);

  while (current?.parent_id != null) {
    const parent = dbConn().prepare(`
      SELECT parent_id, trashed_at
      FROM notebook_notes
      WHERE id = ? AND created_by = ?
    `).get(current.parent_id, userId);
    if (!parent) return false;
    if (parent.trashed_at != null) return true;
    current = parent;
  }

  return false;
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
      n.trashed_at,
      (
        SELECT COUNT(*)
        FROM notebook_notes c
        WHERE c.parent_id = n.id AND c.created_by = ? AND c.trashed_at IS NULL AND c.locked_at IS NULL
      ) AS child_count
    FROM notebook_notes n
    WHERE n.created_by = ? AND n.trashed_at IS NULL AND n.locked_at IS NULL
    ORDER BY
      CASE WHEN n.parent_id IS NULL THEN 0 ELSE 1 END,
      n.parent_id,
      n.sort_order ASC,
      n.created_at ASC,
      n.id ASC
  `).all(userId, userId);
}

function listTrashedNotes(userId) {
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
      n.trashed_at,
      n.locked_at,
      (
        SELECT COUNT(*)
        FROM notebook_notes c
        WHERE c.parent_id = n.id AND c.created_by = ? AND c.trashed_at IS NOT NULL
      ) AS child_count
    FROM notebook_notes n
    WHERE n.created_by = ? AND n.trashed_at IS NOT NULL
    ORDER BY
      CASE WHEN n.parent_id IS NULL THEN 0 ELSE 1 END,
      n.parent_id,
      n.sort_order ASC,
      n.created_at ASC,
      n.id ASC
  `).all(userId, userId);
}

function listLockedNotes(userId) {
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
      n.trashed_at,
      n.locked_at,
      (
        SELECT COUNT(*)
        FROM notebook_notes c
        WHERE c.parent_id = n.id AND c.created_by = ? AND c.locked_at IS NOT NULL AND c.trashed_at IS NULL
      ) AS child_count
    FROM notebook_notes n
    WHERE n.created_by = ? AND n.trashed_at IS NULL AND n.locked_at IS NOT NULL
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

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function normalizeImportedTimestamp(value, fallback = nowIso()) {
  if (value === undefined || value === null || value === '') return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function sanitizeImportedNode(node, depth = 0) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    return { error: 'Imported notes must be objects.' };
  }

  const titleCheck = str(node.title ?? 'Untitled', 'title', { max: MAX_TITLE });
  if (titleCheck.error) return { error: titleCheck.error };

  const contentCheck = str(node.content ?? '', 'content', { max: NOTEBOOK_TEXT_MAX, required: false });
  if (contentCheck.error) return { error: contentCheck.error };

  if (depth > 100) {
    return { error: 'Imported notes are too deeply nested.' };
  }

  const children = node.children === undefined ? [] : node.children;
  if (!Array.isArray(children)) {
    return { error: 'Imported note children must be an array.' };
  }

  const sanitizedChildren = [];
  for (const child of children) {
    const sanitized = sanitizeImportedNode(child, depth + 1);
    if (sanitized.error) return sanitized;
    sanitizedChildren.push(sanitized.value);
  }

  return {
    value: {
      title: titleCheck.value,
      content: contentCheck.value || '',
      created_at: normalizeImportedTimestamp(node.created_at, nowIso()),
      updated_at: normalizeImportedTimestamp(node.updated_at, normalizeImportedTimestamp(node.created_at, nowIso())),
      children: sanitizedChildren,
    },
  };
}

function insertImportedTree(userId, nodes) {
  const conn = dbConn();
  const insertedIds = [];
  const nextSortOrderByParent = new Map();

  const getNextSortOrder = (parentId) => {
    const key = parentId == null ? 'root' : `parent:${parentId}`;
    if (!nextSortOrderByParent.has(key)) {
      const row = parentId == null
        ? conn.prepare(`
            SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order
            FROM notebook_notes
            WHERE created_by = ? AND parent_id IS NULL
          `).get(userId)
        : conn.prepare(`
            SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order
            FROM notebook_notes
            WHERE created_by = ? AND parent_id = ?
          `).get(userId, parentId);
      nextSortOrderByParent.set(key, row.next_sort_order);
    }

    const current = nextSortOrderByParent.get(key);
    nextSortOrderByParent.set(key, current + 1);
    return current;
  };

  const insertNode = (node, parentId) => {
    const sortOrder = getNextSortOrder(parentId);
    const createdAt = normalizeImportedTimestamp(node.created_at);
    const updatedAt = normalizeImportedTimestamp(node.updated_at, createdAt);
    const result = conn.prepare(`
      INSERT INTO notebook_notes (
        title,
        content,
        parent_id,
        sort_order,
        created_by,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      node.title,
      node.content || '',
      parentId,
      sortOrder,
      userId,
      createdAt,
      updatedAt,
    );

    insertedIds.push(result.lastInsertRowid);
    for (const child of node.children || []) {
      insertNode(child, result.lastInsertRowid);
    }
  };

  const tx = conn.transaction((rootNodes) => {
    for (const node of rootNodes) {
      insertNode(node, null);
    }
  });

  tx(nodes);
  return insertedIds;
}

function deleteAllNotes(userId) {
  dbConn().prepare(`
    DELETE FROM notebook_notes
    WHERE created_by = ?
  `).run(userId);
}

function trashSubtree(noteId, userId) {
  const now = nowIso();
  const ids = subtreeIds(noteId, userId);
  if (!ids.length) return;
  const placeholders = ids.map(() => '?').join(', ');
  dbConn().prepare(`
    UPDATE notebook_notes
    SET trashed_at = ?
    WHERE created_by = ?
      AND id IN (${placeholders})
  `).run(now, userId, ...ids);
}

function lockSubtree(noteId, userId) {
  const now = nowIso();
  const ids = subtreeIds(noteId, userId);
  if (!ids.length) return;
  const placeholders = ids.map(() => '?').join(', ');
  dbConn().prepare(`
    UPDATE notebook_notes
    SET locked_at = ?
    WHERE created_by = ?
      AND trashed_at IS NULL
      AND id IN (${placeholders})
  `).run(now, userId, ...ids);
}

function unlockSubtree(noteId, userId) {
  const ids = subtreeIds(noteId, userId);
  if (!ids.length) return;
  const placeholders = ids.map(() => '?').join(', ');
  dbConn().prepare(`
    UPDATE notebook_notes
    SET locked_at = NULL
    WHERE created_by = ?
      AND id IN (${placeholders})
  `).run(userId, ...ids);
}

function restoreSubtreeAndAncestors(noteId, userId) {
  const ids = subtreeIds(noteId, userId);
  if (!ids.length) return;
  const placeholders = ids.map(() => '?').join(', ');
  dbConn().prepare(`
    UPDATE notebook_notes
    SET trashed_at = NULL
    WHERE created_by = ?
      AND id IN (${placeholders})
  `).run(userId, ...ids);

  let current = dbConn().prepare(`
    SELECT parent_id
    FROM notebook_notes
    WHERE id = ? AND created_by = ?
  `).get(noteId, userId);

  while (current?.parent_id != null) {
    dbConn().prepare(`
      UPDATE notebook_notes
      SET trashed_at = NULL
      WHERE created_by = ? AND id = ?
    `).run(userId, current.parent_id);
    current = dbConn().prepare(`
      SELECT parent_id
      FROM notebook_notes
      WHERE id = ? AND created_by = ?
    `).get(current.parent_id, userId);
  }
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

router.get('/trash', (req, res) => {
  try {
    const userId = req.session.userId;
    res.json({ data: listTrashedNotes(userId) });
  } catch (err) {
    log.error('GET /trash', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

router.get('/locked', (req, res) => {
  try {
    const userId = req.session.userId;
    res.json({ data: listLockedNotes(userId) });
  } catch (err) {
    log.error('GET /locked', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

router.get('/search', (req, res) => {
  try {
    const userId = req.session.userId;
    const query = String(req.query.q ?? '').trim();
    const trashedMode = String(req.query.trashed ?? '') === '1';
    const lockedMode = String(req.query.locked ?? '') === '1';
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
        n.trashed_at,
        n.locked_at,
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
        AND ${trashedMode ? 'n.trashed_at IS NOT NULL' : lockedMode ? 'n.trashed_at IS NULL AND n.locked_at IS NOT NULL' : 'n.trashed_at IS NULL AND n.locked_at IS NULL'}
        AND (
          lower(n.title) LIKE lower(?) ESCAPE '\\'
          OR lower(n.content) LIKE lower(?) ESCAPE '\\'
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
    );

    res.json({ data: results });
  } catch (err) {
    log.error('GET /search', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

router.post('/import', (req, res) => {
  try {
    const userId = req.session.userId;
    const roots = Array.isArray(req.body?.notes) ? req.body.notes : [];
    if (!roots.length) {
      return res.status(400).json({ error: 'No notes were provided for import.', code: 400 });
    }

    const sanitizedRoots = [];
    for (const root of roots) {
      const sanitized = sanitizeImportedNode(root);
      if (sanitized.error) {
        return res.status(400).json({ error: sanitized.error, code: 400 });
      }
      sanitizedRoots.push(sanitized.value);
    }

    const insertedIds = insertImportedTree(userId, sanitizedRoots);
    res.status(201).json({
      data: {
        imported: insertedIds.length,
        root_ids: insertedIds,
      },
    });
  } catch (err) {
    log.error('POST /import', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

router.delete('/clear', (req, res) => {
  try {
    const userId = req.session.userId;
    deleteAllNotes(userId);
    res.status(204).end();
  } catch (err) {
    log.error('DELETE /clear', err);
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

    const note = noteById(noteId, userId);
    if (!note) {
      return res.status(404).json({ error: 'Note not found.', code: 404 });
    }

    const children = dbConn().prepare(`
      SELECT id
      FROM notebook_notes
      WHERE created_by = ? AND parent_id = ? AND trashed_at IS NULL
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
      : str(req.body.content, 'content', { max: NOTEBOOK_TEXT_MAX, required: false });
    const vParent = parseNullableParentId(req.body.parent_id);
    const errs = collectErrors([vTitle, vContent, vParent]);

    if (errs.length) {
      return res.status(400).json({ error: errs.join(' '), code: 400 });
    }

    const parentId = vParent.value;
    if (parentId != null && !activeNoteById(parentId, userId)) {
      return res.status(404).json({ error: 'Parent note not found.', code: 404 });
    }

    const nextSortOrder = parentId == null
      ? dbConn().prepare(`
          SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order
          FROM notebook_notes
          WHERE created_by = ? AND parent_id IS NULL AND trashed_at IS NULL AND locked_at IS NULL
        `).get(userId).next_sort_order
      : dbConn().prepare(`
          SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order
          FROM notebook_notes
          WHERE created_by = ? AND parent_id = ? AND trashed_at IS NULL AND locked_at IS NULL
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

    const note = noteById(noteId, userId);
    if (!note) {
      return res.status(404).json({ error: 'Note not found.', code: 404 });
    }
    if (note.trashed_at != null) {
      return res.status(409).json({ error: 'Trashed notes cannot be edited.', code: 409 });
    }

    const updates = {};
    const errs = [];

    if (req.body.title !== undefined) {
      const v = str(req.body.title, 'title', { max: MAX_TITLE });
      if (v.error) errs.push(v.error);
      else updates.title = v.value;
    }

    if (req.body.content !== undefined) {
      const v = str(req.body.content, 'content', { max: NOTEBOOK_TEXT_MAX, required: false });
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
          const parent = note.locked_at != null
            ? lockedNoteById(nextParentId, userId)
            : activeNoteById(nextParentId, userId);
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
      parentsToNormalize.forEach((parentId) => normalizeSiblingOrder(parentId, userId, { locked: note.locked_at != null }));
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

    const note = dbConn().prepare(`
      SELECT *
      FROM notebook_notes
      WHERE id = ? AND created_by = ?
    `).get(noteId, userId);
    if (!note) {
      return res.status(404).json({ error: 'Note not found.', code: 404 });
    }

    dbConn().prepare(`
      DELETE FROM notebook_notes
      WHERE id = ? AND created_by = ?
    `).run(noteId, userId);
    res.status(204).end();
  } catch (err) {
    log.error('DELETE /:id', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

router.post('/:id/trash', (req, res) => {
  try {
    const userId = req.session.userId;
    const noteId = parseInt(req.params.id, 10);
    if (!noteId) {
      return res.status(400).json({ error: 'Invalid note ID.', code: 400 });
    }

    const note = noteById(noteId, userId);
    if (!note) {
      return res.status(404).json({ error: 'Note not found.', code: 404 });
    }

    trashSubtree(noteId, userId);
    normalizeSiblingOrder(note.parent_id, userId);
    res.status(204).end();
  } catch (err) {
    log.error('POST /:id/trash', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

router.post('/:id/lock', (req, res) => {
  try {
    const userId = req.session.userId;
    const noteId = parseInt(req.params.id, 10);
    if (!noteId) {
      return res.status(400).json({ error: 'Invalid note ID.', code: 400 });
    }

    const note = noteById(noteId, userId);
    if (!note || note.trashed_at != null) {
      return res.status(404).json({ error: 'Note not found.', code: 404 });
    }

    lockSubtree(noteId, userId);
    normalizeSiblingOrder(note.parent_id, userId);
    normalizeSiblingOrder(note.parent_id, userId, { locked: true });
    res.status(204).end();
  } catch (err) {
    log.error('POST /:id/lock', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

router.post('/:id/unlock', (req, res) => {
  try {
    const userId = req.session.userId;
    const noteId = parseInt(req.params.id, 10);
    if (!noteId) {
      return res.status(400).json({ error: 'Invalid note ID.', code: 400 });
    }

    const note = lockedNoteById(noteId, userId);
    if (!note) {
      return res.status(404).json({ error: 'Locked note not found.', code: 404 });
    }

    unlockSubtree(noteId, userId);
    normalizeSiblingOrder(note.parent_id, userId);
    normalizeSiblingOrder(note.parent_id, userId, { locked: true });
    res.status(204).end();
  } catch (err) {
    log.error('POST /:id/unlock', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

router.post('/:id/restore', (req, res) => {
  try {
    const userId = req.session.userId;
    const noteId = parseInt(req.params.id, 10);
    if (!noteId) {
      return res.status(400).json({ error: 'Invalid note ID.', code: 400 });
    }

    const note = noteById(noteId, userId, { trashed: true });
    if (!note) {
      return res.status(404).json({ error: 'Trashed note not found.', code: 404 });
    }

    restoreSubtreeAndAncestors(noteId, userId);
    normalizeSiblingOrder(note.parent_id, userId);
    res.status(204).end();
  } catch (err) {
    log.error('POST /:id/restore', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

export default router;
