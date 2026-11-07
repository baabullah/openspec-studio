import fs from 'node:fs';
import path from 'node:path';
import { runCmd } from './proc.ts';
import type { ArtifactStatus, OptionalWorkflow, ChangeStage, ChangeSummary, ChangeValidation, ReviewComment, SpecSummary, StaleArtifact } from '../../shared/protocol.ts';

const OPENSPEC = process.env.OPENSPEC_BIN || 'openspec';
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

// FORCE_COLOR (set by some shells / npm) overrides NO_COLOR and makes node print a
// warning on stderr; drop it so output stays plain. Telemetry is off by default for
// these calls: the studio runs the CLI on every refresh, and behind a proxy each call
// waits ~10s for the telemetry request to time out. An explicit setting wins.
const cliEnv = () => {
  const { FORCE_COLOR: _f, ...env } = process.env;
  return { ...env, NO_COLOR: '1', OPENSPEC_TELEMETRY: process.env.OPENSPEC_TELEMETRY ?? '0' };
};

export function run(args: string[], cwd: string, timeout = 60_000): Promise<{ ok: boolean; out: string; stdout: string; stderr: string }> {
  return runCmd(OPENSPEC, args, { cwd, timeout, env: cliEnv() }).then((r) => {
    const stdout = stripAnsi(r.stdout), stderr = stripAnsi(r.stderr);
    return { ok: r.ok, out: stdout + stderr, stdout, stderr };
  });
}

async function runJson<T>(args: string[], cwd: string): Promise<T | null> {
  const { stdout, stderr } = await run([...args, '--json'], cwd);
  // openspec may exit non-zero with valid JSON (e.g. root: null). Parse stdout only:
  // stderr can carry unrelated warnings that would corrupt the JSON.
  const start = stdout.search(/[[{]/);
  if (start >= 0) {
    try { return JSON.parse(stdout.slice(start)) as T; } catch { /* fall through */ }
  }
  console.warn(`openspec ${args.join(' ')} --json: unparseable output`, (stdout + stderr).slice(0, 500));
  return null;
}

export function init(repoAbs: string, tool: string) {
  return run(['init', '--tools', tool, '--no-animation', repoAbs], repoAbs, 120_000);
}

const walkMd = (dir: string, base = dir): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walkMd(full, base);
    return e.name.endsWith('.md') ? [path.relative(base, full).split(path.sep).join('/')] : [];
  });

const ORDER = ['proposal.md', 'design.md', 'tasks.md'];
const fileOrder = (f: string) => { const i = ORDER.indexOf(f); return i < 0 ? (f.startsWith('specs/') ? 1.5 : 9) : i; };

/** Spec documents are small; refuse to load anything bigger into memory / the db / the browser. */
export const MAX_DOC_BYTES = Number(process.env.MAX_DOC_BYTES || 2 * 1024 * 1024);

/** Read a document, or null when it is larger than MAX_DOC_BYTES. */
export function readDoc(file: string): string | null {
  return fs.statSync(file).size > MAX_DOC_BYTES ? null : fs.readFileSync(file, 'utf8');
}

export const changeDir = (repoAbs: string, change: string) => path.join(repoAbs, 'openspec', 'changes', change);

export function changeFiles(repoAbs: string, change: string): string[] {
  const dir = changeDir(repoAbs, change);
  if (!fs.existsSync(dir)) return [];
  return walkMd(dir).sort((a, b) => fileOrder(a) - fileOrder(b) || a.localeCompare(b));
}

/**
 * Stage is our own notion, mapped to the next button the UI offers:
 *  draft    → planning artifacts still missing (agent is proposing)
 *  review   → planning complete, or user comments still open
 *  ready    → reviewed (no open comments), nothing implemented yet
 *  applying → some tasks done
 *  done     → all tasks done → sync / archive
 */
function stageOf(c: { isPlanningComplete: boolean; completedTasks: number; totalTasks: number }, open: number, reviewed: boolean): ChangeStage {
  if (c.totalTasks > 0 && c.completedTasks >= c.totalTasks) return 'done';
  if (c.completedTasks > 0) return 'applying';
  if (!c.isPlanningComplete) return 'draft';
  if (open > 0 || !reviewed) return 'review';
  return 'ready';
}

