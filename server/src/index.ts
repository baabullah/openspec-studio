import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import { Hono, type Context } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { WebSocketServer, type WebSocket } from 'ws';
import chokidar, { type FSWatcher } from 'chokidar';
import type { ClientMsg, LifecycleAction, ServerMsg } from '../../shared/protocol.ts';
import { agents, DEFAULT_AGENT, getAgent } from './agents.ts';
import { comments, events, rounds } from './db.ts';
import { Hub } from './acp/hub.ts';
import * as openspec from './openspec.ts';
import { findRepos, hasOpenSpec, repoPath, ROOT, safeResolve, STUDIO_DIR } from './repos.ts';
import { allowedHostnames, hostAllowed, requestAllowed } from './security.ts';
import { closeRound, closeStaleRounds, createComment, onTurnEnd, sendReview } from './review/service.ts';

const PORT = Number(process.env.PORT || 3940);
const HOST = process.env.HOST || '127.0.0.1'; // the agent can run code: keep this local

// ---- realtime fan-out --------------------------------------------------------
const subscribers = new Map<string, Set<WebSocket>>(); // repo -> sockets
const send = (ws: WebSocket, m: ServerMsg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
const broadcast = (repo: string, m: ServerMsg) => subscribers.get(repo)?.forEach((ws) => send(ws, m));

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
const reviewChanged = (repo: string, change: string) => broadcast(repo, { type: 'review_changed', repo, change });

// ---- HTTP API ------------------------------------------------------------------
const app = new Hono();

const ALLOWED = allowedHostnames();

// DNS rebinding: only answer requests addressed to a host we serve (everything, incl. static files)
app.use('*', async (c, next) => {
  if (!hostAllowed(c.req.header('host'), ALLOWED)) return c.text('forbidden host', 403);
  await next();
});

// CSRF: mutating requests must be same-origin JSON
app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'GET') {
    if (!requestAllowed(c.req.header('host'), c.req.header('origin'), ALLOWED) || !c.req.header('content-type')?.startsWith('application/json')) {
      return c.json({ error: 'forbidden' }, 403);
    }
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
const body = async (c: Context) => (await c.req.json().catch(() => ({}))) as Record<string, any>;
const validChange = (abs: string, change: unknown): change is string =>
  typeof change === 'string' && /^[\w.-]+$/.test(change) && fs.existsSync(openspec.changeDir(abs, change));

app.get('/api/config', (c) => c.json({
  root: ROOT, defaultAgent: DEFAULT_AGENT,
  agents: agents().map(({ id, label, openspecTool }) => ({ id, label, openspecTool })),
}));

app.get('/api/repos', (c) => c.json(findRepos(c.req.query('refresh') === '1').map((name) => ({
  name, openspec: hasOpenSpec(path.join(ROOT, name)), session: hub.get(name)?.state() ?? null,
}))));

app.post('/api/init', async (c) => {
  const b = await body(c);
  const { repo, abs } = repoOf(c, b.repo);
  const agent = getAgent(b.agent);
  if (!agent?.openspecTool) return c.json({ error: 'agent has no OpenSpec integration' }, 400);
  if (hasOpenSpec(abs)) return c.json({ error: 'already initialized' }, 409);
  const r = await openspec.init(abs, agent.openspecTool);
  findRepos(true);
  hub.emit(repo, { kind: 'notice', level: r.ok ? 'info' : 'error', text: `openspec init --tools ${agent.openspecTool}\n${r.out.trim()}` });
  return c.json({ ok: r.ok, output: r.out }, r.ok ? 200 : 500);
});

app.get('/api/changes', async (c) => {
  const { repo, abs } = repoOf(c);
  const [active, archived] = await Promise.all([
    openspec.listChanges(abs, (ch) => comments.list(repo, ch)),
    openspec.listArchived(abs),
  ]);
  return c.json({ active, archived });
});

app.get('/api/file', (c) => {
  const { abs } = repoOf(c);
  const base = path.join(abs, 'openspec');
  const file = fs.existsSync(base) ? safeResolve(base, c.req.query('path') ?? '') : null;
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return c.json({ error: 'file not found' }, 404);
  return c.json({ content: fs.readFileSync(file, 'utf8') });
});

// lifecycle buttons: the server owns the agent-specific command syntax
app.post('/api/action', async (c) => {
  const b = await body(c);
  const { repo, abs } = repoOf(c, b.repo);
  const s = hub.get(repo);
  if (!s) return c.json({ error: 'no agent session' }, 409);
  const action = b.action as LifecycleAction;
  if (!['propose', 'explore', 'update', 'apply', 'sync', 'archive'].includes(action)) return c.json({ error: 'bad action' }, 400);
  const needsChange = ['update', 'apply', 'sync', 'archive'].includes(action);
  if (needsChange && !validChange(abs, b.change)) return c.json({ error: 'unknown change' }, 400);
  const text = String(b.text ?? '').trim().slice(0, 4000);
  const args = [needsChange ? b.change : '', text].filter(Boolean).join(' ');
  if (action === 'propose' && !text) return c.json({ error: 'describe the change' }, 400);
  const label = `${action[0].toUpperCase()}${action.slice(1)}${needsChange ? ` · ${b.change}` : ''}`;
  // a new lifecycle step supersedes a review that is waiting for Continue
  const open = rounds.running(repo);
  if (open && closeRound(repo, abs, open.change)) reviewChanged(repo, open.change);
  s.prompt(s.agent.command(action, args), label).catch(() => {});
  return c.json({ ok: true });
});

// ---- review API
app.get('/api/review', (c) => {
  const { repo, abs } = repoOf(c);
  const change = c.req.query('change');
  if (!validChange(abs, change)) return c.json({ comments: [], rounds: [] });
  return c.json({ comments: comments.list(repo, change), rounds: rounds.list(repo, change) });
});

app.post('/api/comments', async (c) => {
  const b = await body(c);
  const { repo, abs } = repoOf(c, b.repo);
  if (!validChange(abs, b.change)) return c.json({ error: 'unknown change' }, 400);
  const cm = createComment(repo, b.change, b);
  reviewChanged(repo, b.change);
  return c.json(cm);
});

app.patch('/api/comments/:id', async (c) => {
  const cm = comments.get(c.req.param('id'));
  if (!cm) return c.json({ error: 'not found' }, 404);
  const b = await body(c);
  const next = { ...cm };
  if (typeof b.body === 'string') next.body = b.body.slice(0, 8000);
  if (['comment', 'change', 'remove', 'question', 'ok'].includes(b.kind)) next.kind = b.kind;
  if (b.status === 'resolved') next.status = 'resolved';
  if (b.status === 'draft') { next.status = 'draft'; next.roundId = null; } // reopen → goes out with the next review
  comments.put(next);
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
  const b = await body(c);
  const { repo, abs } = repoOf(c, b.repo);
  if (!validChange(abs, b.change)) return c.json({ error: 'unknown change' }, 400);
  const s = hub.get(repo);
  if (!s || s.status !== 'ready') return c.json({ error: s ? 'agent is busy' : 'connect an agent first' }, 409);
  const round = await sendReview(s, repo, abs, b.change, () => reviewChanged(repo, b.change));
  return c.json(round);
});

app.post('/api/review/close', async (c) => {
  const b = await body(c);
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
  const rel = path.relative(process.cwd(), WEB_DIST);
  app.use('/*', serveStatic({ root: rel }));
  app.get('*', serveStatic({ path: path.join(rel, 'index.html') }));
}

// ---- WebSocket -----------------------------------------------------------------
const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () =>
  console.log(`openspec-studio api on http://${HOST}:${PORT}  (repos root: ${ROOT})`));

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
    let m: ClientMsg;
    try { m = JSON.parse(String(raw)); } catch { return; }
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
          const res = await s?.prompt(String(m.text).slice(0, 20000));
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

closeStaleRounds(repoPath, findRepos());

const shutdown = () => { hub.stopAll(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
