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
import { nextOccurrence } from '../services/recurrence.js';

const VALID_PERSONAL_PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'];
const VALID_PERSONAL_STATUSES = ['open', 'in_progress', 'done'];
const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%SZ', 'now')";
const PERSONAL_LABEL_COLORS = [
  '#2563EB', '#0B7A73', '#16A34A', '#C2410C',
  '#DC2626', '#7C3AED', '#DB2777', '#0F766E',
];

const log = createLogger('PersonalLists');
const router = express.Router();
const PERSONAL_TASK_HAS_STATUS = db
  .get()
  .prepare('PRAGMA table_info(personal_tasks)')
  .all()
  .some((column) => column.name === 'status');
const PERSONAL_TASK_HAS_DELETED_AT = db
  .get()
  .prepare('PRAGMA table_info(personal_tasks)')
  .all()
  .some((column) => column.name === 'deleted_at');
const TASK_LIST_HAS_IS_HOUSEHOLD = db
  .get()
  .prepare('PRAGMA table_info(task_lists)')
  .all()
  .some((column) => column.name === 'is_household');

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

function personalStatusExpr(alias = 't') {
  if (!PERSONAL_TASK_HAS_STATUS) {
    return `CASE WHEN ${alias}.done = 1 THEN 'done' ELSE 'open' END`;
  }
  return `COALESCE(${alias}.status, CASE WHEN ${alias}.done = 1 THEN 'done' ELSE 'open' END)`;
}

function personalTaskSelectExpr(alias = 't') {
  if (PERSONAL_TASK_HAS_STATUS) {
    return `${alias}.*`;
  }
  return `${alias}.*, CASE WHEN ${alias}.done = 1 THEN 'done' ELSE 'open' END AS status`;
}

function personalTrashExpr(alias = 't') {
  return PERSONAL_TASK_HAS_DELETED_AT ? `${alias}.deleted_at IS NOT NULL` : '0';
}

function personalActiveExpr(alias = 't') {
  return PERSONAL_TASK_HAS_DELETED_AT ? `${alias}.deleted_at IS NULL` : '1';
}

function personalTrashOrderExpr(alias = 't') {
  return PERSONAL_TASK_HAS_DELETED_AT ? `${alias}.deleted_at DESC,` : '';
}

function normalizeLabelName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function parseLabelNames(raw) {
  if (raw == null) return [];
  const values = Array.isArray(raw)
    ? raw
    : String(raw).split(/[,;\n]/);
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const name = normalizeLabelName(value);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

function colorForLabelName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return PERSONAL_LABEL_COLORS[hash % PERSONAL_LABEL_COLORS.length];
}

function attachLabelsToItems(listId, items) {
  if (!items.length) return items;
  const ids = items.map((item) => Number(item.id)).filter(Number.isInteger);
  if (!ids.length) return items;

  const placeholders = ids.map(() => '?').join(',');
  const rows = db.get().prepare(`
    SELECT ptl.task_id, pl.id, pl.name, pl.color
    FROM personal_task_labels ptl
    JOIN personal_labels pl ON pl.id = ptl.label_id
    WHERE pl.list_id = ? AND ptl.task_id IN (${placeholders})
    ORDER BY ptl.task_id ASC, pl.name ASC
  `).all(listId, ...ids);

  const byTask = new Map();
  for (const row of rows) {
    if (!byTask.has(row.task_id)) byTask.set(row.task_id, []);
    byTask.get(row.task_id).push({ id: row.id, name: row.name, color: row.color });
  }

  for (const item of items) {
    item.labels = byTask.get(item.id) || [];
  }
  return items;
}

function loadPersonalItemWithLabels(listId, itemId) {
    const item = db.get()
      .prepare(`
      SELECT ${personalTaskSelectExpr('t')},
             u.display_name AS assigned_name,
             u.avatar_color AS assigned_color
      FROM personal_tasks t
      LEFT JOIN users u ON u.id = t.assigned_to
      WHERE t.id = ? AND t.list_id = ? AND ${personalActiveExpr('t')}
    `)
    .get(itemId, listId);
  if (!item) return null;
  return attachLabelsToItems(listId, [item])[0] ?? item;
}

