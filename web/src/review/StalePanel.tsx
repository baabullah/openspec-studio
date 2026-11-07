import { useState } from 'react';
import { History, Sparkles } from 'lucide-react';
import type { ChangeSummary } from '../../../shared/protocol.ts';
import { runAction, useStore } from '../store.ts';
import { Button } from '../lib/ui.tsx';

const NAME: Record<string, string> = { proposal: 'the proposal', specs: 'the specs', design: 'the design', tasks: 'the tasks' };
const name = (id: string) => NAME[id] ?? id;
/** "specs" and "tasks" read as plurals even alone: "the tasks were written". */
const plural = (ids: string[]) => ids.length > 1 || ids[0] === 'specs' || ids[0] === 'tasks';
const list = (ids: string[]) => (ids.length < 2 ? ids.map(name).join('') : `${ids.slice(0, -1).map(name).join(', ')} and ${name(ids.at(-1)!)}`);

/** Which artifact a change tab shows ("specs/x/spec.md" → "specs"). */
export const artifactOfFile = (f: string) => (f.startsWith('specs/') ? 'specs' : f.replace(/\.md$/, ''));

const dismissKey = (repo: string, change: string) => `stale-dismissed:${repo}:${change}`;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

/**
 * Artifacts written before something they depend on changed. Dismissing hides
 * this exact situation; a new edit upstream brings the banner back.
 */
export function StalePanel({ c }: { c: ChangeSummary }) {
  const repo = useStore((s) => s.repo) ?? '';
  const busy = useStore((s) => s.session?.status === 'busy');
  const signature = JSON.stringify(c.stale);
  const [dismissed, setDismissed] = useState(() => read(dismissKey(repo, c.name)));
  if (!c.stale.length || dismissed === signature) return null;
  // the edits that started it: causes that are not stale themselves
  const staleIds = new Set(c.stale.map((s) => s.id));
  const roots = [...new Set(c.stale.flatMap((s) => s.because).filter((b) => !staleIds.has(b)))];
  const targets = c.stale.map((s) => s.id);
  const check = () => runAction('update', c.name,
    `${list(roots)} changed after ${list(targets)} ${plural(targets) ? 'were' : 'was'} written. Check ${list(targets)} against ${list(roots)} and update what no longer matches; change nothing else.`);
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-warn/30 bg-warn-soft px-6 py-2 text-[13px]">
      <History size={15} className="shrink-0 text-warn" />
      <span className="flex-1">
        <b className="font-medium">{list(roots).replace(/^t/, 'T')}</b> changed after {list(targets)} {plural(targets) ? 'were' : 'was'} written; {plural(targets) ? 'they' : 'it'} may be out of date.
      </span>
      <Button size="sm" disabled={busy} onClick={check} title="Ask the agent to bring the later artifacts in line (update workflow)"><Sparkles size={13} /> Check coherence</Button>
      <Button size="sm" variant="ghost" onClick={() => { write(dismissKey(repo, c.name), signature); setDismissed(signature); }} title="Hide until something changes again">Dismiss</Button>
    </div>
  );
}
