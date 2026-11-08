import { create } from 'zustand';
import type {
  AgentInfo, ArchivedChange, ChangeSummary, ClientMsg, GitInfo, OptionalWorkflow, SpecSummary, LifecycleAction, LoggedEvent, RepoInfo, ReviewComment, ReviewRound, RootInfo, ServerMsg, SessionState, Workspace,
} from '../../shared/protocol.ts';
import { api } from './lib/api.ts';

const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

/** A read-only document open in the middle pane instead of an active change. */
export type Browse =
  | { kind: 'spec'; name: string; file: string }
  /** file: an artifact of the archived change, or HISTORY_TAB */
  | { kind: 'archived'; name: string; file: string; data: ArchivedChange };

export const HISTORY_TAB = '__history__';

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
  specs: SpecSummary[];
  /** optional OpenSpec workflows installed in the repo */
  workflows: OptionalWorkflow[];
  /** this repo keeps its review history in openspec/changes/<change>/.studio-review.json */
  reviewInRepo: boolean;
  browse: Browse | null;
  /** the repo's branch; refreshed on focus, file changes and turn ends */
  git: GitInfo | null;
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
  /** a turn finished while the tab was in the background (cleared when it gets focus) */
  doneUnseen: boolean;
}

export const useStore = create<State>(() => ({
  // defaultAgent / agent come from /api/config (the server owns DEFAULT_AGENT)
  agents: [], defaultAgent: '', platform: '', roots: [], reposLoaded: false, repos: [], repo: null, agent: '',
  session: null, events: [], changes: [], archived: [], specs: [], workflows: [], reviewInRepo: false, browse: null, git: null, changesLoaded: false, change: null, file: null, content: '',
  comments: [], rounds: [], focusComment: null, toasts: [], wsUp: false, addFolderOpen: false, doneUnseen: false,
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
    // (repos first: the selected repo may be gone, and applyWorkspace then deselects it)
    if (connectedOnce) loadRepos().then(() => { if (get().repo) { loadChanges(); loadReview(); reloadFile(); } });
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
      if (m.session?.status === 'ready') for (const f of readyWaiters.splice(0)) f();
      set((s) => ({ repos: s.repos.map((r) => (r.id === m.repo ? { ...r, session: m.session } : r)) }));
      break;
    case 'replay': set({ events: m.entries }); break;
    case 'event':
      set((s) => ({ events: appendEvent(s.events, m.entry) }));
      if (m.entry.event.kind === 'permission' || m.entry.event.kind === 'elicitation') notifyAttention();
      if (m.entry.event.kind === 'turn_end') { notifyTurnEnd(m.entry.event.stopReason); loadGit(); }
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

function notify(title: string, body: string, tag?: string) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, tag });
  } catch { /* ignore */ }
}

function notifyAttention() {
  if (document.hasFocus()) return;
  notify('OpenSpec Studio', 'The agent needs your decision');
}

const STOP_TEXT: Record<string, string> = {
  end_turn: 'Done', cancelled: 'Stopped', refusal: 'Stopped early (refusal)', max_tokens: 'Stopped: output token limit',
  max_turn_requests: 'Stopped: step limit', error: 'Failed',
};

/** Long turns (build, review) finish while you are elsewhere: say so. */
function notifyTurnEnd(stopReason: string) {
  if (document.hasFocus()) return;
  // the request this turn answered: the last "user" entry
  const req = [...get().events].reverse().find((e) => e.event.kind === 'user')?.event;
  const what = req?.kind === 'user' ? (req.label ?? req.text.split('\n')[0].slice(0, 80)) : 'The agent';
  const repo = get().repos.find((r) => r.id === get().repo)?.name;
  notify(`${STOP_TEXT[stopReason] ?? stopReason}${repo ? ` · ${repo}` : ''}`, what, 'turn-end');
  set({ doneUnseen: true });
}

/** Ask once, from a click, so the browser shows the prompt. */
function askNotificationPermission() {
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {}); } catch { /* ignore */ }
}
// back from a terminal or git client: the branch may have changed
if (typeof window !== 'undefined') window.addEventListener('focus', () => { if (get().doneUnseen) set({ doneUnseen: false }); loadGit(); });

// ---- actions -------------------------------------------------------------------
let booted = false;
export async function boot() {
  if (booted) return;
  booted = true;
  connectWs();
  const cfg = await guard(api.config());
  if (cfg) set({ agents: cfg.agents, defaultAgent: cfg.defaultAgent, agent: get().agent || cfg.defaultAgent, platform: cfg.platform });
  await loadRepos();
  const last = ls.get('repo');
  // older versions stored the path relative to the single repos root
  const hit = last && get().repos.find((r) => r.id === last || (r.rel && r.rel === last));
  if (hit) selectRepo(hit.id);
}

