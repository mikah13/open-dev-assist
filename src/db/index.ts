import { createRequire } from 'module';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { config } from '../config.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Database = require('better-sqlite3') as any;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PrTicketLink {
  id: number;
  pr_url: string;
  pr_number: number;
  repo_full_name: string;
  pr_title: string;
  ticket_id: string;
  ticket_url: string;
  ticket_title: string;
  project_hint: string | null;  // AI-inferred project name
  created_at: string;
  updated_at: string;
}

export interface SyncRule {
  id: number;
  pr_event: string;         // 'opened' | 'approved' | 'merged' | 'closed' | 'changes_requested' | 'ready_for_review' | 'draft'
  clickup_status: string;   // The exact ClickUp status name, e.g. "In Review"
  description: string | null;
  enabled: number;          // 1 = enabled, 0 = disabled
  created_at: string;
}

export interface ProjectContext {
  id: number;
  name: string;
  github_repos: string;       // JSON array of "owner/repo"
  clickup_list_ids: string;   // JSON array of list IDs
  harvest_project_ids: string; // JSON array of Harvest project IDs
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  id: number;
  session_id: string;
  role: string;
  content: string;
  tool_calls: string | null;   // JSON if present
  tool_call_id: string | null;
  created_at: string;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS pr_ticket_links (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    pr_url           TEXT    NOT NULL,
    pr_number        INTEGER NOT NULL DEFAULT 0,
    repo_full_name   TEXT    NOT NULL DEFAULT '',
    pr_title         TEXT    NOT NULL DEFAULT '',
    ticket_id        TEXT    NOT NULL,
    ticket_url       TEXT    NOT NULL DEFAULT '',
    ticket_title     TEXT    NOT NULL DEFAULT '',
    project_hint     TEXT,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(pr_url, ticket_id)
  );

  CREATE TABLE IF NOT EXISTS sync_rules (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    pr_event         TEXT    NOT NULL,
    clickup_status   TEXT    NOT NULL,
    description      TEXT,
    enabled          INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(pr_event)
  );

