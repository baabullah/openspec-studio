import { create } from 'zustand';
import type {
  AgentInfo, ChangeSummary, ClientMsg, LifecycleAction, LoggedEvent, RepoInfo, ReviewComment, ReviewRound, RootInfo, ServerMsg, SessionState, Workspace,
} from '../../shared/protocol.ts';
import { api } from './lib/api.ts';

const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

export interface Toast { id: number; text: string; level: 'info' | 'error' }

interface State {
  agents: AgentInfo[];
  defaultAgent: string;
  platform: string;
  roots: RootInfo[];
  reposLoaded: boolean;
  repos: RepoInfo[];
  repo: string | null;
  agent: string;
  session: SessionState | null;
  events: LoggedEvent[];
  changes: ChangeSummary[];
  archived: string[];
  changesLoaded: boolean;
  change: string | null;
  file: string | null; // relative to change dir, or '__changes__' for the diff view
  content: string;
  comments: ReviewComment[];
  rounds: ReviewRound[];
  focusComment: string | null;
  toasts: Toast[];
  wsUp: boolean;
  addFolderOpen: boolean;
}

export const useStore = create<State>(() => ({
  agents: [], defaultAgent: 'codebuddy', platform: '', roots: [], reposLoaded: false, repos: [], repo: null, agent: 'codebuddy',
  session: null, events: [], changes: [], archived: [], changesLoaded: false, change: null, file: null, content: '',
  comments: [], rounds: [], focusComment: null, toasts: [], wsUp: false, addFolderOpen: false,
}));
const set = useStore.setState;
const get = useStore.getState;

// ---- toasts --------------------------------------------------------------------
let toastId = 0;
export function toast(text: string, level: Toast['level'] = 'info') {
  const id = ++toastId;
  set((s) => ({ toasts: [...s.toasts, { id, text, level }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), level === 'error' ? 7000 : 3500);
}
const guard = async <T,>(p: Promise<T>): Promise<T | undefined> => { try { return await p; } catch (e) { toast((e as Error).message, 'error'); return undefined; } };

// ---- websocket -----------------------------------------------------------------
let ws: WebSocket | null = null;
let retry = 0;
let connectedOnce = false;
const readyWaiters: (() => void)[] = [];

function connectWs() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => {
    retry = 0;
    set({ wsUp: true });
    const r = get().repo;
    if (r) wsSend({ type: 'subscribe', repo: r }); // also replays the agent transcript
    // while we were offline, file changes and review updates were broadcast to no one
    if (connectedOnce) { loadRepos(); loadChanges(); loadReview(); reloadFile(); }
    connectedOnce = true;
  };
  ws.onclose = () => { set({ wsUp: false }); setTimeout(connectWs, Math.min(5000, 500 * 2 ** retry++)); };
  ws.onmessage = (ev) => {
    let m: ServerMsg;
    try { m = JSON.parse(ev.data); } catch { console.warn('ignored a malformed server message'); return; }
    onServer(m);
  };
}
export function wsSend(m: ClientMsg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  else toast('Not connected to the studio server. Reconnecting…', 'error');
}

// The server replays at most this many events (db.ts events.list); keep the live
// transcript to the same window so a long session doesn't slow the page down.
const MAX_EVENTS = 2000;
const appendEvent = (list: LoggedEvent[], e: LoggedEvent) => (list.length >= MAX_EVENTS ? [...list.slice(list.length - MAX_EVENTS + 1), e] : [...list, e]);

let refreshTimer: ReturnType<typeof setTimeout> | undefined;
function onServer(m: ServerMsg) {
  if (m.type === 'error') return toast(m.message, 'error');
  if (m.repo !== get().repo) return;
  switch (m.type) {
    case 'session':
      set({ session: m.session });
      if (m.session?.status === 'ready') readyWaiters.splice(0).forEach((f) => f());
      set((s) => ({ repos: s.repos.map((r) => (r.id === m.repo ? { ...r, session: m.session } : r)) }));
      break;
    case 'replay': set({ events: m.entries }); break;
    case 'event':
      set((s) => ({ events: appendEvent(s.events, m.entry) }));
      if (m.entry.event.kind === 'permission' || m.entry.event.kind === 'elicitation') notifyAttention();
      break;
    case 'artifacts_changed':
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { loadChanges(); reloadFile(); }, 200);
      break;
    case 'review_changed':
      if (m.change === get().change) loadReview();
      loadChanges();
      break;
  }
}

function notifyAttention() {
  if (document.hasFocus()) return;
  try {
    if ('Notification' in window && Notification.permission === 'granted') new Notification('OpenSpec Studio', { body: 'The agent needs your decision' });
  } catch { /* ignore */ }
}

// ---- actions -------------------------------------------------------------------
let booted = false;
export async function boot() {
  if (booted) return;
  booted = true;
  connectWs();
  const cfg = await guard(api.config());
  if (cfg) set({ agents: cfg.agents, defaultAgent: cfg.defaultAgent, platform: cfg.platform });
  await loadRepos();
  const last = ls.get('repo');
  // older versions stored the path relative to the single repos root
  const hit = last && get().repos.find((r) => r.id === last || (r.rel && r.rel === last));
  if (hit) selectRepo(hit.id);
}

const applyWorkspace = (w: Workspace) => {
  set({ roots: w.roots, repos: w.repos, reposLoaded: true });
  const { repo } = get();
  if (repo && !w.repos.some((r) => r.id === repo)) set({ repo: null, session: null, events: [], changes: [], change: null, file: null, content: '' });
};

