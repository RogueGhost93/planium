/**
 * Modul: Datenbank (Database)
 * Zweck: SQLite/SQLCipher Verbindung, Schema-Migration (versioniert) und Query-Helfer
 * Abhängigkeiten: better-sqlite3
 *
 * SQLCipher-Hinweis:
 *   Verschlüsselung funktioniert nur wenn better-sqlite3 gegen SQLCipher kompiliert wurde.
 *   Im Docker-Container (Dockerfile: libsqlcipher-dev + npm rebuild) ist das gewährleistet.
 *   Ohne DB_ENCRYPTION_KEY gesetzt läuft die App mit unverschlüsseltem SQLite (für Entwicklung).
 */

import Database from 'better-sqlite3';
import path from 'path';
import { createLogger } from './logger.js';

const log = createLogger('DB');

const DB_PATH = process.env.DB_PATH || path.join(import.meta.dirname, '..', 'planium.db');
const DB_KEY = process.env.DB_ENCRYPTION_KEY;

let db;

// --------------------------------------------------------
// Initialisierung
// --------------------------------------------------------

/**
 * Datenbankverbindung öffnen, SQLCipher-Key setzen, Migrations ausführen.
 * Einmalig beim Serverstart aufrufen.
 * @returns {import('better-sqlite3').Database}
 */
function init() {
  if (db) return db;
  db = new Database(DB_PATH);

  if (DB_KEY) {
    // Nur wirksam wenn Binary gegen SQLCipher kompiliert ist (Docker)
    db.pragma(`key="x'${Buffer.from(DB_KEY, 'utf8').toString('hex')}'"`);

    // Sicherstellen dass die Datenbank tatsächlich entschlüsselbar ist
    try {
      db.prepare('SELECT count(*) FROM sqlite_master').get();
    } catch {
      throw new Error('[DB] Falscher Verschlüsselungsschlüssel oder keine SQLCipher-Unterstützung.');
    }
  }

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = MEMORY');

  migrate();

  log.info(`Verbunden: ${DB_PATH} | Schema v${currentVersion()}`);
  return db;
}

// --------------------------------------------------------
// Migrations-Engine
// --------------------------------------------------------

/**
 * Alle Migrationen in aufsteigender Reihenfolge.
 * Neue Migrations am Ende anhängen - niemals bestehende ändern.
 */
