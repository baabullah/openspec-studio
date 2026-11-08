import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import { Hono, type Context } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { WebSocketServer, type WebSocket } from 'ws';
import chokidar, { type FSWatcher } from 'chokidar';
import type { ArchivedChange, ServerMsg } from '../../shared/protocol.ts';
import { agents, DEFAULT_AGENT, getAgent } from './agents.ts';
import { comments, db, events, migrateRepoIds, rounds } from './db.ts';
import { Hub } from './acp/hub.ts';
import * as openspec from './openspec.ts';
import { hasOpenSpec, safeResolve, STUDIO_DIR, STUDIO_VERSION } from './repos.ts';
import { addRoot, browse, findRepos, removeRoot, repoPath, reviewInRepo, roots, seedRoots, setReviewInRepo } from './workspace.ts';
import { importRecords, readReviewFile, REVIEW_FILE, writeReviewFile } from './review/repoFile.ts';
import { randomUUID } from 'node:crypto';
import { updateInfo } from './updates.ts';
import { gitInfo } from './git.ts';
import { allowedHostnames, hostAllowed, mutationAllowed, requestAllowed } from './security.ts';
import { closeRound, closeStaleRounds, createComment, onTurnEnd, patchComment, sendReview } from './review/service.ts';
import { settingsBody, actionBody, changeBody, clientMsg, commentCreate, commentPatch, describeIssues, initBody, parseOr400, rootBody } from './schemas.ts';
import type { z } from 'zod';

// Older versions identified repos by their path relative to a single REPOS_ROOT
// (default: two levels above this folder). Move that data to absolute ids, and
// keep that root as a folder so existing repos stay listed.
const LEGACY_ROOT = path.resolve(process.env.REPOS_ROOT || path.join(STUDIO_DIR, '..', '..'));
seedRoots(migrateRepoIds(LEGACY_ROOT, {
  exists: (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } },
  real: (p) => { try { return fs.realpathSync.native(p); } catch { return p; } },
  join: (a, b) => path.join(a, b),
}));

const PORT = Number(process.env.PORT || 3940);
const HOST = process.env.HOST || '127.0.0.1'; // the agent can run code: keep this local

