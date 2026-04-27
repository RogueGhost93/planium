/**
 * Modul: Notizbuch / Notebook
 * Zweck: REST-API für hierarchische, tagbare Notizen pro Benutzer.
 *        Vollständiger CRUD mit Baum-Support, FTS-Suche, Tag-Verwaltung.
 * Abhängigkeiten: express, server/db.js, validate.js
 */

import { createLogger } from '../logger.js';
import express from 'express';
import * as db from '../db.js';
import { str, id, collectErrors, MAX_TITLE, MAX_TEXT } from '../middleware/validate.js';

const log = createLogger('Notebook');
const router = express.Router();

// --------------------------------------------------------
// Helpers
// --------------------------------------------------------

/** Owner check: returns note only if user created it. */
function ownedNote(noteId, userId) {
  return db.get()
    .prepare('SELECT * FROM notebook_notes WHERE id = ? AND created_by = ?')
    .get(noteId, userId);
}

/** Owner check: returns tag only if user owns it. */
function ownedTag(tagId, userId) {
  return db.get()
    .prepare('SELECT * FROM notebook_tags WHERE id = ? AND user_id = ?')
    .get(tagId, userId);
}

// --------------------------------------------------------
// GET /api/v1/notebook
// Full tree for user: all notes with tags, ordered by sort_order
// --------------------------------------------------------
router.get('/', (req, res) => {
  try {
    const uid = req.session.userId;
    const notes = db.get().prepare(`
      SELECT
        n.id,
        n.title,
        n.content,
        n.parent_id,
        n.sort_order,
        n.created_by,
        n.created_at,
        n.updated_at,
        GROUP_CONCAT(t.id)   AS tag_ids,
        GROUP_CONCAT(t.name) AS tag_names
      FROM notebook_notes n
      LEFT JOIN notebook_note_tags nt ON nt.note_id = n.id
      LEFT JOIN notebook_tags t       ON t.id = nt.tag_id
      WHERE n.created_by = ?
      GROUP BY n.id
      ORDER BY n.sort_order ASC, n.created_at ASC
    `).all(uid);

    const tree = buildTree(notes);
    res.json({ data: tree });
  } catch (err) {
    log.error('GET /', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

/**
 * Client-side tree builder. Converts flat array to hierarchical structure.
 */
function buildTree(notes, parentId = null) {
  return notes
    .filter(n => (n.parent_id ?? null) === parentId)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(n => ({
      ...n,
      tag_ids: n.tag_ids ? n.tag_ids.split(',').map(Number) : [],
      tag_names: n.tag_names ? n.tag_names.split(',') : [],
      children: buildTree(notes, n.id),
    }));
}

// --------------------------------------------------------
// POST /api/v1/notebook
// Create note: body { title, content?, parent_id? }
// --------------------------------------------------------
router.post('/', (req, res) => {
  try {
    const vTitle = str(req.body.title, 'title', { max: MAX_TITLE });
    const vContent = str(req.body.content, 'content', { max: MAX_TEXT, required: false });
    const vParent = req.body.parent_id ? id(req.body.parent_id, 'parent_id') : { value: null };
    const errs = collectErrors([vTitle, vContent, vParent]);

    if (errs.length) {
      return res.status(400).json({ error: errs.join(' '), code: 400 });
    }

    const uid = req.session.userId;
    const title = vTitle.value;
    const content = vContent.value || '';
    const parentId = vParent.value;

    // If parent_id is set, verify it exists and belongs to user
    if (parentId) {
      const parent = ownedNote(parentId, uid);
      if (!parent) {
        return res.status(404).json({ error: 'Parent note not found.', code: 404 });
      }
    }

    // Get max sort_order for siblings
    const sibling = db.get().prepare(`
      SELECT MAX(sort_order) as max_order
      FROM notebook_notes
      WHERE created_by = ? AND (parent_id IS NULL OR parent_id = ?)
    `).get(uid, parentId);
    const sortOrder = (sibling.max_order ?? -1) + 1;

    const result = db.get().prepare(`
      INSERT INTO notebook_notes (title, content, parent_id, sort_order, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(title, content, parentId, sortOrder, uid);

    const note = ownedNote(result.lastInsertRowid, uid);
    res.status(201).json({
      data: {
        ...note,
        tag_ids: [],
        tag_names: [],
        children: [],
      },
    });
  } catch (err) {
    log.error('POST /', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

// --------------------------------------------------------
// PUT /api/v1/notebook/:id
// Update note: body { title?, content?, parent_id?, sort_order?, tag_ids? }
// --------------------------------------------------------
router.put('/:id', (req, res) => {
  try {
    const uid = req.session.userId;
    const noteId = parseInt(req.params.id, 10);

    if (!noteId) {
      return res.status(400).json({ error: 'Invalid note ID.', code: 400 });
    }

    const note = ownedNote(noteId, uid);
    if (!note) {
      return res.status(404).json({ error: 'Note not found.', code: 404 });
    }

    // Validate inputs
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

    if (req.body.parent_id !== undefined) {
      if (req.body.parent_id === null) {
        updates.parent_id = null;
      } else {
        const v = id(req.body.parent_id, 'parent_id');
        if (v.error) {
          errs.push(v.error);
        } else {
          // Prevent moving note to itself or its children (cycle check)
          if (v.value === noteId) {
            errs.push('Cannot move note to itself.');
          } else {
            const newParent = ownedNote(v.value, uid);
            if (!newParent) {
              errs.push('Parent note not found.');
            } else {
              updates.parent_id = v.value;
            }
          }
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

    // Apply updates
    if (Object.keys(updates).length) {
      updates.updated_at = new Date().toISOString();
      const fields = Object.keys(updates);
      const placeholders = fields.map(f => `${f} = ?`).join(', ');
      const values = fields.map(f => updates[f]);
      values.push(noteId, uid);

      db.get().prepare(`
        UPDATE notebook_notes
        SET ${placeholders}
        WHERE id = ? AND created_by = ?
      `).run(...values);
    }

    // Handle tag_ids if provided
    if (req.body.tag_ids !== undefined) {
      const tagIds = Array.isArray(req.body.tag_ids) ? req.body.tag_ids : [];

      // Verify all tag_ids belong to user
      if (tagIds.length) {
        const placeholders = tagIds.map(() => '?').join(',');
        const ownedCount = db.get().prepare(
          `SELECT COUNT(*) as cnt FROM notebook_tags WHERE user_id = ? AND id IN (${placeholders})`
        ).get(uid, ...tagIds).cnt;
        if (ownedCount !== tagIds.length) {
          return res.status(403).json({ error: 'Not authorized to use these tags.', code: 403 });
        }
      }

      // Clear old tags and insert new ones
      db.get().prepare('DELETE FROM notebook_note_tags WHERE note_id = ?').run(noteId);
      if (tagIds.length) {
        const stmt = db.get().prepare(
          'INSERT INTO notebook_note_tags (note_id, tag_id) VALUES (?, ?)'
        );
        for (const tagId of tagIds) {
          stmt.run(noteId, tagId);
        }
      }
    }

    // Fetch updated note with tags
    const updated = db.get().prepare(`
      SELECT
        n.*,
        GROUP_CONCAT(t.id)   AS tag_ids,
        GROUP_CONCAT(t.name) AS tag_names
      FROM notebook_notes n
      LEFT JOIN notebook_note_tags nt ON nt.note_id = n.id
      LEFT JOIN notebook_tags t       ON t.id = nt.tag_id
      WHERE n.id = ? AND n.created_by = ?
      GROUP BY n.id
    `).get(noteId, uid);

    res.json({
      data: {
        ...updated,
        tag_ids: updated.tag_ids ? updated.tag_ids.split(',').map(Number) : [],
        tag_names: updated.tag_names ? updated.tag_names.split(',') : [],
      },
    });
  } catch (err) {
    log.error('PUT /:id', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/notebook/:id
// Delete note (CASCADE handles children)
// --------------------------------------------------------
router.delete('/:id', (req, res) => {
  try {
    const uid = req.session.userId;
    const noteId = parseInt(req.params.id, 10);

    if (!noteId) {
      return res.status(400).json({ error: 'Invalid note ID.', code: 400 });
    }

    const note = ownedNote(noteId, uid);
    if (!note) {
      return res.status(404).json({ error: 'Note not found.', code: 404 });
    }

    db.get().prepare('DELETE FROM notebook_notes WHERE id = ? AND created_by = ?')
      .run(noteId, uid);

    res.status(204).end();
  } catch (err) {
    log.error('DELETE /:id', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/notebook/search
// Query: ?q=<search term>
// Returns matching notes with FTS snippet
// --------------------------------------------------------
router.get('/search', (req, res) => {
  try {
    const uid = req.session.userId;
    const query = (req.query.q ?? '').trim();

    if (!query) {
      return res.json({ data: [] });
    }

    // FTS5 search with snippet
    const results = db.get().prepare(`
      SELECT
        n.id,
        n.title,
        n.parent_id,
        snippet(notebook_notes_fts, 1, '<mark>', '</mark>', '…', 20) AS excerpt,
        rank
      FROM notebook_notes_fts
      JOIN notebook_notes n ON n.id = notebook_notes_fts.rowid
      WHERE notebook_notes_fts MATCH ? AND n.created_by = ?
      ORDER BY rank ASC
      LIMIT 50
    `).all(query, uid);

    res.json({ data: results });
  } catch (err) {
    log.error('GET /search', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/notebook/tags
// List all tags for the current user
// --------------------------------------------------------
router.get('/tags', (req, res) => {
  try {
    const uid = req.session.userId;
    const tags = db.get().prepare(`
      SELECT id, name, user_id
      FROM notebook_tags
      WHERE user_id = ?
      ORDER BY name ASC
    `).all(uid);

    res.json({ data: tags });
  } catch (err) {
    log.error('GET /tags', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/notebook/tags
// Create tag: body { name }
// --------------------------------------------------------
router.post('/tags', (req, res) => {
  try {
    const uid = req.session.userId;
    const vName = str(req.body.name, 'name', { max: 50 });
    if (vName.error) {
      return res.status(400).json({ error: vName.error, code: 400 });
    }

    const name = vName.value;

    // Check for duplicate
    const existing = db.get().prepare(
      'SELECT id FROM notebook_tags WHERE user_id = ? AND name = ?'
    ).get(uid, name);
    if (existing) {
      return res.status(409).json({ error: 'Tag already exists.', code: 409 });
    }

    const result = db.get().prepare(
      'INSERT INTO notebook_tags (name, user_id) VALUES (?, ?)'
    ).run(name, uid);

    const tag = db.get().prepare(
      'SELECT id, name, user_id FROM notebook_tags WHERE id = ?'
    ).get(result.lastInsertRowid);

    res.status(201).json({ data: tag });
  } catch (err) {
    log.error('POST /tags', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/notebook/tags/:id
// Delete tag (removes from all notes)
// --------------------------------------------------------
router.delete('/tags/:id', (req, res) => {
  try {
    const uid = req.session.userId;
    const tagId = parseInt(req.params.id, 10);

    if (!tagId) {
      return res.status(400).json({ error: 'Invalid tag ID.', code: 400 });
    }

    const tag = ownedTag(tagId, uid);
    if (!tag) {
      return res.status(404).json({ error: 'Tag not found.', code: 404 });
    }

    db.get().prepare('DELETE FROM notebook_tags WHERE id = ? AND user_id = ?')
      .run(tagId, uid);

    res.status(204).end();
  } catch (err) {
    log.error('DELETE /tags/:id', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

export default router;