const applyWorkspace = (w: Workspace) => {
  set({ roots: w.roots, repos: w.repos, reposLoaded: true });
  const { repo } = get();
  if (repo && !w.repos.some((r) => r.id === repo)) set({ repo: null, session: null, events: [], changes: [], specs: [], browse: null, change: null, file: null, content: '' });
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
  set({ repo: id, agent, session: null, events: [], changes: [], archived: [], specs: [], browse: null, git: null, changesLoaded: false, change: null, file: null, content: '', comments: [], rounds: [] });
  wsSend({ type: 'subscribe', repo: id });
  loadChanges();
}

export function setAgent(agent: string) {
  const r = get().repo;
  if (r) ls.set(`agent:${r}`, agent);
  set({ agent });
}

export function startAgent(resume = true) {
  askNotificationPermission();
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
  loadGit();
  const r = await guard(api.changes(repo));
  if (!r || get().repo !== repo) return;
  set({ changes: r.active, archived: r.archived, specs: r.specs, workflows: r.workflows, reviewInRepo: r.reviewInRepo, changesLoaded: true });
  const { browse } = get();
  if (browse?.kind === 'spec' && !r.specs.some((x) => x.name === browse.name)) set({ browse: null, content: '' });
  if (browse?.kind === 'archived' && !r.archived.includes(browse.name)) set({ browse: null, content: '' });
  const { change } = get();
  if (change && !r.active.some((c) => c.name === change)) set({ change: null, file: null, content: '' });
}

/** What the open view would commit: the active change, or the archived one. */
const gitScope = () => {
  const { change, browse } = get();
  return browse?.kind === 'archived' ? { archived: browse.name } : change ? { change } : {};
};

/** The repo's branch and the open change's uncommitted files (quietly: no toast when git is missing). */
export async function loadGit() {
  const repo = get().repo;
  if (!repo) return;
  const scope = gitScope();
  const g = await api.git(repo, scope).catch(() => null);
  if (get().repo === repo && JSON.stringify(gitScope()) === JSON.stringify(scope)) set({ git: g });
}

/** "Create branch change/<name>": the change's files come along to the new branch. */
export async function createChangeBranch(change: string) {
  const repo = get().repo;
  if (!repo) return;
  const g = await guard(api.gitBranch(repo, change));
  if (!g) return;
  toast(`Switched to the new branch ${g.branch}`);
  await loadGit();
}

/** Commit the files the user confirmed, for the open change (or archived change). */
export async function commitChange(files: string[], message: string): Promise<boolean> {
  const repo = get().repo;
  if (!repo) return false;
  const r = await guard(api.gitCommit({ repo, ...gitScope(), files, message }));
  await loadGit();
  if (!r) return false;
  toast(`Committed ${r.files} file${r.files === 1 ? '' : 's'} (${r.commit})`);
  return true;
}

export async function openChange(name: string, file?: string) {
  const c = get().changes.find((x) => x.name === name);
  set({ browse: null, change: name, file: file ?? c?.files[0] ?? null, content: '', focusComment: null });
  await Promise.all([reloadFile(), loadReview(), loadGit()]);
}

export async function openFile(file: string) {
  set({ file, focusComment: null });
  await reloadFile();
}

/** Path (relative to <repo>/openspec) of the document shown in the middle pane, if any. */
function docPath(): string | null {
  const { change, file, browse } = get();
  if (browse?.kind === 'spec') return browse.file;
  if (browse?.kind === 'archived') return browse.file === HISTORY_TAB ? null : `changes/archive/${browse.name}/${browse.file}`;
  if (!change || !file || file === '__changes__') return null;
  return `changes/${change}/${file}`;
}

async function reloadFile() {
  const { repo } = get();
  const path = docPath();
  if (!repo || !path) return;
  const r = await api.file(repo, path).catch(() => null);
  if (get().repo === repo && docPath() === path) set({ content: r?.content ?? '' });
}

/** Open an archived change, read-only: its artifacts and its review history. */
export async function openArchived(name: string) {
  const repo = get().repo;
  if (!repo) return;
  const data = await guard(api.archived(repo, name));
  if (!data || get().repo !== repo) return;
  set({ browse: { kind: 'archived', name, file: data.files[0] ?? HISTORY_TAB, data }, change: null, file: null, content: '', comments: [], rounds: [], focusComment: null });
  await Promise.all([reloadFile(), loadGit()]);
}

/** Switch the tab of an open archived change. */
export async function openArchivedFile(file: string) {
  const { browse } = get();
  if (browse?.kind !== 'archived') return;
  set({ browse: { ...browse, file }, content: '' });
  await reloadFile();
}

/** Keep (or stop keeping) this repo's review history in the repo. */
export async function setReviewInRepo(on: boolean) {
  const repo = get().repo;
  if (!repo) return;
  const r = await guard(api.settings(repo, on));
  if (!r) return;
  set({ reviewInRepo: r.reviewInRepo });
  toast(r.reviewInRepo ? 'Review history is now kept in each change folder (.studio-review.json). Commit it to share it.' : 'Review history stays in Studio only.');
}

/** Open a main spec, read-only. */
export async function openSpec(name: string) {
  set({ browse: { kind: 'spec', name, file: `specs/${name}/spec.md` }, change: null, file: null, content: '', comments: [], rounds: [], focusComment: null });
  await reloadFile();
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