// ---- realtime fan-out --------------------------------------------------------
const subscribers = new Map<string, Set<WebSocket>>(); // repo -> sockets
const send = (ws: WebSocket, m: ServerMsg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
const broadcast = (repo: string, m: ServerMsg) => subscribers.get(repo)?.forEach((ws) => { send(ws, m); });

const hub = new Hub({
  onEvent: (repo, entry) => broadcast(repo, { type: 'event', repo, entry }),
  onState: (repo, session) => { broadcast(repo, { type: 'session', repo, session }); syncWatcher(repo); },
});

// watch <repo>/openspec while anyone looks at the repo or an agent runs there
const watchers = new Map<string, FSWatcher>();
const debounce = new Map<string, NodeJS.Timeout>();
function syncWatcher(repo: string) {
  const want = (subscribers.get(repo)?.size ?? 0) > 0 || !!hub.get(repo);
  const abs = repoPath(repo);
  if (want && abs && !watchers.has(repo)) {
    // WSL: inotify is unreliable on Windows drives (/mnt/c), so poll there
    const poll = abs.startsWith('/mnt/');
    const w = chokidar.watch(path.join(abs, 'openspec'), {
      ignoreInitial: true, depth: 8, awaitWriteFinish: { stabilityThreshold: 150 },
      ignored: (p: string) => path.basename(p) === REVIEW_FILE, // Studio writes it itself
      usePolling: poll, interval: 700, binaryInterval: 2000,
    });
    w.on('all', (_ev, file) => {
      clearTimeout(debounce.get(repo));
      debounce.set(repo, setTimeout(() => broadcast(repo, { type: 'artifacts_changed', repo, path: path.relative(abs, file) }), 250));
    });
    watchers.set(repo, w);
  } else if (!want && watchers.has(repo)) {
    watchers.get(repo)!.close();
    watchers.delete(repo);
  }
}
/** Keep the repo's copy of a change's review history current (repos that opted in). */
function exportReview(repo: string, change: string) {
  const abs = repoPath(repo);
  if (!abs || !reviewInRepo(repo)) return;
  try { writeReviewFile(openspec.changeDir(abs, change), change, comments.list(repo, change), rounds.list(repo, change)); }
  catch (e) { console.warn(`review export for ${change} failed:`, (e as Error).message); }
}
const reviewChanged = (repo: string, change: string) => {
  exportReview(repo, change);
  broadcast(repo, { type: 'review_changed', repo, change });
};

// ---- HTTP API ------------------------------------------------------------------
const app = new Hono();

const ALLOWED = allowedHostnames();

// DNS rebinding: only answer requests addressed to a host we serve (everything, incl. static files)
app.use('*', async (c, next) => {
  if (!hostAllowed(c.req.header('host'), ALLOWED)) return c.text('forbidden host', 403);
  await next();
});

// CSRF: mutating requests must be same-origin (and POSTs JSON)
app.use('/api/*', async (c, next) => {
  if (!mutationAllowed(c.req.method, c.req.header('host'), c.req.header('origin'), c.req.header('content-type'), ALLOWED)) {
    return c.json({ error: 'forbidden' }, 403);
  }
  await next();
});
app.onError((e, c) => c.json({ error: e.message }, ((e as any).status ?? 500) as 500));

const repoOf = (c: Context, name?: string) => {
  const repo = name ?? c.req.query('repo') ?? '';
  const abs = repoPath(repo);
  if (!abs) throw Object.assign(new Error('repo not found'), { status: 404 });
  return { repo, abs };
};
const body = async <T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> => {
  const raw = await c.req.json().catch(() => { throw Object.assign(new Error('invalid request: body is not JSON'), { status: 400 }); });
  return parseOr400(schema, raw);
};
const validChange = (abs: string, change: unknown): change is string =>
  typeof change === 'string' && /^[\w.-]+$/.test(change) && fs.existsSync(openspec.changeDir(abs, change));

app.get('/api/config', (c) => c.json({
  defaultAgent: DEFAULT_AGENT, platform: process.platform, version: STUDIO_VERSION,
  agents: agents().map(({ id, label, openspecTool }) => ({ id, label, openspecTool })),
}));

// branch and friends; read-only (git actions are separate POSTs)
app.get('/api/git', async (c) => {
  const { abs } = repoOf(c);
  return c.json(await gitInfo(abs));
});

// a newer Studio on npm (checked at most once a day, see updates.ts)
app.get('/api/update', async (c) => c.json(await updateInfo()));

const listRepos = async (refresh = false) => {
  const { repos, truncated } = await findRepos(refresh);
  return {
    roots: roots().map((r) => ({ ...r, truncated: truncated.includes(r.path) })),
    repos: repos.map((r) => ({ ...r, openspec: hasOpenSpec(r.id), session: hub.get(r.id)?.state() ?? null })),
  };
};
app.get('/api/repos', async (c) => c.json(await listRepos(c.req.query('refresh') === '1')));

// folders the studio works in, chosen in the UI
app.post('/api/roots', async (c) => {
  const b = await body(c, rootBody);
  try { addRoot(b.path); } catch (e: any) { return c.json({ error: e.message }, 400); }
  return c.json(await listRepos(true));
});
app.delete('/api/roots', async (c) => {
  const b = await body(c, rootBody);
  // stop agents in repos that are no longer reachable
  removeRoot(b.path);
  for (const id of hub.repos()) if (!repoPath(id)) hub.stop(id);
  return c.json(await listRepos());
});
app.get('/api/browse', (c) => {
  try { return c.json(browse(c.req.query('path'))); } catch (e: any) { return c.json({ error: e.message }, 400); }
});

app.post('/api/init', async (c) => {
  const b = await body(c, initBody);
  const { repo, abs } = repoOf(c, b.repo);
  const agent = getAgent(b.agent);
  if (!agent?.openspecTool) return c.json({ error: 'agent has no OpenSpec integration' }, 400);
  if (hasOpenSpec(abs)) return c.json({ error: 'already initialized' }, 409);
  const r = await openspec.init(abs, agent.openspecTool);
  hub.emit(repo, { kind: 'notice', level: r.ok ? 'info' : 'error', text: `openspec init --tools ${agent.openspecTool}\n${r.out.trim()}` });
  return c.json({ ok: r.ok, output: r.out }, r.ok ? 200 : 500);
});

app.get('/api/changes', async (c) => {
  const { repo, abs } = repoOf(c);
  const [active, archived] = await Promise.all([
    openspec.listChanges(abs, (ch) => comments.list(repo, ch)),
    openspec.listArchived(abs),
  ]);
  return c.json({ active, archived, specs: openspec.listSpecs(abs), workflows: openspec.installedWorkflows(abs), reviewInRepo: reviewInRepo(repo) });
});

app.get('/api/file', (c) => {
  const { abs } = repoOf(c);
  const base = path.join(abs, 'openspec');
  const file = fs.existsSync(base) ? safeResolve(base, c.req.query('path') ?? '') : null;
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return c.json({ error: 'file not found' }, 404);
  const content = openspec.readDoc(file);
  if (content === null) return c.json({ error: `file is larger than ${openspec.MAX_DOC_BYTES} bytes` }, 413);
  return c.json({ content });
});

// lifecycle buttons: the server owns the agent-specific command syntax
app.post('/api/action', async (c) => {
  const b = await body(c, actionBody);
  const { repo, abs } = repoOf(c, b.repo);
  const s = hub.get(repo);
  if (!s) return c.json({ error: 'no agent session' }, 409);
  const { action } = b;
  const needsChange = ['update', 'apply', 'verify', 'sync', 'archive'].includes(action);
  if (needsChange && !validChange(abs, b.change)) return c.json({ error: 'unknown change' }, 400);
  const text = (b.text ?? '').trim();
  const args = [needsChange ? b.change : '', text].filter(Boolean).join(' ');
  if (action === 'propose' && !text) return c.json({ error: 'describe the change' }, 400);
  const label = `${action[0].toUpperCase()}${action.slice(1)}${needsChange ? ` · ${b.change}` : ''}`;
  // a new lifecycle step supersedes a review that is waiting for Continue
  const open = rounds.running(repo);
  if (open && closeRound(repo, abs, open.change)) reviewChanged(repo, open.change);
  s.prompt(s.agent.command(action, args), label).catch(() => {});
  return c.json({ ok: true });
});

// archived change: its artifacts plus the comments and review rounds kept under its old name
app.get('/api/archived', (c) => {
  const { repo, abs } = repoOf(c);
  const name = c.req.query('name') ?? '';
  if (!/^[\w.-]+$/.test(name) || !fs.existsSync(openspec.archivedDir(abs, name))) return c.json({ error: 'archived change not found' }, 404);
  const change = openspec.archivedChangeName(name);
  // the history that moved with the change wins; otherwise look it up by name in Studio's
  // database, unless a new active change took the same name (then it is that change's)
  const fromFile = readReviewFile(openspec.archivedDir(abs, name), repo);
  const historyHidden = !fromFile && fs.existsSync(openspec.changeDir(abs, change));
  const body: ArchivedChange = {
    name, change, files: openspec.archivedFiles(abs, name), historyHidden,
    comments: fromFile?.comments ?? (historyHidden ? [] : comments.list(repo, change)),
    rounds: fromFile?.rounds ?? (historyHidden ? [] : rounds.list(repo, change)),
  };
  return c.json(body);
});

// per-repo settings
app.post('/api/settings', async (c) => {
  const b = await body(c, settingsBody);
  const { repo, abs } = repoOf(c, b.repo);
  setReviewInRepo(repo, b.reviewInRepo);
  // turning it on writes the history that already exists
  if (b.reviewInRepo) for (const ch of fs.existsSync(path.join(abs, 'openspec', 'changes')) ? fs.readdirSync(path.join(abs, 'openspec', 'changes')) : []) {
    if (ch !== 'archive' && validChange(abs, ch)) exportReview(repo, ch);
  }
  return c.json({ reviewInRepo: reviewInRepo(repo) });
});

// ---- review API
app.get('/api/review', (c) => {
  const { repo, abs } = repoOf(c);
  const change = c.req.query('change');
  if (!validChange(abs, change)) return c.json({ comments: [], rounds: [] });
  // a change reviewed elsewhere (e.g. a teammate's branch) brings its history in the repo
  if (!comments.list(repo, change).length && !rounds.list(repo, change).length) {
    const file = readReviewFile(openspec.changeDir(abs, change), repo);
    if (file) {
      const rec = importRecords(file, change, { comment: (id) => !!comments.get(id), round: (id) => !!rounds.get(id) }, () => randomUUID().slice(0, 8));
      for (const cm of rec.comments) comments.put(cm);
      for (const r of rec.rounds) rounds.put(r, {});
    }
  }
  return c.json({ comments: comments.list(repo, change), rounds: rounds.list(repo, change) });
});

app.post('/api/comments', async (c) => {
  const b = await body(c, commentCreate);
  const { repo, abs } = repoOf(c, b.repo);
  if (!validChange(abs, b.change)) return c.json({ error: 'unknown change' }, 400);
  const cm = createComment(repo, b.change, b);
  reviewChanged(repo, b.change);
  return c.json(cm);
});

app.patch('/api/comments/:id', async (c) => {
  const cm = comments.get(c.req.param('id'));
  if (!cm) return c.json({ error: 'not found' }, 404);
  const b = await body(c, commentPatch);
  const next = patchComment(cm, b);
  if (!next) return c.json({ error: 'comment is in a running review' }, 409);
  reviewChanged(cm.repo, cm.change);
  return c.json(next);
});

app.delete('/api/comments/:id', (c) => {
  const cm = comments.get(c.req.param('id'));
  if (!cm) return c.json({ error: 'not found' }, 404);
  if (cm.status === 'sent') return c.json({ error: 'comment is in a running review' }, 409);
  comments.delete(cm.id);
  reviewChanged(cm.repo, cm.change);
  return c.json({ ok: true });
});

app.post('/api/review/send', async (c) => {
  const b = await body(c, changeBody);
  const { repo, abs } = repoOf(c, b.repo);
  if (!validChange(abs, b.change)) return c.json({ error: 'unknown change' }, 400);
  const s = hub.get(repo);
  if (s?.status !== 'ready') return c.json({ error: s ? 'agent is busy' : 'connect an agent first' }, 409);
  const round = await sendReview(s, repo, abs, b.change, () => reviewChanged(repo, b.change));
  return c.json(round);
});

app.post('/api/review/close', async (c) => {
  const b = await body(c, changeBody);
  const { repo, abs } = repoOf(c, b.repo);
  if (!validChange(abs, b.change)) return c.json({ error: 'unknown change' }, 400);
  if (hub.get(repo)?.status === 'busy') return c.json({ error: 'agent is still working' }, 409);
  if (!closeRound(repo, abs, b.change)) return c.json({ error: 'no open review round' }, 409);
  reviewChanged(repo, b.change);
  return c.json({ ok: true });
});

// ---- static (production build) ------------------------------------------------
const WEB_DIST = path.join(STUDIO_DIR, 'web', 'dist');
if (fs.existsSync(WEB_DIST)) {
  // absolute: the npm package's `openspec-studio` command runs from any folder (or drive)
  app.use('/*', serveStatic({ root: WEB_DIST }));
  app.get('*', serveStatic({ path: path.join(WEB_DIST, 'index.html') }));
}

// ---- WebSocket -----------------------------------------------------------------
const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () => {
  const folders = roots().map((r) => r.path).join(', ') || 'none yet, add one in the UI';
  if (fs.existsSync(WEB_DIST)) console.log(`OpenSpec Studio ${STUDIO_VERSION}: open http://${HOST}:${PORT}  (folders: ${folders})`);
  else console.log(`openspec-studio api on http://${HOST}:${PORT}  (folders: ${folders})`);
});
updateInfo().then((u) => { if (u.newer) console.log(`OpenSpec Studio ${u.latest} is available (you have ${u.current}). Update: ${u.command}`); }).catch(() => {});
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.error(`Port ${PORT} is already in use (is Studio already running?). Pick another one: --port <n> or PORT=<n>.`);
  process.exit(1);
});

