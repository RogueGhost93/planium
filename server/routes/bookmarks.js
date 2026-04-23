/**
 * Modul: Bookmarks & Save Link
 * Zweck: Save links to Linkding or as tasks in Planium
 * Abhängigkeiten: express, server/db.js
 */

import express from 'express';
import * as db from '../db.js';
import { createLogger } from '../logger.js';

const log    = createLogger('Bookmarks');
const router = express.Router();

// --------------------------------------------------------
// Hilfsfunktionen
// --------------------------------------------------------

function getLinkdingConfig() {
  const stmt = db.get().prepare('SELECT key, value FROM app_settings WHERE key IN (?, ?)');
  const rows = stmt.all('linkding_url', 'linkding_api_token');
  const map  = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { url: map.linkding_url || null, token: map.linkding_api_token || null };
}

function isValidUrl(urlString) {
  try {
    new URL(urlString);
    return true;
  } catch {
    return false;
  }
}

async function saveToLinkding(url, title, markAsRead) {
  const { url: baseUrl, token } = getLinkdingConfig();
  if (!baseUrl || !token) {
    throw new Error('Linkding is not configured');
  }

  const linkdingUrl = `${baseUrl}/api/bookmarks/`;
  const body = {
    url,
    title: title || url,
    unread: !markAsRead,
    tag_names: ['planium'],
  };

  const res = await fetch(linkdingUrl, {
    method: 'POST',
    headers: {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const err = new Error(`Linkding API error: ${res.status}`);
    err.status = res.status;
    throw err;
  }

  return res.json();
}

// --------------------------------------------------------
// GET /api/v1/task-lists
// Returns all personal task lists accessible by the user.
// Response: [{ id: number, name: string }]
// --------------------------------------------------------
router.get('/task-lists', (req, res) => {
  try {
    const uid = req.session.userId;
    const lists = db.get().prepare(`
      SELECT l.id, l.name
      FROM task_lists l
      WHERE l.owner_id = ?
         OR EXISTS (SELECT 1 FROM task_list_shares s
                    WHERE s.list_id = l.id AND s.user_id = ?)
      ORDER BY l.sort_order ASC, l.created_at ASC
    `).all(uid, uid);

    res.json({ data: lists });
  } catch (err) {
    log.error('GET /task-lists', err);
    res.status(500).json({ error: 'Server error', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/save-link
// Saves a link either to Linkding or as a task in Planium.
// Body: {
//   url: string (required),
//   title?: string,
//   target: 'linkding' | 'task' (required),
//   taskListId?: number (required if target === 'task'),
//   markAsRead?: boolean (default false)
// }
// Response: { ok: true } | error
// --------------------------------------------------------
router.post('/save-link', async (req, res) => {
  try {
    const { url, title, target, taskListId, markAsRead = false } = req.body;

    // Validate URL
    if (!url || typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({ error: 'url is required', code: 400 });
    }
    if (!isValidUrl(url.trim())) {
      return res.status(400).json({ error: 'Invalid URL format', code: 400 });
    }

    // Validate target
    if (!target || !['linkding', 'task'].includes(target)) {
      return res.status(400).json({ error: 'target must be "linkding" or "task"', code: 400 });
    }

    // Validate title if provided
    if (title !== undefined && title !== null) {
      if (typeof title !== 'string') {
        return res.status(400).json({ error: 'title must be a string', code: 400 });
      }
      if (title.length > 500) {
        return res.status(400).json({ error: 'title exceeds max length', code: 400 });
      }
    }

    if (target === 'linkding') {
      // Save to Linkding
      try {
        await saveToLinkding(url.trim(), title, markAsRead);
        return res.json({ ok: true });
      } catch (err) {
        log.error('saveToLinkding', err);
        if (err.status === 401) {
          return res.status(401).json({ error: 'Invalid Linkding token', code: 401 });
        }
        return res.status(502).json({ error: 'Could not reach Linkding', code: 502 });
      }
    } else if (target === 'task') {
      // Save as task
      if (!taskListId || typeof taskListId !== 'number') {
        return res.status(400).json({ error: 'taskListId is required when target is "task"', code: 400 });
      }

      // Verify user has access to the task list
      const list = db.get().prepare(`
        SELECT l.id FROM task_lists l
        WHERE l.id = ?
          AND (l.owner_id = ?
               OR EXISTS (SELECT 1 FROM task_list_shares s
                          WHERE s.list_id = l.id AND s.user_id = ?))
      `).get(taskListId, req.session.userId, req.session.userId);

      if (!list) {
        return res.status(403).json({ error: 'Access denied to task list', code: 403 });
      }

      try {
        const taskTitle = title ? `${title} (${url.trim()})` : url.trim();

        const { lastInsertRowid } = db.get().prepare(`
          INSERT INTO personal_tasks (list_id, title, done)
          VALUES (?, ?, 0)
        `).run(taskListId, taskTitle);

        res.status(201).json({ ok: true, taskId: lastInsertRowid });
      } catch (err) {
        log.error('Create task', err);
        res.status(500).json({ error: 'Could not create task', code: 500 });
      }
    }
  } catch (err) {
    log.error('POST /save-link', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

export default router;