interface ListJson { changes?: { name: string; completedTasks: number; totalTasks: number; lastModified: string; status: string }[] }
interface StatusJson { changeName: string; artifacts: ArtifactStatus[]; isPlanningComplete: boolean; isComplete: boolean }

/**
 * Fingerprint of everything under <repo>/openspec (path, size, mtime of every
 * entry). Cheap next to running the CLI, which takes seconds on some setups.
 */
export function openspecSignature(repoAbs: string): string {
  const parts: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, e.name);
      try {
        const st = fs.statSync(full);
        parts.push(`${full}|${st.size}|${st.mtimeMs}`);
        if (st.isDirectory()) walk(full);
      } catch { /* vanished meanwhile */ }
    }
  };
  walk(path.join(repoAbs, 'openspec'));
  return parts.join('\n');
}

// The CLI's view of a repo only changes when files under openspec/ do. Review
// comments are not files, so resolving one (which refreshes the change list)
// must not wait for two CLI runs again.
interface ValidateJson { items?: { id: string; type: string; valid: boolean; issues?: ChangeValidation['issues'] }[] }
const cliCache = new Map<string, { sig: string; list: ListJson; status: { changes?: StatusJson[] }; validate: ValidateJson | null }>();

async function cliView(repoAbs: string) {
  const sig = openspecSignature(repoAbs);
  const hit = cliCache.get(repoAbs);
  if (hit?.sig === sig) return hit;
  const [list, status, validate] = await Promise.all([
    runJson<ListJson>(['list'], repoAbs),
    runJson<{ changes?: StatusJson[] }>(['status', '--all'], repoAbs),
    // exits non-zero when something is invalid; runJson still parses the report
    runJson<ValidateJson>(['validate', '--changes', '--no-interactive'], repoAbs),
  ]);
  // only keep complete answers; a failed run is retried next time. The files may
  // have changed while the CLI ran, so key it by the signature taken before.
  // (validation is a bonus: without it the change list still works)
  if (list && status) cliCache.set(repoAbs, { sig, list, status, validate });
  return { list, status, validate };
}

// A checkout or copy writes files in a burst; edits within this window count as one generation.
const SAME_GENERATION_MS = 1000;

/**
 * Artifacts that may be out of date, from OpenSpec's own dependency graph
 * (`requires` in `openspec status`): one is stale when something it requires
 * was modified after it, or is itself stale. `because` names the direct causes.
 */
export function computeStaleness(artifacts: Pick<ArtifactStatus, 'id' | 'requires'>[], mtimeOf: (id: string) => number | null): StaleArtifact[] {
  const byId = new Map(artifacts.map((a) => [a.id, a]));
  const memo = new Map<string, string[] | null>();
  const causes = (id: string, seen = new Set<string>()): string[] | null => {
    if (memo.has(id)) return memo.get(id)!;
    const a = byId.get(id);
    const own = mtimeOf(id);
    if (!a || own === null || seen.has(id)) return null;
    seen.add(id);
    const out = a.requires.filter((r) => {
      const up = mtimeOf(r);
      return (up !== null && up - own > SAME_GENERATION_MS) || causes(r, seen) !== null;
    });
    const res = out.length ? out : null;
    memo.set(id, res);
    return res;
  };
  return artifacts.flatMap((a) => { const because = causes(a.id); return because ? [{ id: a.id, because }] : []; });
}

/** Newest mtime of the files an artifact's outputPath covers (e.g. "specs/**\/*.md"), or null when none exist. */
function artifactMtime(repoAbs: string, change: string, files: string[], outputPath: string): number | null {
  const star = outputPath.indexOf('*');
  const matching = star < 0 ? files.filter((f) => f === outputPath) : files.filter((f) => f.startsWith(outputPath.slice(0, star)));
  let newest: number | null = null;
  for (const f of matching) {
    try { newest = Math.max(newest ?? 0, fs.statSync(path.join(changeDir(repoAbs, change), f)).mtimeMs); } catch { /* vanished */ }
  }
  return newest;
}

