import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { cfg } from "../utils/config.js";

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = cfg.db.path.replace("~", process.env.HOME ?? "");
  mkdirSync(dirname(dbPath), { recursive: true });

  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  migrate(_db);
  return _db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    -- PR <-> Ticket relationships (the memory layer)
    CREATE TABLE IF NOT EXISTS pr_ticket_links (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      pr_number     INTEGER NOT NULL,
      pr_url        TEXT    NOT NULL,
      pr_title      TEXT    NOT NULL,
      ticket_id     TEXT    NOT NULL,
      ticket_url    TEXT    NOT NULL,
      ticket_title  TEXT    NOT NULL,
      repo          TEXT    NOT NULL,
      confidence    TEXT    NOT NULL DEFAULT 'manual',  -- 'manual' | 'auto'
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_pr_ticket_unique
      ON pr_ticket_links (pr_number, ticket_id, repo);

    -- Chat conversation history (persists across sessions)
    CREATE TABLE IF NOT EXISTS conversations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      role       TEXT NOT NULL,    -- 'user' | 'assistant'
      content    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- End-of-day summaries
    CREATE TABLE IF NOT EXISTS daily_summaries (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      date            TEXT NOT NULL UNIQUE,
      summary         TEXT NOT NULL,
      hours_logged    REAL NOT NULL DEFAULT 0,
      harvest_entry_id TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Sync event log
    CREATE TABLE IF NOT EXISTS sync_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type  TEXT NOT NULL,  -- 'pr_opened' | 'pr_approved' | 'pr_merged' | 'pr_closed'
      pr_number   INTEGER NOT NULL,
      ticket_id   TEXT NOT NULL,
      old_status  TEXT,
      new_status  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

// ─── PR-Ticket Links ──────────────────────────────────────────────────────────

export interface PrTicketLink {
  id: number;
  pr_number: number;
  pr_url: string;
  pr_title: string;
  ticket_id: string;
  ticket_url: string;
  ticket_title: string;
  repo: string;
  confidence: string;
  created_at: string;
  updated_at: string;
}

export function upsertPrTicketLink(
  link: Omit<PrTicketLink, "id" | "created_at" | "updated_at">
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO pr_ticket_links (pr_number, pr_url, pr_title, ticket_id, ticket_url, ticket_title, repo, confidence)
    VALUES (@pr_number, @pr_url, @pr_title, @ticket_id, @ticket_url, @ticket_title, @repo, @confidence)
    ON CONFLICT (pr_number, ticket_id, repo) DO UPDATE SET
      pr_title     = excluded.pr_title,
      ticket_title = excluded.ticket_title,
      confidence   = excluded.confidence,
      updated_at   = datetime('now')
  `).run(link);
}

export function getTicketsForPr(prNumber: number, repo: string): PrTicketLink[] {
  return getDb()
    .prepare(`SELECT * FROM pr_ticket_links WHERE pr_number = ? AND repo = ?`)
    .all(prNumber, repo) as PrTicketLink[];
}

export function getPrsForTicket(ticketId: string): PrTicketLink[] {
  return getDb()
    .prepare(`SELECT * FROM pr_ticket_links WHERE ticket_id = ?`)
    .all(ticketId) as PrTicketLink[];
}

export function searchLinks(query: string): PrTicketLink[] {
  const like = `%${query}%`;
  return getDb()
    .prepare(`
      SELECT * FROM pr_ticket_links
      WHERE pr_title LIKE ? OR ticket_title LIKE ? OR ticket_id LIKE ?
      ORDER BY updated_at DESC LIMIT 20
    `)
    .all(like, like, like) as PrTicketLink[];
}

export function getAllLinks(): PrTicketLink[] {
  return getDb()
    .prepare(`SELECT * FROM pr_ticket_links ORDER BY updated_at DESC LIMIT 100`)
    .all() as PrTicketLink[];
}

// ─── Conversation History ─────────────────────────────────────────────────────

export interface ConversationMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export function saveMessage(role: "user" | "assistant", content: string): void {
  getDb()
    .prepare(`INSERT INTO conversations (role, content) VALUES (?, ?)`)
    .run(role, content);
}

export function getRecentHistory(limit = 20): ConversationMessage[] {
  return getDb()
    .prepare(`
      SELECT * FROM conversations
      ORDER BY id DESC LIMIT ?
    `)
    .all(limit)
    .reverse() as ConversationMessage[];
}

// ─── Daily Summaries ──────────────────────────────────────────────────────────

export function saveDailySummary(
  date: string,
  summary: string,
  hoursLogged: number,
  harvestEntryId?: string
): void {
  getDb()
    .prepare(`
      INSERT INTO daily_summaries (date, summary, hours_logged, harvest_entry_id)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (date) DO UPDATE SET
        summary          = excluded.summary,
        hours_logged     = excluded.hours_logged,
        harvest_entry_id = excluded.harvest_entry_id
    `)
    .run(date, summary, hoursLogged, harvestEntryId ?? null);
}

export function getSummaryForDate(date: string) {
  return getDb()
    .prepare(`SELECT * FROM daily_summaries WHERE date = ?`)
    .get(date);
}

// ─── Sync Events ──────────────────────────────────────────────────────────────

export function logSyncEvent(
  eventType: string,
  prNumber: number,
  ticketId: string,
  oldStatus: string | null,
  newStatus: string | null
): void {
  getDb()
    .prepare(`
      INSERT INTO sync_events (event_type, pr_number, ticket_id, old_status, new_status)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(eventType, prNumber, ticketId, oldStatus, newStatus);
}
