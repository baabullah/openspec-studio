import { useState } from 'react';
import { ChevronDown, ChevronRight, CircleCheck, CircleX, FileEdit, LoaderCircle, Terminal } from 'lucide-react';
import type { TurnWork } from './transcript.ts';
import { useStore } from '../store.ts';
import { cx } from '../lib/ui.tsx';

/** Agent tools report absolute paths, Studio's own file writes relative ones: show both relative to the repo. */
export function relativeTo(repo: string | null, p: string): string {
  if (!repo) return p;
  const norm = (s: string) => s.replace(/\\/g, '/');
  const r = norm(repo).replace(/\/$/, '');
  const f = norm(p);
  return f.toLowerCase().startsWith(`${r.toLowerCase()}/`) ? f.slice(r.length + 1) : f;
}

/**
 * What a turn did according to its tool calls: commands with their outcome and
 * the files it changed. Facts the agent's tools reported, not the agent's summary.
 */
export function TurnWorkLine({ work }: { work: TurnWork }) {
  const repo = useStore((s) => s.repo);
  const [open, setOpen] = useState(false);
  const files = [...new Set(work.files.map((f) => relativeTo(repo, f)))];
  const failed = work.commands.filter((c) => c.status === 'failed').length;
  if (!work.commands.length && !files.length) return null;
  const parts = [
    work.commands.length && `ran ${work.commands.length} command${work.commands.length > 1 ? 's' : ''}`,
    failed && `${failed} failed`,
    files.length && `changed ${files.length} file${files.length > 1 ? 's' : ''}`,
  ].filter(Boolean);
  return (
    <div className="text-[11px] text-muted">
      <button type="button" onClick={() => setOpen(!open)} className="mx-auto flex items-center gap-1 hover:text-fg-2"
        title="From the agent's tool calls: what actually ran, and what was edited">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {parts.map((p, i) => <span key={p as string} className={cx(p === `${failed} failed` && 'font-medium text-bad')}>{i > 0 && '· '}{p}</span>)}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1 rounded-lg border border-line bg-bg px-2.5 py-2">
          {work.commands.map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the same command can run twice
            <div key={i} className="flex items-start gap-1.5">
              {c.status === 'failed' ? <CircleX size={12} className="mt-0.5 shrink-0 text-bad" />
                : c.status === 'completed' ? <CircleCheck size={12} className="mt-0.5 shrink-0 text-ok" />
                  : <LoaderCircle size={12} className="mt-0.5 shrink-0" />}
              <Terminal size={12} className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-all font-mono text-fg-2">{c.title}</span>
            </div>
          ))}
          {files.map((f) => (
            <div key={f} className="flex items-center gap-1.5">
              <FileEdit size={12} className="shrink-0" />
              <span className="min-w-0 break-all font-mono text-fg-2">{f}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
