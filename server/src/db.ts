import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AgentEvent, LoggedEvent, ReviewComment, ReviewRound } from '../../shared/protocol.ts';
import { DATA_DIR } from './repos.ts';

export const db = new DatabaseSync(process.env.STUDIO_DB || path.join(DATA_DIR, 'studio.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS sessions (
    repo TEXT NOT NULL, agent TEXT NOT NULL, acp_session_id TEXT NOT NULL,
    updated_at TEXT NOT NULL, PRIMARY KEY (repo, agent)
  );
  CREATE TABLE IF NOT EXISTS events (
    repo TEXT NOT NULL, seq INTEGER NOT NULL, at TEXT NOT NULL, json TEXT NOT NULL,
    PRIMARY KEY (repo, seq)
  );
  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY, repo TEXT NOT NULL, change TEXT NOT NULL, json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS comments_by_change ON comments (repo, change);
  CREATE TABLE IF NOT EXISTS rounds (
    id TEXT PRIMARY KEY, repo TEXT NOT NULL, change TEXT NOT NULL, created_at TEXT NOT NULL,
    json TEXT NOT NULL, snapshot TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS rounds_by_change ON rounds (repo, change, created_at);
`);

// ---- sessions ---------------------------------------------------------------
export const sessions = {
  get(repo: string, agent: string): string | null {
    const r = db.prepare('SELECT acp_session_id FROM sessions WHERE repo = ? AND agent = ?').get(repo, agent) as any;
    return r?.acp_session_id ?? null;
  },
  set(repo: string, agent: string, id: string) {
    db.prepare(`INSERT INTO sessions VALUES (?, ?, ?, ?)
      ON CONFLICT (repo, agent) DO UPDATE SET acp_session_id = excluded.acp_session_id, updated_at = excluded.updated_at`)
      .run(repo, agent, id, new Date().toISOString());
  },
  clear(repo: string, agent: string) {
    db.prepare('DELETE FROM sessions WHERE repo = ? AND agent = ?').run(repo, agent);
  },
};

// ---- event log --------------------------------------------------------------
const MAX_EVENTS = 5000;
export const events = {
  append(repo: string, event: AgentEvent): LoggedEvent {
    const last = db.prepare('SELECT MAX(seq) AS s FROM events WHERE repo = ?').get(repo) as any;
    const entry: LoggedEvent = { seq: (last?.s ?? 0) + 1, at: new Date().toISOString(), event };
    db.prepare('INSERT INTO events VALUES (?, ?, ?, ?)').run(repo, entry.seq, entry.at, JSON.stringify(event));
    if (entry.seq % 500 === 0) db.prepare('DELETE FROM events WHERE repo = ? AND seq <= ?').run(repo, entry.seq - MAX_EVENTS);
    return entry;
  },
  list(repo: string, limit = 2000): LoggedEvent[] {
    const rows = db.prepare('SELECT seq, at, json FROM events WHERE repo = ? ORDER BY seq DESC LIMIT ?').all(repo, limit) as any[];
    return rows.reverse().map((r) => ({ seq: r.seq, at: r.at, event: JSON.parse(r.json) }));
  },
  clear(repo: string) {
    db.prepare('DELETE FROM events WHERE repo = ?').run(repo);
  },
};

// ---- comments ---------------------------------------------------------------
export const comments = {
  list(repo: string, change: string): ReviewComment[] {
    return (db.prepare('SELECT json FROM comments WHERE repo = ? AND change = ?').all(repo, change) as any[])
      .map((r) => JSON.parse(r.json) as ReviewComment)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },
  get(id: string): ReviewComment | null {
    const r = db.prepare('SELECT json FROM comments WHERE id = ?').get(id) as any;
    return r ? JSON.parse(r.json) : null;
  },
  put(c: ReviewComment) {
    db.prepare('INSERT INTO comments VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET json = excluded.json')
      .run(c.id, c.repo, c.change, JSON.stringify(c));
  },
  delete(id: string) {
    db.prepare('DELETE FROM comments WHERE id = ?').run(id);
  },
};

// ---- review rounds ----------------------------------------------------------
export type Snapshot = Record<string, string>; // file (relative to change dir) -> content

export const rounds = {
  list(repo: string, change: string): ReviewRound[] {
    return (db.prepare('SELECT json FROM rounds WHERE repo = ? AND change = ? ORDER BY created_at DESC').all(repo, change) as any[])
      .map((r) => JSON.parse(r.json));
  },
  get(id: string): { round: ReviewRound; snapshot: Snapshot } | null {
    const r = db.prepare('SELECT json, snapshot FROM rounds WHERE id = ?').get(id) as any;
    return r ? { round: JSON.parse(r.json), snapshot: JSON.parse(r.snapshot) } : null;
  },
  put(round: ReviewRound, snapshot: Snapshot) {
    db.prepare(`INSERT INTO rounds VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET json = excluded.json, snapshot = excluded.snapshot`)
      .run(round.id, round.repo, round.change, round.createdAt, JSON.stringify(round), JSON.stringify(snapshot));
  },
  running(repo: string): ReviewRound | null {
    const all = (db.prepare('SELECT json FROM rounds WHERE repo = ?').all(repo) as any[]).map((r) => JSON.parse(r.json) as ReviewRound);
    return all.find((r) => r.status === 'running') ?? null;
  },
};