const MIGRATIONS = [
  {
    version: 1,
    description: 'Initiales Schema',
    up: `
      -- Benutzer
      CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT    UNIQUE NOT NULL,
        display_name  TEXT    NOT NULL,
        password_hash TEXT    NOT NULL,
        avatar_color  TEXT    NOT NULL DEFAULT '#007AFF',
        role          TEXT    NOT NULL DEFAULT 'member'
                              CHECK(role IN ('admin', 'member')),
        created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      -- Aufgaben
      CREATE TABLE IF NOT EXISTS tasks (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        title           TEXT    NOT NULL,
        description     TEXT,
        category        TEXT    NOT NULL DEFAULT 'Sonstiges',
        priority        TEXT    NOT NULL DEFAULT 'none'
                                CHECK(priority IN ('none', 'urgent')),
        status          TEXT    NOT NULL DEFAULT 'open'
                                CHECK(status IN ('open', 'done')),
        due_date        TEXT,
        due_time        TEXT,
        assigned_to     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_by      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        is_recurring    INTEGER NOT NULL DEFAULT 0,
        recurrence_rule TEXT,
        parent_task_id  INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      -- Einkaufslisten
      CREATE TABLE IF NOT EXISTS shopping_lists (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL,
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      -- Essensplan (muss vor shopping_items stehen wegen FK-Referenz)
      CREATE TABLE IF NOT EXISTS meals (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        date       TEXT    NOT NULL,
        meal_type  TEXT    NOT NULL
                           CHECK(meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
        title      TEXT    NOT NULL,
        notes      TEXT,
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      -- Einkaufsartikel (nach meals, wegen added_from_meal FK)
      CREATE TABLE IF NOT EXISTS shopping_items (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        list_id         INTEGER NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
        name            TEXT    NOT NULL,
        quantity        TEXT,
        category        TEXT    NOT NULL DEFAULT 'Sonstiges',
        is_checked      INTEGER NOT NULL DEFAULT 0,
        added_from_meal INTEGER REFERENCES meals(id) ON DELETE SET NULL,
        created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      -- Mahlzeit-Zutaten
      CREATE TABLE IF NOT EXISTS meal_ingredients (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        meal_id          INTEGER NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
        name             TEXT    NOT NULL,
        quantity         TEXT,
        on_shopping_list INTEGER NOT NULL DEFAULT 0,
        created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      -- Kalender-Events
      CREATE TABLE IF NOT EXISTS calendar_events (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        title                TEXT    NOT NULL,
        description          TEXT,
        start_datetime       TEXT    NOT NULL,
        end_datetime         TEXT,
        all_day              INTEGER NOT NULL DEFAULT 0,
        location             TEXT,
        color                TEXT    NOT NULL DEFAULT '#007AFF',
        assigned_to          INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_by           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        external_calendar_id TEXT,
        external_source      TEXT    NOT NULL DEFAULT 'local'
                                     CHECK(external_source IN ('local', 'google', 'apple')),
        recurrence_rule      TEXT,
        created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      -- Pinnwand / Notizen
      CREATE TABLE IF NOT EXISTS notes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        title      TEXT,
        content    TEXT    NOT NULL,
        color      TEXT    NOT NULL DEFAULT '#FFEB3B',
        pinned     INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      -- Kontakte
      CREATE TABLE IF NOT EXISTS contacts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL,
        category   TEXT    NOT NULL DEFAULT 'Sonstiges',
        phone      TEXT,
        email      TEXT,
        address    TEXT,
        notes      TEXT,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      -- Budget
      CREATE TABLE IF NOT EXISTS budget_entries (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        title           TEXT    NOT NULL,
        amount          REAL    NOT NULL,
        category        TEXT    NOT NULL DEFAULT 'Sonstiges',
        date            TEXT    NOT NULL,
        is_recurring    INTEGER NOT NULL DEFAULT 0,
        recurrence_rule TEXT,
        created_by      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      -- --------------------------------------------------------
      -- updated_at Trigger (automatisch bei UPDATE setzen)
      -- --------------------------------------------------------
      CREATE TRIGGER IF NOT EXISTS trg_users_updated_at
        AFTER UPDATE ON users FOR EACH ROW
        BEGIN UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER IF NOT EXISTS trg_tasks_updated_at
        AFTER UPDATE ON tasks FOR EACH ROW
        BEGIN UPDATE tasks SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER IF NOT EXISTS trg_shopping_lists_updated_at
        AFTER UPDATE ON shopping_lists FOR EACH ROW
        BEGIN UPDATE shopping_lists SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER IF NOT EXISTS trg_shopping_items_updated_at
        AFTER UPDATE ON shopping_items FOR EACH ROW
        BEGIN UPDATE shopping_items SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER IF NOT EXISTS trg_meals_updated_at
        AFTER UPDATE ON meals FOR EACH ROW
        BEGIN UPDATE meals SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER IF NOT EXISTS trg_meal_ingredients_updated_at
        AFTER UPDATE ON meal_ingredients FOR EACH ROW
        BEGIN UPDATE meal_ingredients SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER IF NOT EXISTS trg_calendar_events_updated_at
        AFTER UPDATE ON calendar_events FOR EACH ROW
        BEGIN UPDATE calendar_events SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER IF NOT EXISTS trg_notes_updated_at
        AFTER UPDATE ON notes FOR EACH ROW
        BEGIN UPDATE notes SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER IF NOT EXISTS trg_contacts_updated_at
        AFTER UPDATE ON contacts FOR EACH ROW
        BEGIN UPDATE contacts SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER IF NOT EXISTS trg_budget_entries_updated_at
        AFTER UPDATE ON budget_entries FOR EACH ROW
        BEGIN UPDATE budget_entries SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      -- --------------------------------------------------------
      -- Indizes
      -- --------------------------------------------------------
      CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to    ON tasks(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_tasks_due_date       ON tasks(due_date);
      CREATE INDEX IF NOT EXISTS idx_tasks_status         ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_parent         ON tasks(parent_task_id);
      CREATE INDEX IF NOT EXISTS idx_shopping_items_list  ON shopping_items(list_id);
      CREATE INDEX IF NOT EXISTS idx_meals_date           ON meals(date);
      CREATE INDEX IF NOT EXISTS idx_calendar_start       ON calendar_events(start_datetime);
      CREATE INDEX IF NOT EXISTS idx_calendar_assigned    ON calendar_events(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_notes_pinned         ON notes(pinned);
      CREATE INDEX IF NOT EXISTS idx_budget_date          ON budget_entries(date);
      CREATE INDEX IF NOT EXISTS idx_budget_created_by    ON budget_entries(created_by);
    `,
  },
  {
    version: 2,
    description: 'Sync-Konfigurationstabelle für Google/Apple Calendar',
    up: `
      CREATE TABLE IF NOT EXISTS sync_config (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_calendar_external_id ON calendar_events(external_calendar_id);
    `,
  },
  {
    version: 3,
    description: 'Wiederkehrende Budget-Einträge: parent-Referenz und Skip-Tabelle',
    up: `
      ALTER TABLE budget_entries ADD COLUMN recurrence_parent_id INTEGER
        REFERENCES budget_entries(id) ON DELETE SET NULL;

      CREATE TABLE IF NOT EXISTS budget_recurrence_skipped (
        parent_id INTEGER NOT NULL REFERENCES budget_entries(id) ON DELETE CASCADE,
        month     TEXT    NOT NULL,
        PRIMARY KEY (parent_id, month)
      );

      CREATE INDEX IF NOT EXISTS idx_budget_parent ON budget_entries(recurrence_parent_id);
    `,
  },
  {
    version: 4,
    description: 'Add external_uid to calendar_events for ICS import deduplication',
    up: `
      ALTER TABLE calendar_events ADD COLUMN external_uid TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_external_uid ON calendar_events(external_uid)
        WHERE external_uid IS NOT NULL;
    `,
  },
  {
    version: 5,
    description: 'Add none priority to tasks and recipe_url to meals',
    up: `
      PRAGMA foreign_keys=OFF;
      CREATE TABLE tasks_new (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        title           TEXT    NOT NULL,
        description     TEXT,
        category        TEXT    NOT NULL DEFAULT 'Sonstiges',
        priority        TEXT    NOT NULL DEFAULT 'medium'
                                CHECK(priority IN ('none', 'low', 'medium', 'high', 'urgent')),
        status          TEXT    NOT NULL DEFAULT 'open'
                                CHECK(status IN ('open', 'in_progress', 'done')),
        due_date        TEXT,
        due_time        TEXT,
        assigned_to     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_by      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        is_recurring    INTEGER NOT NULL DEFAULT 0,
        recurrence_rule TEXT,
        parent_task_id  INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );
      INSERT INTO tasks_new SELECT * FROM tasks;
      DROP TABLE tasks;
      ALTER TABLE tasks_new RENAME TO tasks;
      ALTER TABLE meals ADD COLUMN recipe_url TEXT;
      PRAGMA foreign_keys=ON;
    `,
  },
  {
    version: 6,
    description: 'Add sort_order to shopping_lists',
    up: `
      ALTER TABLE shopping_lists ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
      UPDATE shopping_lists SET sort_order = (
        SELECT COUNT(*) FROM shopping_lists sl2 WHERE sl2.id <= shopping_lists.id
      ) - 1;
    `,
  },
  {
    version: 7,
    description: 'Add theme and accent preferences to users',
    up: `
      ALTER TABLE users ADD COLUMN theme  TEXT NOT NULL DEFAULT 'system';
      ALTER TABLE users ADD COLUMN accent TEXT NOT NULL DEFAULT 'blue';
    `,
  },
  {
    version: 8,
    description: 'Add quick_link URL preference to users',
    up: `
      ALTER TABLE users ADD COLUMN quick_link TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    version: 9,
    description: 'Add notification preferences to users',
    up: `
      ALTER TABLE users ADD COLUMN notify_popup   INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE users ADD COLUMN notify_sound   INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE users ADD COLUMN notify_time    TEXT    NOT NULL DEFAULT '09:00';
      ALTER TABLE users ADD COLUMN notify_interval INTEGER NOT NULL DEFAULT 4;
    `,
  },
  {
    version: 10,
    description: 'Collapse task priorities to none/urgent only',
    up: `
      CREATE TABLE tasks_new (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        title           TEXT    NOT NULL,
        description     TEXT,
        category        TEXT    NOT NULL DEFAULT 'Sonstiges',
        priority        TEXT    NOT NULL DEFAULT 'none'
                                CHECK(priority IN ('none', 'urgent')),
        status          TEXT    NOT NULL DEFAULT 'open'
                                CHECK(status IN ('open', 'in_progress', 'done')),
        due_date        TEXT,
        due_time        TEXT,
        assigned_to     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_by      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        is_recurring    INTEGER NOT NULL DEFAULT 0,
        recurrence_rule TEXT,
        parent_task_id  INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      INSERT INTO tasks_new (
        id, title, description, category, priority, status, due_date, due_time,
        assigned_to, created_by, is_recurring, recurrence_rule, parent_task_id,
        created_at, updated_at
      )
      SELECT
        id, title, description, category,
        CASE WHEN priority = 'urgent' THEN 'urgent' ELSE 'none' END,
        status, due_date, due_time,
        assigned_to, created_by, is_recurring, recurrence_rule, parent_task_id,
        created_at, updated_at
      FROM tasks;

      DROP TABLE tasks;
      ALTER TABLE tasks_new RENAME TO tasks;

      CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_tasks_due_date    ON tasks(due_date);
      CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_parent      ON tasks(parent_task_id);

      CREATE TRIGGER IF NOT EXISTS trg_tasks_updated_at
        AFTER UPDATE ON tasks FOR EACH ROW
        BEGIN UPDATE tasks SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;
    `,
  },
  {
    version: 11,
    description: 'Rename shopping_lists/items to lists/list_items with type column',
    up: `
      PRAGMA foreign_keys=OFF;

      CREATE TABLE lists (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL,
        type       TEXT    NOT NULL DEFAULT 'shopping'
                           CHECK(type IN ('shopping', 'packing')),
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );
      INSERT INTO lists (id, name, type, sort_order, created_by, created_at, updated_at)
        SELECT id, name, 'shopping', sort_order, created_by, created_at, updated_at FROM shopping_lists;

      CREATE TABLE list_items (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        list_id         INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
        name            TEXT    NOT NULL,
        quantity        TEXT,
        category        TEXT    NOT NULL DEFAULT 'Sonstiges',
        is_checked      INTEGER NOT NULL DEFAULT 0,
        added_from_meal INTEGER REFERENCES meals(id) ON DELETE SET NULL,
        created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );
      INSERT INTO list_items SELECT * FROM shopping_items;

      DROP TRIGGER IF EXISTS trg_shopping_lists_updated_at;
      DROP TRIGGER IF EXISTS trg_shopping_items_updated_at;
      DROP TABLE shopping_items;
      DROP TABLE shopping_lists;

      CREATE INDEX IF NOT EXISTS idx_list_items_list ON list_items(list_id);
      CREATE INDEX IF NOT EXISTS idx_lists_type ON lists(type);

      CREATE TRIGGER IF NOT EXISTS trg_lists_updated_at
        AFTER UPDATE ON lists FOR EACH ROW
        BEGIN UPDATE lists SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER IF NOT EXISTS trg_list_items_updated_at
        AFTER UPDATE ON list_items FOR EACH ROW
        BEGIN UPDATE list_items SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      PRAGMA foreign_keys=ON;
    `,
  },
  {
    version: 12,
    description: 'Add head_lists (tier 1) — existing lists become sublists of a seeded head',
    up: `
      PRAGMA foreign_keys=OFF;

      CREATE TABLE head_lists (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE TRIGGER trg_head_lists_updated_at
        AFTER UPDATE ON head_lists FOR EACH ROW
        BEGIN UPDATE head_lists SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      INSERT INTO head_lists (name, sort_order, created_by)
        SELECT 'Shopping', 0, COALESCE((SELECT created_by FROM lists ORDER BY id LIMIT 1),
                                       (SELECT id FROM users ORDER BY id LIMIT 1))
        WHERE EXISTS (SELECT 1 FROM lists)
           OR EXISTS (SELECT 1 FROM users);

      ALTER TABLE lists ADD COLUMN head_list_id INTEGER REFERENCES head_lists(id) ON DELETE CASCADE;
      UPDATE lists SET head_list_id = (SELECT id FROM head_lists ORDER BY id LIMIT 1);

      CREATE INDEX idx_lists_head ON lists(head_list_id);

      PRAGMA foreign_keys=ON;
    `,
  },
  {
    version: 13,
    description: 'Add app_settings table for global integration config (Mealie etc.)',
    up: `
      CREATE TABLE app_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    version: 14,
    description: 'Add notify_tone preference to users',
    up: `ALTER TABLE users ADD COLUMN notify_tone TEXT NOT NULL DEFAULT 'default';`,
  },
  {
    version: 15,
    description: 'Personal task lists (per-user solo todo lists)',
    up: `
      CREATE TABLE task_lists (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name       TEXT    NOT NULL,
        color      TEXT    NOT NULL DEFAULT '#2563EB',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE TABLE personal_tasks (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        list_id    INTEGER NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
        title      TEXT    NOT NULL,
        done       INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE INDEX idx_task_lists_owner       ON task_lists(owner_id);
      CREATE INDEX idx_personal_tasks_list    ON personal_tasks(list_id);

      CREATE TRIGGER trg_task_lists_updated_at
        AFTER UPDATE ON task_lists FOR EACH ROW
        BEGIN UPDATE task_lists SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER trg_personal_tasks_updated_at
        AFTER UPDATE ON personal_tasks FOR EACH ROW
        BEGIN UPDATE personal_tasks SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;
    `,
  },
  {
    version: 16,
    description: 'Sharing for personal task lists (owner can grant access to other users)',
    up: `
      CREATE TABLE task_list_shares (
        list_id    INTEGER NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        PRIMARY KEY (list_id, user_id)
      );

      CREATE INDEX idx_task_list_shares_user ON task_list_shares(user_id);
      CREATE INDEX idx_task_list_shares_list ON task_list_shares(list_id);
    `,
  },
  {
    version: 17,
    description: 'Optional priority + due_date for personal task items',
    up: `
      ALTER TABLE personal_tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'none';
      ALTER TABLE personal_tasks ADD COLUMN due_date TEXT;
    `,
  },
  {
    version: 18,
    description: 'Drop in_progress task status — collapse to open/done only',
    up: `
      PRAGMA foreign_keys=OFF;

      UPDATE tasks SET status = 'open' WHERE status = 'in_progress';

      CREATE TABLE tasks_new (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        title           TEXT    NOT NULL,
        description     TEXT,
        category        TEXT    NOT NULL DEFAULT 'Sonstiges',
        priority        TEXT    NOT NULL DEFAULT 'none'
                                CHECK(priority IN ('none', 'urgent')),
        status          TEXT    NOT NULL DEFAULT 'open'
                                CHECK(status IN ('open', 'done')),
        due_date        TEXT,
        due_time        TEXT,
        assigned_to     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_by      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        is_recurring    INTEGER NOT NULL DEFAULT 0,
        recurrence_rule TEXT,
        parent_task_id  INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      INSERT INTO tasks_new (
        id, title, description, category, priority, status, due_date, due_time,
        assigned_to, created_by, is_recurring, recurrence_rule, parent_task_id,
        created_at, updated_at
      )
      SELECT
        id, title, description, category, priority, status, due_date, due_time,
        assigned_to, created_by, is_recurring, recurrence_rule, parent_task_id,
        created_at, updated_at
      FROM tasks;

      DROP TABLE tasks;
      ALTER TABLE tasks_new RENAME TO tasks;

      CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_tasks_due_date    ON tasks(due_date);
      CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_parent      ON tasks(parent_task_id);

      CREATE TRIGGER IF NOT EXISTS trg_tasks_updated_at
        AFTER UPDATE ON tasks FOR EACH ROW
        BEGIN UPDATE tasks SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      PRAGMA foreign_keys=ON;
    `,
  },
  {
    version: 19,
    description: 'Add shared column to notes (1=visible to all, 0=private/creator-only)',
    up: `ALTER TABLE notes ADD COLUMN shared INTEGER NOT NULL DEFAULT 1;`,
  },
  {
    version: 20,
    description: 'Per-user key/value settings (private quick note etc.)',
    up: `
      CREATE TABLE user_settings (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key     TEXT    NOT NULL,
        value   TEXT    NOT NULL,
        PRIMARY KEY (user_id, key)
      );
    `,
  },
  {
    version: 21,
    description: 'Restore low/medium/high priorities on household tasks',
    up: `
      PRAGMA foreign_keys=OFF;

      CREATE TABLE tasks_new (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        title           TEXT    NOT NULL,
        description     TEXT,
        category        TEXT    NOT NULL DEFAULT 'Sonstiges',
        priority        TEXT    NOT NULL DEFAULT 'none'
                                CHECK(priority IN ('none', 'low', 'medium', 'high', 'urgent')),
        status          TEXT    NOT NULL DEFAULT 'open'
                                CHECK(status IN ('open', 'done')),
        due_date        TEXT,
        due_time        TEXT,
        assigned_to     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_by      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        is_recurring    INTEGER NOT NULL DEFAULT 0,
        recurrence_rule TEXT,
        parent_task_id  INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      INSERT INTO tasks_new (
        id, title, description, category, priority, status, due_date, due_time,
        assigned_to, created_by, is_recurring, recurrence_rule, parent_task_id,
        created_at, updated_at
      )
      SELECT
        id, title, description, category, priority, status, due_date, due_time,
        assigned_to, created_by, is_recurring, recurrence_rule, parent_task_id,
        created_at, updated_at
      FROM tasks;

      DROP TABLE tasks;
      ALTER TABLE tasks_new RENAME TO tasks;

      CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_tasks_due_date    ON tasks(due_date);
      CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_parent      ON tasks(parent_task_id);

      CREATE TRIGGER IF NOT EXISTS trg_tasks_updated_at
        AFTER UPDATE ON tasks FOR EACH ROW
        BEGIN UPDATE tasks SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      PRAGMA foreign_keys=ON;
    `,
  },
  {
    version: 22,
    description: 'Add is_private to head_lists, show_priority to task_lists',
    up: `
      ALTER TABLE head_lists ADD COLUMN is_private INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE task_lists ADD COLUMN show_priority INTEGER NOT NULL DEFAULT 1;
    `,
  },
  {
    version: 23,
    description: 'Add description, recurrence, assigned_to to personal_tasks',
    up: `
      ALTER TABLE personal_tasks ADD COLUMN description TEXT;
      ALTER TABLE personal_tasks ADD COLUMN is_recurring INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE personal_tasks ADD COLUMN recurrence_rule TEXT;
      ALTER TABLE personal_tasks ADD COLUMN assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL;
    `,
  },
  {
    version: 24,
    description: 'Add due_time to personal_tasks',
    up: `ALTER TABLE personal_tasks ADD COLUMN due_time TEXT;`,
  },
  {
    version: 25,
    description: 'Migrate tasks to personal_tasks as shared household list',
    up: `
      ALTER TABLE task_lists ADD COLUMN is_household INTEGER NOT NULL DEFAULT 0;

      INSERT INTO task_lists (name, owner_id, color, sort_order, is_household, show_priority)
        SELECT 'Household', MIN(id), '#2563EB', -1, 1, 1 FROM users HAVING MIN(id) IS NOT NULL;

      INSERT OR IGNORE INTO task_list_shares (list_id, user_id)
        SELECT (SELECT id FROM task_lists WHERE is_household = 1 LIMIT 1), id
        FROM users
        WHERE id != (SELECT owner_id FROM task_lists WHERE is_household = 1 LIMIT 1);

      INSERT INTO personal_tasks (list_id, title, description, priority, due_date, due_time, assigned_to, is_recurring, recurrence_rule, done, sort_order, created_at)
        SELECT hl.id, t.title, t.description, COALESCE(t.priority, 'none'),
               t.due_date, t.due_time, t.assigned_to,
               COALESCE(t.is_recurring, 0), t.recurrence_rule,
               CASE WHEN t.status = 'done' THEN 1 ELSE 0 END,
               t.rowid, t.created_at
        FROM tasks t
        JOIN (SELECT id FROM task_lists WHERE is_household = 1 LIMIT 1) hl
        WHERE t.parent_task_id IS NULL;
    `,
  },
  {
    version: 26,
    description: 'Add alarm fields to tasks',
    up: `
      ALTER TABLE tasks ADD COLUMN alarm_at TEXT;
      ALTER TABLE tasks ADD COLUMN alarm_sent INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 28,
    description: 'Add push_subscriptions table',
    up: `
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL,
        endpoint   TEXT    NOT NULL UNIQUE,
        p256dh     TEXT    NOT NULL,
        auth       TEXT    NOT NULL,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );
    `,
  },
  {
    version: 29,
    description: 'Add alarm fields to personal_tasks',
    up: `
      ALTER TABLE personal_tasks ADD COLUMN alarm_at TEXT;
      ALTER TABLE personal_tasks ADD COLUMN alarm_sent INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 30,
    description: 'Notebook: hierarchical notes, tags, FTS5',
    up: `
      CREATE TABLE notebook_notes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        title      TEXT    NOT NULL DEFAULT 'Untitled',
        content    TEXT    NOT NULL DEFAULT '',
        parent_id  INTEGER REFERENCES notebook_notes(id) ON DELETE CASCADE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );
      CREATE TABLE notebook_tags (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        name    TEXT    NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(name, user_id)
      );
      CREATE TABLE notebook_note_tags (
        note_id INTEGER NOT NULL REFERENCES notebook_notes(id) ON DELETE CASCADE,
        tag_id  INTEGER NOT NULL REFERENCES notebook_tags(id)  ON DELETE CASCADE,
        PRIMARY KEY (note_id, tag_id)
      );
      CREATE VIRTUAL TABLE notebook_notes_fts USING fts5(
        title, content,
        content='notebook_notes', content_rowid='id',
        tokenize='unicode61'
      );
      CREATE TRIGGER nb_ai AFTER INSERT ON notebook_notes BEGIN
        INSERT INTO notebook_notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
      END;
      CREATE TRIGGER nb_ad AFTER DELETE ON notebook_notes BEGIN
        INSERT INTO notebook_notes_fts(notebook_notes_fts, rowid, title, content)
          VALUES ('delete', old.id, old.title, old.content);
      END;
      CREATE TRIGGER nb_au AFTER UPDATE ON notebook_notes BEGIN
        INSERT INTO notebook_notes_fts(notebook_notes_fts, rowid, title, content)
          VALUES ('delete', old.id, old.title, old.content);
        INSERT INTO notebook_notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
      END;
      CREATE INDEX idx_nb_notes_parent ON notebook_notes(parent_id);
      CREATE INDEX idx_nb_notes_user   ON notebook_notes(created_by);
      CREATE INDEX idx_nb_tags_user    ON notebook_tags(user_id);
    `,
  },
];

/**
 * Führt alle ausstehenden Migrations in einer Transaktion aus.
 */
function migrate() {
  // Migrations-Versions-Tabelle sicherstellen (außerhalb der Haupt-Transaktion)
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      description TEXT    NOT NULL,
      applied_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version)
  );

  const pending = MIGRATIONS.filter((m) => !applied.has(m.version));

  if (pending.length === 0) return;

  const runMigration = db.transaction((migration) => {
    db.exec(migration.up);
    db.prepare('INSERT INTO schema_migrations (version, description) VALUES (?, ?)')
      .run(migration.version, migration.description);
    log.info(`Migration ${migration.version} angewendet: ${migration.description}`);
  });

  for (const migration of pending) {
    runMigration(migration);
  }
}

/**
 * Aktuelle Schema-Version zurückgeben.
 * @returns {number}
 */
function currentVersion() {
  if (!db) return 0;
  try {
    const row = db.prepare('SELECT MAX(version) as v FROM schema_migrations').get();
    return row?.v ?? 0;
  } catch {
    return 0;
  }
}

// --------------------------------------------------------
// Öffentliche API
// --------------------------------------------------------

/**
 * Datenbankinstanz zurückgeben.
 * @returns {import('better-sqlite3').Database}
 */
function get() {
  if (!db) throw new Error('[DB] Nicht initialisiert - init() zuerst aufrufen.');
  return db;
}

/**
 * Transaktion-Helfer: Funktion wird atomar ausgeführt.
 * Bei Fehler wird automatisch rollback ausgeführt.
 * @param {Function} fn
 * @returns {any}
 */
function transaction(fn) {
  return get().transaction(fn)();
}

init();   // auto-initialise when module is first imported

export { init, get, transaction, currentVersion };