/** First unchecked "- [ ] …" item in tasks.md, without its markdown. */
export function nextTask(tasksMd: string): string | null {
  const m = tasksMd.match(/^\s*[-*]\s+\[ \]\s+(.+)$/m);
  return m ? m[1].replace(/`/g, '').replace(/\*\*/g, '').trim().slice(0, 200) : null;
}

export async function listChanges(repoAbs: string, commentsFor: (change: string) => ReviewComment[]): Promise<ChangeSummary[]> {
  if (!fs.existsSync(path.join(repoAbs, 'openspec', 'changes'))) return [];
  const { list, status, validate } = await cliView(repoAbs);
  const validation = new Map((validate?.items ?? []).filter((v) => v.type === 'change').map((v) => [v.id, { valid: v.valid, issues: v.issues ?? [] }]));
  const byName = new Map((status?.changes ?? []).map((s) => [s.changeName, s]));
  return (list?.changes ?? []).map((c) => {
    const st = byName.get(c.name);
    const cs = commentsFor(c.name);
    const open = cs.filter((x) => x.status !== 'resolved').length;
    const reviewed = cs.length > 0 && open === 0;
    const base = { ...c, artifacts: st?.artifacts ?? [], isPlanningComplete: st?.isPlanningComplete ?? false, isComplete: st?.isComplete ?? false };
    const files = changeFiles(repoAbs, c.name);
    const done = base.artifacts.filter((a) => a.status === 'done');
    const out = new Map(done.map((a) => [a.id, a.outputPath]));
    const stale = computeStaleness(done, (id) => (out.has(id) ? artifactMtime(repoAbs, c.name, files, out.get(id)!) : null));
    const tasksFile = path.join(changeDir(repoAbs, c.name), 'tasks.md');
    const next = files.includes('tasks.md') ? nextTask(readDoc(tasksFile) ?? '') : null;
    return { ...base, files, openComments: open, stage: stageOf(base, open, reviewed), validation: validation.get(c.name) ?? null, stale, nextTask: next };
  });
}

/** Main specs (openspec/specs/<capability>/spec.md), with their requirement count. */
export function listSpecs(repoAbs: string): SpecSummary[] {
  const dir = path.join(repoAbs, 'openspec', 'specs');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'spec.md')))
    .map((e) => {
      const text = readDoc(path.join(dir, e.name, 'spec.md')) ?? '';
      return { name: e.name, file: `specs/${e.name}/spec.md`, requirements: (text.match(/^#{3,4}\s+Requirement:/gm) ?? []).length };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const archivedDir = (repoAbs: string, name: string) => path.join(repoAbs, 'openspec', 'changes', 'archive', name);

/** `openspec archive` prefixes the folder with the date: 2026-11-06-add-notes → add-notes. */
export const archivedChangeName = (name: string) => name.replace(/^\d{4}-\d{2}-\d{2}-/, '');

export function archivedFiles(repoAbs: string, name: string): string[] {
  const dir = archivedDir(repoAbs, name);
  if (!fs.existsSync(dir)) return [];
  return walkMd(dir).sort((a, b) => fileOrder(a) - fileOrder(b) || a.localeCompare(b));
}

// What `openspec init/update` writes for an optional workflow, per tool: a command
// (e.g. .claude/commands/opsx/verify.md) and/or a skill folder (…/skills/openspec-verify-change/).
const OPTIONAL: Record<OptionalWorkflow, { command: string; skill: string }> = {
  verify: { command: 'verify.md', skill: 'openspec-verify-change' },
};

/**
 * Optional workflows installed in the repo for any tool. They are enabled
 * globally with `openspec config profile`, then written by `openspec update`.
 */
export function installedWorkflows(repoAbs: string): OptionalWorkflow[] {
  const found = new Set<OptionalWorkflow>();
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      for (const [id, w] of Object.entries(OPTIONAL) as [OptionalWorkflow, (typeof OPTIONAL)[OptionalWorkflow]][]) {
        if ((e.isDirectory() && e.name === w.skill) || (e.isFile() && e.name === w.command && path.basename(dir) === 'opsx')) found.add(id);
      }
      if (e.isDirectory() && e.name !== 'node_modules') walk(path.join(dir, e.name), depth + 1);
    }
  };
  // tool folders live at the repo root and start with a dot (.claude, .codex, .codebuddy, .agents, …)
  let top: fs.Dirent[] = [];
  try { top = fs.readdirSync(repoAbs, { withFileTypes: true }); } catch { /* unreadable */ }
  for (const e of top) if (e.isDirectory() && e.name.startsWith('.') && e.name !== '.git') walk(path.join(repoAbs, e.name), 1);
  return [...found];
}

export async function listArchived(repoAbs: string): Promise<string[]> {
  const dir = path.join(repoAbs, 'openspec', 'changes', 'archive');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse();
}
