import fs from 'node:fs';
import path from 'node:path';
import { runCmd } from './proc.ts';
import type { ArtifactStatus, ChangeStage, ChangeSummary, ChangeValidation, ReviewComment, SpecSummary } from '../../shared/protocol.ts';

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
    return { ...base, files: changeFiles(repoAbs, c.name), openComments: open, stage: stageOf(base, open, reviewed), validation: validation.get(c.name) ?? null };
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

export async function listArchived(repoAbs: string): Promise<string[]> {
  const dir = path.join(repoAbs, 'openspec', 'changes', 'archive');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse();
}
