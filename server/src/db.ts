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
  repos(): string[] {
    return (db.prepare('SELECT DISTINCT repo FROM rounds').all() as { repo: string }[]).map((r) => r.repo);
  },
  running(repo: string): ReviewRound | null {
    const all = (db.prepare('SELECT json FROM rounds WHERE repo = ?').all(repo) as any[]).map((r) => JSON.parse(r.json) as ReviewRound);
    return all.find((r) => r.status === 'running') ?? null;
  },
};

// ---- migration: repo ids used to be paths relative to REPOS_ROOT ------------------
const isAbsId = (r: string) => r.startsWith('/') || /^[A-Za-z]:[\\/]/.test(r) || r.startsWith('\\\\');

/**
 * Where did an old relative id live? REPOS_ROOT may have been set back then and
 * not now, so when <legacyRoot>/<rel> doesn't exist, look for absolute paths
 * ending in /<rel> in that repo's own agent events (tool calls quote the cwd).
 */
function locateLegacy(rel: string, legacyRoot: string, exists: (p: string) => boolean, join: (a: string, b: string) => string): string | null {
  const direct = join(legacyRoot, rel);
  if (exists(direct)) return direct;
  const esc = rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\//g, '[\\\\/]');
  const re = new RegExp(`((?:[A-Za-z]:|/)[^"'\\s\`]*?[\\\\/]${esc})(?=$|["'\\s\`\\\\/])`, 'g');
  const counts = new Map<string, number>();
  const rows = db.prepare('SELECT json FROM events WHERE repo = ? ORDER BY seq LIMIT 3000').all(rel) as { json: string }[];
  for (const r of rows) {
    const text = r.json.replace(/\\\\/g, '\\'); // JSON-escaped backslashes (Windows paths)
    for (const m of text.matchAll(re)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  const best = [...counts].sort((a, b) => b[1] - a[1]).find(([p]) => exists(p));
  return best?.[0] ?? null;
}

/**
 * Rewrite relative repo ids to absolute paths (the new id). Returns the folders
 * those repos were in, so the caller can keep them listed.
 */
export function migrateRepoIds(legacyRoot: string, fsx: { exists: (p: string) => boolean; real: (p: string) => string; join: (a: string, b: string) => string }): string[] {
  const old = new Set<string>();
  for (const t of ['sessions', 'events', 'comments', 'rounds']) {
    for (const r of db.prepare(`SELECT DISTINCT repo FROM ${t}`).all() as { repo: string }[]) if (!isAbsId(r.repo)) old.add(r.repo);
  }
  if (!old.size) return [];
  const folders = new Set<string>();
  db.exec('BEGIN');
  try {
    for (const rel of old) {
      const found = locateLegacy(rel, legacyRoot, fsx.exists, fsx.join);
      const abs = found ? fsx.real(found) : fsx.join(legacyRoot, rel); // not found: keep data, it just won't show
      if (found) {
        // the folder = abs minus the relative part
        const parts = rel.split('/').length;
        let root = abs;
        for (let i = 0; i < parts; i++) root = root.replace(/[\\/][^\\/]+$/, '');
        if (root) folders.add(root);
      }
      db.prepare('UPDATE sessions SET repo = ? WHERE repo = ?').run(abs, rel);
      db.prepare('UPDATE events SET repo = ? WHERE repo = ?').run(abs, rel);
      for (const t of ['comments', 'rounds']) {
        for (const row of db.prepare(`SELECT id, json FROM ${t} WHERE repo = ?`).all(rel) as { id: string; json: string }[]) {
          const j = JSON.parse(row.json);
          j.repo = abs;
          db.prepare(`UPDATE ${t} SET repo = ?, json = ? WHERE id = ?`).run(abs, JSON.stringify(j), row.id);
        }
      }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return [...folders];
}