  CREATE TABLE IF NOT EXISTS project_contexts (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    name                  TEXT    NOT NULL UNIQUE,
    github_repos          TEXT    NOT NULL DEFAULT '[]',
    clickup_list_ids      TEXT    NOT NULL DEFAULT '[]',
    harvest_project_ids   TEXT    NOT NULL DEFAULT '[]',
    notes                 TEXT,
    created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS conversation_history (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id     TEXT    NOT NULL,
    role           TEXT    NOT NULL,
    content        TEXT    NOT NULL DEFAULT '',
    tool_calls     TEXT,
    tool_call_id   TEXT,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_conv_session
    ON conversation_history(session_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_links_ticket
    ON pr_ticket_links(ticket_id);
  CREATE INDEX IF NOT EXISTS idx_links_pr
    ON pr_ticket_links(pr_url);
`;

// ─── DB singleton ────────────────────────────────────────────────────────────

function openDb() {
  mkdirSync(dirname(config.db.path), { recursive: true });
  const db = new Database(config.db.path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _db: any;
function getDb() {
  if (!_db) _db = openDb();
  return _db;
}

// ─── PR-Ticket Links ──────────────────────────────────────────────────────────

export const links = {
  upsert(data: Omit<PrTicketLink, 'id' | 'created_at' | 'updated_at'>): void {
    getDb().prepare(`
      INSERT INTO pr_ticket_links (pr_url, pr_number, repo_full_name, pr_title, ticket_id, ticket_url, ticket_title, project_hint)
      VALUES (@pr_url, @pr_number, @repo_full_name, @pr_title, @ticket_id, @ticket_url, @ticket_title, @project_hint)
      ON CONFLICT(pr_url, ticket_id) DO UPDATE SET
        pr_title     = excluded.pr_title,
        ticket_title = excluded.ticket_title,
        project_hint = excluded.project_hint,
        updated_at   = datetime('now')
    `).run(data);
  },

  getByTicket(ticketId: string): PrTicketLink[] {
    return getDb().prepare(
      `SELECT * FROM pr_ticket_links WHERE ticket_id = ? ORDER BY created_at DESC`
    ).all(ticketId);
  },

  getByPr(prUrl: string): PrTicketLink[] {
    return getDb().prepare(
      `SELECT * FROM pr_ticket_links WHERE pr_url = ? ORDER BY created_at DESC`
    ).all(prUrl);
  },

  getByRepo(repoFullName: string): PrTicketLink[] {
    return getDb().prepare(
      `SELECT * FROM pr_ticket_links WHERE repo_full_name = ? ORDER BY updated_at DESC`
    ).all(repoFullName);
  },

  listAll(): PrTicketLink[] {
    return getDb().prepare(
      `SELECT * FROM pr_ticket_links ORDER BY updated_at DESC LIMIT 100`
    ).all();
  },

  delete(id: number): void {
    getDb().prepare(`DELETE FROM pr_ticket_links WHERE id = ?`).run(id);
  },
};

// ─── Sync Rules ───────────────────────────────────────────────────────────────

export const syncRules = {
  list(): SyncRule[] {
    return getDb().prepare(`SELECT * FROM sync_rules ORDER BY pr_event`).all();
  },

  get(prEvent: string): SyncRule | undefined {
    return getDb().prepare(
      `SELECT * FROM sync_rules WHERE pr_event = ? AND enabled = 1`
    ).get(prEvent);
  },

  upsert(prEvent: string, clickupStatus: string, description?: string): void {
    getDb().prepare(`
      INSERT INTO sync_rules (pr_event, clickup_status, description)
      VALUES (?, ?, ?)
      ON CONFLICT(pr_event) DO UPDATE SET
        clickup_status = excluded.clickup_status,
        description    = excluded.description
    `).run(prEvent, clickupStatus, description ?? null);
  },

  setEnabled(prEvent: string, enabled: boolean): void {
    getDb().prepare(
      `UPDATE sync_rules SET enabled = ? WHERE pr_event = ?`
    ).run(enabled ? 1 : 0, prEvent);
  },

  delete(prEvent: string): void {
    getDb().prepare(`DELETE FROM sync_rules WHERE pr_event = ?`).run(prEvent);
  },
};

// ─── Project Contexts ─────────────────────────────────────────────────────────

export const projects = {
  list(): ProjectContext[] {
    return getDb().prepare(`SELECT * FROM project_contexts ORDER BY name`).all();
  },

  get(name: string): ProjectContext | undefined {
    return getDb().prepare(`SELECT * FROM project_contexts WHERE name = ?`).get(name);
  },

  upsert(data: {
    name: string;
    github_repos?: string[];
    clickup_list_ids?: string[];
    harvest_project_ids?: string[];
    notes?: string;
  }): void {
    const existing = projects.get(data.name);
    if (existing) {
      getDb().prepare(`
        UPDATE project_contexts SET
          github_repos        = @github_repos,
          clickup_list_ids    = @clickup_list_ids,
          harvest_project_ids = @harvest_project_ids,
          notes               = @notes,
          updated_at          = datetime('now')
        WHERE name = @name
      `).run({
        name: data.name,
        github_repos: JSON.stringify(data.github_repos ?? JSON.parse(existing.github_repos)),
        clickup_list_ids: JSON.stringify(data.clickup_list_ids ?? JSON.parse(existing.clickup_list_ids)),
        harvest_project_ids: JSON.stringify(data.harvest_project_ids ?? JSON.parse(existing.harvest_project_ids)),
        notes: data.notes ?? existing.notes,
      });
    } else {
      getDb().prepare(`
        INSERT INTO project_contexts (name, github_repos, clickup_list_ids, harvest_project_ids, notes)
        VALUES (@name, @github_repos, @clickup_list_ids, @harvest_project_ids, @notes)
      `).run({
        name: data.name,
        github_repos: JSON.stringify(data.github_repos ?? []),
        clickup_list_ids: JSON.stringify(data.clickup_list_ids ?? []),
        harvest_project_ids: JSON.stringify(data.harvest_project_ids ?? []),
        notes: data.notes ?? null,
      });
    }
  },

  delete(name: string): void {
    getDb().prepare(`DELETE FROM project_contexts WHERE name = ?`).run(name);
  },
};

// ─── Conversation History ─────────────────────────────────────────────────────

export const conversations = {
  add(sessionId: string, msg: {
    role: string;
    content: string;
    tool_calls?: object;
    tool_call_id?: string;
  }): void {
    getDb().prepare(`
      INSERT INTO conversation_history (session_id, role, content, tool_calls, tool_call_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      sessionId,
      msg.role,
      msg.content,
      msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
      msg.tool_call_id ?? null,
    );
  },

  getRecent(sessionId: string, limit = 50): ConversationMessage[] {
    return getDb().prepare(`
      SELECT * FROM conversation_history
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(sessionId, limit).reverse();
  },

  clearSession(sessionId: string): void {
    getDb().prepare(`DELETE FROM conversation_history WHERE session_id = ?`).run(sessionId);
  },
};