const wss = new WebSocketServer({
  server: server as any,
  path: '/ws',
  verifyClient: ({ origin, req }: { origin: string; req: IncomingMessage }) => requestAllowed(req.headers.host, origin, ALLOWED),
});

wss.on('connection', (ws) => {
  const mine = new Set<string>();
  const sub = (repo: string) => {
    if (!subscribers.has(repo)) subscribers.set(repo, new Set());
    subscribers.get(repo)!.add(ws);
    mine.add(repo);
    syncWatcher(repo);
  };

  ws.on('message', async (raw) => {
    let json: unknown;
    try { json = JSON.parse(String(raw)); } catch { return send(ws, { type: 'error', message: 'invalid message: not JSON' }); }
    const parsed = clientMsg.safeParse(json);
    if (!parsed.success) return send(ws, { type: 'error', message: `invalid message: ${describeIssues(parsed.error)}` });
    const m = parsed.data;
    const abs = repoPath(m.repo);
    if (!abs) return send(ws, { type: 'error', message: 'repo not found' });
    const s = hub.get(m.repo);
    try {
      switch (m.type) {
        case 'subscribe':
          sub(m.repo);
          send(ws, { type: 'session', repo: m.repo, session: s?.state() ?? null });
          send(ws, { type: 'replay', repo: m.repo, entries: events.list(m.repo) });
          break;
        case 'start': {
          const agent = getAgent(m.agent);
          if (!agent) return send(ws, { type: 'error', message: `unknown agent ${m.agent}` });
          sub(m.repo);
          await hub.start(m.repo, abs, agent, m.resume !== false);
          send(ws, { type: 'replay', repo: m.repo, entries: events.list(m.repo) });
          break;
        }
        case 'stop': hub.stop(m.repo); break;
        case 'prompt': {
          // free-form turns (e.g. "Continue") may finish an interrupted review round
          const res = await s?.prompt(m.text);
          const ch = res && onTurnEnd(m.repo, abs, res.stopReason, res.reply);
          if (ch) reviewChanged(m.repo, ch);
          break;
        }
        case 'cancel': s?.cancel(); break;
        case 'permission': s?.answerPermission(m.id, m.optionId, m.label ?? (m.optionId ? 'answered' : 'cancelled')); break;
        case 'elicitation': s?.answerElicitation(m.id, m.action, m.content); break;
        case 'set_config': await s?.setConfig(m.configId, m.value); break;
      }
    } catch (e: any) {
      send(ws, { type: 'error', message: String(e?.message || e) });
    }
  });

  ws.on('close', () => {
    for (const repo of mine) { subscribers.get(repo)?.delete(ws); syncWatcher(repo); }
  });
});

closeStaleRounds(repoPath, rounds.repos());

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  hub.stopAll();
  for (const t of debounce.values()) clearTimeout(t);
  for (const ws of wss.clients) ws.terminate();
  wss.close();
  server.close();
  // chokidar polling (WSL /mnt/*) keeps timers alive until closed
  await Promise.allSettled([...watchers.values()].map((w) => w.close()));
  try { db.close(); } catch { /* already closed */ } // checkpoints the WAL
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