function syncPersonalItemLabels(listId, itemId, rawLabelNames) {
  const labelNames = parseLabelNames(rawLabelNames);
  const d = db.get();
  const existing = d.prepare(`
    SELECT id, name, color
    FROM personal_labels
    WHERE list_id = ?
  `).all(listId);
  const byName = new Map(existing.map((row) => [row.name.toLowerCase(), row]));
  const labelIds = [];

  for (const name of labelNames) {
    const key = name.toLowerCase();
    let label = byName.get(key);
    if (!label) {
      const color = colorForLabelName(name);
      const result = d.prepare(`
        INSERT INTO personal_labels (list_id, name, color)
        VALUES (?, ?, ?)
      `).run(listId, name, color);
      label = { id: result.lastInsertRowid, name, color };
      byName.set(key, label);
    }
    labelIds.push(label.id);
  }

  d.prepare('DELETE FROM personal_task_labels WHERE task_id = ?').run(itemId);
  if (labelIds.length) {
    const insert = d.prepare(`
      INSERT OR IGNORE INTO personal_task_labels (task_id, label_id)
      VALUES (?, ?)
    `);
    for (const labelId of labelIds) insert.run(itemId, labelId);
  }
}

function loadPersonalLabels(listId) {
  return db.get().prepare(`
    SELECT
      pl.id,
      pl.name,
      pl.color,
      COALESCE(COUNT(DISTINCT ptl.task_id), 0) AS task_count
    FROM personal_labels pl
    LEFT JOIN personal_task_labels ptl ON ptl.label_id = pl.id
    WHERE pl.list_id = ?
    GROUP BY pl.id
    ORDER BY pl.name ASC
  `).all(listId);
}