export async function loadRepos(refresh = false) {
  const w = await guard(api.repos(refresh));
  if (w) applyWorkspace(w);
}

export async function addRoot(path: string): Promise<boolean> {
  const w = await guard(api.addRoot(path));
  if (!w) return false;
  applyWorkspace(w);
  return true;
}

export const openAddFolder = (open = true) => set({ addFolderOpen: open });

export async function removeRoot(path: string) {
  const w = await guard(api.removeRoot(path));
  if (w) applyWorkspace(w);
}

export function selectRepo(id: string) {
  ls.set('repo', id);
  const agent = ls.get(`agent:${id}`) || get().defaultAgent;
  set({ repo: id, agent, session: null, events: [], changes: [], archived: [], changesLoaded: false, change: null, file: null, content: '', comments: [], rounds: [] });
  wsSend({ type: 'subscribe', repo: id });
  loadChanges();
}

export function setAgent(agent: string) {
  const r = get().repo;
  if (r) ls.set(`agent:${r}`, agent);
  set({ agent });
}

export function startAgent(resume = true) {
  const { repo, agent } = get();
  if (repo) wsSend({ type: 'start', repo, agent, resume });
}
export const stopAgent = () => { const r = get().repo; if (r) wsSend({ type: 'stop', repo: r }); };
export const cancelTurn = () => { const r = get().repo; if (r) wsSend({ type: 'cancel', repo: r }); };
export const sendPrompt = (text: string) => { const r = get().repo; if (r && text.trim()) wsSend({ type: 'prompt', repo: r, text }); };

/** Start the agent if needed and wait until it can take a prompt. */
export function ensureAgent(): Promise<boolean> {
  const s = get().session;
  if (s?.status === 'ready') return Promise.resolve(true);
  if (s?.status === 'busy') { toast('The agent is still working. Wait for it or press Stop.', 'error'); return Promise.resolve(false); }
  if (!s || s.status === 'exited' || s.status === 'error') startAgent();
  return new Promise((resolve) => {
    const t = setTimeout(() => { toast('The agent did not become ready', 'error'); resolve(false); }, 90_000);
    readyWaiters.push(() => { clearTimeout(t); resolve(true); });
  });
}

export async function runAction(action: LifecycleAction, change?: string, text?: string) {
  const repo = get().repo;
  if (!repo || !(await ensureAgent())) return;
  await guard(api.action(repo, action, change, text));
}

export async function initRepo() {
  const { repo, agent } = get();
  if (!repo) return;
  const r = await guard(api.init(repo, agent));
  if (!r) return;
  toast('OpenSpec initialized');
  await loadRepos();
  await loadChanges();
  // a fresh session so the agent picks up the new commands/skills
  if (get().session) startAgent(false);
}

export async function loadChanges() {
  const repo = get().repo;
  if (!repo) return;
  const r = await guard(api.changes(repo));
  if (!r || get().repo !== repo) return;
  set({ changes: r.active, archived: r.archived, changesLoaded: true });
  const { change } = get();
  if (change && !r.active.some((c) => c.name === change)) set({ change: null, file: null, content: '' });
}

export async function openChange(name: string, file?: string) {
  const c = get().changes.find((x) => x.name === name);
  set({ change: name, file: file ?? c?.files[0] ?? null, content: '', focusComment: null });
  await Promise.all([reloadFile(), loadReview()]);
}

export async function openFile(file: string) {
  set({ file, focusComment: null });
  await reloadFile();
}

async function reloadFile() {
  const { repo, change, file } = get();
  if (!repo || !change || !file || file === '__changes__') return;
  const r = await api.file(repo, `changes/${change}/${file}`).catch(() => null);
  if (get().file === file && get().change === change) set({ content: r?.content ?? '' });
}

export async function loadReview() {
  const { repo, change } = get();
  if (!repo || !change) return;
  const r = await guard(api.review(repo, change));
  if (r && get().change === change) set({ comments: r.comments, rounds: r.rounds });
}

export const review = {
  add: (c: Parameters<typeof api.addComment>[0]) => guard(api.addComment(c)).then((x) => { if (x) set({ focusComment: x.id }); }),
  patch: (id: string, p: Parameters<typeof api.patchComment>[1]) => guard(api.patchComment(id, p)),
  remove: (id: string) => guard(api.deleteComment(id)),
  async send() {
    const { repo, change } = get();
    if (!repo || !change || !(await ensureAgent())) return;
    const r = await guard(api.sendReview(repo, change));
    if (r) toast('Review sent to the agent');
  },
  async close() {
    const { repo, change } = get();
    if (repo && change) await guard(api.closeRound(repo, change));
  },
};

export function answerPermission(id: string, optionId: string | null, label: string) {
  const r = get().repo;
  if (r) wsSend({ type: 'permission', repo: r, id, optionId, label });
}
export function answerElicitation(id: string, action: 'accept' | 'decline' | 'cancel', content?: Record<string, unknown>) {
  const r = get().repo;
  if (r) wsSend({ type: 'elicitation', repo: r, id, action, content });
}
export function setConfig(configId: string, value: string | boolean) {
  const r = get().repo;
  if (r) wsSend({ type: 'set_config', repo: r, configId, value });
}

export function setTheme(t: 'light' | 'dark' | 'system') {
  ls.set('theme', t);
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}
export const initialTheme = () => (ls.get('theme') as 'light' | 'dark' | 'system' | null) ?? 'system';