function loadPersonalLabel(listId, labelId) {
  return db.get().prepare(`
    SELECT
      pl.id,
      pl.name,
      pl.color,
      COALESCE(COUNT(DISTINCT ptl.task_id), 0) AS task_count
    FROM personal_labels pl
    LEFT JOIN personal_task_labels ptl ON ptl.label_id = pl.id
    WHERE pl.list_id = ? AND pl.id = ?
    GROUP BY pl.id
  `).get(listId, labelId);
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
        COALESCE(SUM(CASE WHEN ${personalStatusExpr('t')} != 'done' THEN 1 ELSE 0 END), 0) AS pending_count,
        COALESCE(COUNT(t.id), 0) AS total_count
      FROM task_lists l
      LEFT JOIN users u           ON u.id = l.owner_id
      LEFT JOIN personal_tasks t  ON t.list_id = l.id AND ${personalActiveExpr('t')}
      WHERE l.owner_id = ?
         OR EXISTS (SELECT 1 FROM task_list_shares s
                    WHERE s.list_id = l.id AND s.user_id = ?)
      GROUP BY l.id
      ORDER BY ${TASK_LIST_HAS_IS_HOUSEHOLD ? 'l.is_household DESC,' : ''} l.sort_order ASC, l.created_at ASC
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

    const show_priority = req.body.show_priority !== undefined ? (req.body.show_priority ? 1 : 0) : 1;

    const id = db.transaction(() => {
      const maxOrder = db.get()
        .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM task_lists WHERE owner_id = ?')
        .get(req.session.userId).m;
      const result = db.get().prepare(`
        INSERT INTO task_lists (owner_id, name, color, sort_order, show_priority)
        VALUES (?, ?, ?, ?, ?)
      `).run(req.session.userId, vName.value, vColor.value || '#2563EB', maxOrder + 1, show_priority);
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
// PATCH /api/v1/personal-lists/reorder   (per-user)
// Body: { ids: number[] } — only lists owned by the current user are reordered.
// IDs not owned by the user are silently skipped.
// --------------------------------------------------------
router.patch('/reorder', (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array.', code: 400 });

    const update = db.get().prepare(
      'UPDATE task_lists SET sort_order = ? WHERE id = ? AND owner_id = ?'
    );
    const updateAll = db.get().transaction((arr, uid) => {
      arr.forEach((id, i) => update.run(i, id, uid));
    });
    updateAll(ids.map((n) => Number(n)).filter(Number.isInteger), req.session.userId);

    res.json({ ok: true });
  } catch (err) {
    log.error('PATCH /reorder', err);
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

    const newName         = req.body.name          !== undefined ? req.body.name.trim() : list.name;
    const newColor        = req.body.color         !== undefined ? req.body.color       : list.color;
    const newShowPriority = req.body.show_priority !== undefined ? (req.body.show_priority ? 1 : 0) : list.show_priority;

    db.get().prepare('UPDATE task_lists SET name = ?, color = ?, show_priority = ? WHERE id = ?')
      .run(newName, newColor, newShowPriority, req.params.id);

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
    if (list.is_household) return res.status(403).json({ error: 'Cannot delete the household list.', code: 403 });

    db.get().prepare('DELETE FROM task_lists WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    log.error('DELETE /:id', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/personal-lists/:id/items
// Open first, then in progress, then done; insertion order within each.
// Pass ?deleted=1 to fetch trashed items.
// Accessible to owner OR shared users.
// --------------------------------------------------------
router.get('/:id/items', (req, res) => {
  try {
    const list = accessibleList(req.params.id, req.session.userId);
    if (!list) return res.status(404).json({ error: 'Not found.', code: 404 });

    const showTrash = req.query.deleted === '1' || req.query.deleted === 'true';
    const trashWhere = showTrash ? personalTrashExpr('t') : personalActiveExpr('t');

    const items = db.get().prepare(`
      SELECT ${personalTaskSelectExpr('t')},
             u.display_name AS assigned_name,
             u.avatar_color AS assigned_color
      FROM personal_tasks t
      LEFT JOIN users u ON u.id = t.assigned_to
      WHERE t.list_id = ? AND ${trashWhere}
      ORDER BY
        ${showTrash ? personalTrashOrderExpr('t') : ''}
        CASE ${personalStatusExpr('t')}
          WHEN 'open' THEN 0
          WHEN 'in_progress' THEN 1
          WHEN 'done' THEN 2
          ELSE 0
        END,
        CASE WHEN ${personalStatusExpr('t')} = 'done' THEN COALESCE(t.done_at, t.updated_at) END DESC,
        CASE t.priority WHEN 'urgent' THEN 0 ELSE 1 END,
        CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
        t.due_date ASC,
        CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1
                        WHEN 'low' THEN 2 ELSE 3 END,
        t.sort_order ASC, t.id ASC
    `).all(req.params.id);
    res.json({ data: attachLabelsToItems(req.params.id, items) });
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

    const vTitle = str(req.body.title, 'title', { max: MAX_TITLE });
    if (vTitle.error) return res.status(400).json({ error: vTitle.error, code: 400 });

    const description     = req.body.description     ?? null;
    const due_date        = req.body.due_date        ?? null;
    const due_time        = req.body.due_time        ?? null;
    const alarm_at        = req.body.alarm_at        ?? null;
    const priority        = req.body.priority        ?? 'none';
    const status          = req.body.status          ?? 'open';
    const is_recurring    = req.body.is_recurring    ? 1 : 0;
    const recurrence_rule = req.body.recurrence_rule ?? null;
    const assigned_to     = req.body.assigned_to     ?? null;
    const labelNames      = req.body.label_names ?? req.body.labels ?? [];

    const vPriority = oneOf(priority, VALID_PERSONAL_PRIORITIES, 'priority');
    const vStatus = oneOf(status, VALID_PERSONAL_STATUSES, 'status');
    if (vPriority.error) return res.status(400).json({ error: vPriority.error, code: 400 });
    if (vStatus.error) return res.status(400).json({ error: vStatus.error, code: 400 });

    const id = db.transaction(() => {
      const maxOrder = db.get()
        .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM personal_tasks WHERE list_id = ?')
        .get(req.params.id).m;
      const done = vStatus.value === 'done' ? 1 : 0;
      const doneAtSql = done ? NOW_SQL : 'NULL';
      const result = PERSONAL_TASK_HAS_STATUS
        ? db.get().prepare(`
            INSERT INTO personal_tasks (${PERSONAL_TASK_HAS_DELETED_AT
              ? 'list_id, title, description, priority, status, done_at, due_date, due_time, alarm_at, is_recurring, recurrence_rule, assigned_to, sort_order, done, deleted_at'
              : 'list_id, title, description, priority, status, done_at, due_date, due_time, alarm_at, is_recurring, recurrence_rule, assigned_to, sort_order, done'})
            VALUES (?, ?, ?, ?, ?, ${doneAtSql}, ?, ?, ?, ?, ?, ?, ?, ?${PERSONAL_TASK_HAS_DELETED_AT ? ', NULL' : ''})
          `).run(req.params.id, vTitle.value, description, vPriority.value, vStatus.value, due_date, due_time, alarm_at, is_recurring, recurrence_rule, assigned_to, maxOrder + 1, done)
        : db.get().prepare(`
            INSERT INTO personal_tasks (${PERSONAL_TASK_HAS_DELETED_AT
              ? 'list_id, title, description, priority, done_at, due_date, due_time, alarm_at, is_recurring, recurrence_rule, assigned_to, sort_order, done, deleted_at'
              : 'list_id, title, description, priority, done_at, due_date, due_time, alarm_at, is_recurring, recurrence_rule, assigned_to, sort_order, done'})
            VALUES (?, ?, ?, ?, ${doneAtSql}, ?, ?, ?, ?, ?, ?, ?, ?${PERSONAL_TASK_HAS_DELETED_AT ? ', NULL' : ''})
          `).run(req.params.id, vTitle.value, description, vPriority.value, due_date, due_time, alarm_at, is_recurring, recurrence_rule, assigned_to, maxOrder + 1, done);
      syncPersonalItemLabels(req.params.id, result.lastInsertRowid, labelNames);
      return result.lastInsertRowid;
    });

    res.status(201).json({
      data: loadPersonalItemWithLabels(req.params.id, id),
    });
  } catch (err) {
    log.error('POST /:id/items', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

// --------------------------------------------------------
// PATCH /api/v1/personal-lists/:id/items/:itemId
// Body: { title?, status?, done? }
// Accessible to owner OR shared users.
// --------------------------------------------------------
router.patch('/:id/items/:itemId', (req, res) => {
  try {
    const list = accessibleList(req.params.id, req.session.userId);
    if (!list) return res.status(404).json({ error: 'Not found.', code: 404 });

    const item = db.get()
      .prepare(`SELECT ${personalTaskSelectExpr('pt')} FROM personal_tasks pt WHERE pt.id = ? AND pt.list_id = ? AND ${personalActiveExpr('pt')}`)
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

    if (req.body.description !== undefined) {
      updates.push('description = ?');
      params.push(req.body.description || null);
    }

    if (req.body.due_time !== undefined) {
      updates.push('due_time = ?');
      params.push(req.body.due_time || null);
    }

    if (req.body.alarm_at !== undefined) {
      updates.push('alarm_at = ?');
      updates.push('alarm_sent = 0');
      params.push(req.body.alarm_at || null);
    }

    if (req.body.is_recurring !== undefined) {
      updates.push('is_recurring = ?');
      params.push(req.body.is_recurring ? 1 : 0);
    }

    if (req.body.recurrence_rule !== undefined) {
      updates.push('recurrence_rule = ?');
      params.push(req.body.recurrence_rule || null);
    }

    if (req.body.assigned_to !== undefined) {
      updates.push('assigned_to = ?');
      params.push(req.body.assigned_to || null);
    }

    const hasLabelUpdate = req.body.label_names !== undefined || req.body.labels !== undefined;

    const requestedStatus = req.body.status !== undefined
      ? req.body.status
      : (req.body.done !== undefined ? (req.body.done ? 'done' : 'open') : undefined);
    let finalStatus = requestedStatus;
    if (requestedStatus !== undefined) {
      const v = oneOf(requestedStatus, VALID_PERSONAL_STATUSES, 'status');
      if (v.error) return res.status(400).json({ error: v.error, code: 400 });
      if (PERSONAL_TASK_HAS_STATUS) {
        updates.push('status = ?');
        params.push(v.value);
      }
      updates.push('done = ?');
      params.push(v.value === 'done' ? 1 : 0);
      finalStatus = v.value;
    }

    if (updates.length) {
      // When marking done and item is recurring, reschedule instead
      const markingDone = requestedStatus === 'done';
      if (markingDone && (item.is_recurring || req.body.is_recurring) && (item.recurrence_rule || req.body.recurrence_rule)) {
        const rule   = req.body.recurrence_rule || item.recurrence_rule;
        const base   = item.due_date || new Date().toISOString().slice(0, 10);
        const nextDue = nextOccurrence(base, rule);
        // Reset to pending with next due date instead of marking done
        if (nextDue) {
          const dueDateIdx = updates.indexOf('due_date = ?');
          if (dueDateIdx !== -1) params[dueDateIdx] = nextDue;
          else { updates.push('due_date = ?'); params.push(nextDue); }
        }
        const statusIdx = updates.indexOf('status = ?');
        if (statusIdx !== -1) params[statusIdx] = 'open';
        const doneIdx = updates.indexOf('done = ?');
        if (doneIdx !== -1) params[doneIdx] = 0;
        finalStatus = 'open';
      }

      if (requestedStatus !== undefined) {
        updates.push(`done_at = ${finalStatus === 'done' ? NOW_SQL : 'NULL'}`);
      }

      params.push(req.params.itemId);
      db.get().prepare(`UPDATE personal_tasks SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }

    if (hasLabelUpdate) {
      syncPersonalItemLabels(req.params.id, req.params.itemId, req.body.label_names ?? req.body.labels);
    }

    res.json({
      data: loadPersonalItemWithLabels(req.params.id, req.params.itemId),
    });
  } catch (err) {
    log.error('PATCH /:id/items/:itemId', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/personal-lists/:id/items/:itemId
// Soft-deletes an item by moving it to trash.
// Accessible to owner OR shared users.
// --------------------------------------------------------
router.delete('/:id/items/:itemId', (req, res) => {
  try {
    const list = accessibleList(req.params.id, req.session.userId);
    if (!list) return res.status(404).json({ error: 'Not found.', code: 404 });

    const result = db.get()
      .prepare(`
        UPDATE personal_tasks
        SET ${PERSONAL_TASK_HAS_DELETED_AT
          ? "deleted_at = COALESCE(deleted_at, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))"
          : 'done = done'}
        WHERE id = ? AND list_id = ?
      `)
      .run(req.params.itemId, req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Item not found.', code: 404 });
    res.json({ ok: true, data: loadPersonalItemWithLabels(req.params.id, req.params.itemId) });
  } catch (err) {
    log.error('DELETE /:id/items/:itemId', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/personal-lists/:id/items/:itemId/restore
// Restores a trashed item back into the active list.
// Accessible to owner OR shared users.
// --------------------------------------------------------
router.post('/:id/items/:itemId/restore', (req, res) => {
  try {
    const list = accessibleList(req.params.id, req.session.userId);
    if (!list) return res.status(404).json({ error: 'Not found.', code: 404 });
    if (!PERSONAL_TASK_HAS_DELETED_AT) {
      return res.status(404).json({ error: 'Item not found.', code: 404 });
    }

    const result = db.get()
      .prepare(`
        UPDATE personal_tasks
        SET deleted_at = NULL
        WHERE id = ? AND list_id = ? AND ${personalTrashExpr('personal_tasks')}
      `)
      .run(req.params.itemId, req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Item not found.', code: 404 });
    res.json({ ok: true, data: loadPersonalItemWithLabels(req.params.id, req.params.itemId) });
  } catch (err) {
    log.error('POST /:id/items/:itemId/restore', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/personal-lists/:id/clear-done
// Bulk-moves all done items from a list to trash.
// Accessible to owner OR shared users.
// --------------------------------------------------------
router.post('/:id/clear-done', (req, res) => {
  try {
    const list = accessibleList(req.params.id, req.session.userId);
    if (!list) return res.status(404).json({ error: 'Not found.', code: 404 });

    const result = db.get()
      .prepare(`
        UPDATE personal_tasks
        SET ${PERSONAL_TASK_HAS_DELETED_AT
          ? "deleted_at = COALESCE(deleted_at, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))"
          : 'done = done'}
        WHERE list_id = ? AND ${personalActiveExpr('personal_tasks')} AND ${PERSONAL_TASK_HAS_STATUS ? '(status = ? OR (status IS NULL AND done = 1))' : 'done = 1'}
      `)
      .run(...(PERSONAL_TASK_HAS_STATUS ? [req.params.id, 'done'] : [req.params.id]));
    res.json({ ok: true, deleted: result.changes });
  } catch (err) {
    log.error('POST /:id/clear-done', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/personal-lists/:id/clear-trash
// Permanently removes all trashed items from a list.
// Accessible to owner OR shared users.
// --------------------------------------------------------
router.post('/:id/clear-trash', (req, res) => {
  try {
    const list = accessibleList(req.params.id, req.session.userId);
    if (!list) return res.status(404).json({ error: 'Not found.', code: 404 });

    const result = db.get()
      .prepare(`DELETE FROM personal_tasks WHERE list_id = ? AND ${personalTrashExpr('personal_tasks')}`)
      .run(req.params.id);
    res.json({ ok: true, deleted: result.changes });
  } catch (err) {
    log.error('POST /:id/clear-trash', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/personal-lists/:id/labels
// Returns all labels for a list, including task usage counts.
// Accessible to owner OR shared users.
// --------------------------------------------------------
router.get('/:id/labels', (req, res) => {
  try {
    const list = accessibleList(req.params.id, req.session.userId);
    if (!list) return res.status(404).json({ error: 'Not found.', code: 404 });
    res.json({ data: loadPersonalLabels(req.params.id) });
  } catch (err) {
    log.error('GET /:id/labels', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/personal-lists/:id/labels
// Body: { name, color }
// Accessible to owner OR shared users.
// --------------------------------------------------------
router.post('/:id/labels', (req, res) => {
  try {
    const list = accessibleList(req.params.id, req.session.userId);
    if (!list) return res.status(404).json({ error: 'Not found.', code: 404 });

    const vName = str(req.body.name, 'name', { max: 60 });
    const vColor = color(req.body.color, 'color');
    const errs = collectErrors([vName, vColor]);
    if (errs.length) return res.status(400).json({ error: errs.join(' '), code: 400 });

    try {
      const result = db.get().prepare(`
        INSERT INTO personal_labels (list_id, name, color)
        VALUES (?, ?, ?)
      `).run(req.params.id, vName.value, vColor.value);
      res.status(201).json({
        data: loadPersonalLabel(req.params.id, result.lastInsertRowid),
      });
    } catch (err) {
      if (String(err?.message || '').includes('UNIQUE')) {
        return res.status(409).json({ error: 'Label name already exists.', code: 409 });
      }
      throw err;
    }
  } catch (err) {
    log.error('POST /:id/labels', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

// --------------------------------------------------------
// PATCH /api/v1/personal-lists/:id/labels/:labelId
// Body: { name?, color? }
// Accessible to owner OR shared users.
// --------------------------------------------------------
router.patch('/:id/labels/:labelId', (req, res) => {
  try {
    const list = accessibleList(req.params.id, req.session.userId);
    if (!list) return res.status(404).json({ error: 'Not found.', code: 404 });

    const label = db.get().prepare(`
      SELECT * FROM personal_labels WHERE id = ? AND list_id = ?
    `).get(req.params.labelId, req.params.id);
    if (!label) return res.status(404).json({ error: 'Label not found.', code: 404 });

    const checks = [];
    if (req.body.name !== undefined) checks.push(str(req.body.name, 'name', { max: 60 }));
    if (req.body.color !== undefined) checks.push(color(req.body.color, 'color'));
    const errs = collectErrors(checks);
    if (errs.length) return res.status(400).json({ error: errs.join(' '), code: 400 });

    const newName = req.body.name !== undefined ? req.body.name.trim() : label.name;
    const newColor = req.body.color !== undefined ? req.body.color : label.color;

    try {
      db.get().prepare('UPDATE personal_labels SET name = ?, color = ? WHERE id = ? AND list_id = ?')
        .run(newName, newColor, req.params.labelId, req.params.id);
    } catch (err) {
      if (String(err?.message || '').includes('UNIQUE')) {
        return res.status(409).json({ error: 'Label name already exists.', code: 409 });
      }
      throw err;
    }

    res.json({ data: loadPersonalLabel(req.params.id, req.params.labelId) });
  } catch (err) {
    log.error('PATCH /:id/labels/:labelId', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/personal-lists/:id/labels/:labelId
// Removes the label and all item assignments.
// Accessible to owner OR shared users.
// --------------------------------------------------------
router.delete('/:id/labels/:labelId', (req, res) => {
  try {
    const list = accessibleList(req.params.id, req.session.userId);
    if (!list) return res.status(404).json({ error: 'Not found.', code: 404 });

    const result = db.get().prepare(`
      DELETE FROM personal_labels WHERE id = ? AND list_id = ?
    `).run(req.params.labelId, req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Label not found.', code: 404 });
    res.json({ ok: true });
  } catch (err) {
    log.error('DELETE /:id/labels/:labelId', err);
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
    });

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

// --------------------------------------------------------
// GET /api/v1/personal-lists/users
// Returns all users for assigned_to dropdowns and share dialogs.
// --------------------------------------------------------
router.get('/users', (req, res) => {
  try {
    const users = db.get().prepare(
      'SELECT id, display_name, avatar_color FROM users ORDER BY display_name'
    ).all();
    res.json({ users });
  } catch (err) {
    log.error('GET /users', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/personal-lists/due-notifications
// Returns personal tasks due today and tomorrow for the current user.
// --------------------------------------------------------
router.get('/due-notifications', (req, res) => {
  try {
    const uid = req.session.userId;
    const now      = new Date();
    const today    = now.toISOString().slice(0, 10);
    const tomorrow = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);

    const query = `
      SELECT ${personalTaskSelectExpr('pt')},
             u.display_name AS assigned_name, u.avatar_color AS assigned_color
      FROM personal_tasks pt
      JOIN task_lists l ON l.id = pt.list_id
      LEFT JOIN users u ON u.id = pt.assigned_to
      WHERE pt.due_date = ? AND ${personalActiveExpr('pt')} AND ${personalStatusExpr('pt')} != 'done'
        AND (l.owner_id = ?
             OR EXISTS (SELECT 1 FROM task_list_shares s
                        WHERE s.list_id = l.id AND s.user_id = ?))
      ORDER BY CASE pt.priority WHEN 'urgent' THEN 0 ELSE 1 END, pt.due_time ASC, pt.id ASC
    `;

    res.json({
      today:    db.get().prepare(query).all(today,    uid, uid),
      tomorrow: db.get().prepare(query).all(tomorrow, uid, uid),
    });
  } catch (err) {
    log.error('GET /due-notifications', err);
    res.status(500).json({ error: 'Server error.', code: 500 });
  }
});

export default router;
