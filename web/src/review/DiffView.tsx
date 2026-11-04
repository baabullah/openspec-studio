import { useMemo, useState } from 'react';
import { diffLines, diffWordsWithSpace } from 'diff';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { FileDiff } from '../../../shared/protocol.ts';
import { cx } from '../lib/ui.tsx';

type Row = { t: 'same' | 'add' | 'del'; text: string; pair?: string } | { t: 'gap'; n: number };

const CONTEXT = 3;

function rows(before: string, after: string): Row[] {
  const parts = diffLines(before, after);
  const flat: Row[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const lines = p.value.replace(/\n$/, '').split('\n');
    const t = p.added ? 'add' : p.removed ? 'del' : 'same';
    // pair a removed block with the added block that follows, for word-level highlight
    const other = p.removed ? (parts[i + 1]?.added ? parts[i + 1] : null) : p.added ? (parts[i - 1]?.removed ? parts[i - 1] : null) : null;
    const pairLines = other ? other.value.replace(/\n$/, '').split('\n') : null;
    lines.forEach((text, j) => flat.push({ t, text, pair: pairLines?.[j] }));
  }
  // collapse long unchanged runs
  const out: Row[] = [];
  for (let i = 0; i < flat.length;) {
    if (flat[i].t !== 'same') { out.push(flat[i++]); continue; }
    let j = i; while (j < flat.length && flat[j].t === 'same') j++;
    const run = flat.slice(i, j);
    const head = i === 0 ? 0 : CONTEXT, tail = j === flat.length ? 0 : CONTEXT;
    if (run.length > head + tail + 2) out.push(...run.slice(0, head), { t: 'gap', n: run.length - head - tail }, ...run.slice(run.length - tail));
    else out.push(...run);
    i = j;
  }
  return out;
}

function Words({ a, b, side }: { a: string; b: string; side: 'add' | 'del' }) {
  const parts = diffWordsWithSpace(a, b);
  return <>{parts.map((p, i) => {
    if (side === 'del' && p.added) return null;
    if (side === 'add' && p.removed) return null;
    const hl = (side === 'del' && p.removed) || (side === 'add' && p.added);
    return <span key={i} className={hl ? (side === 'add' ? 'rounded-sm bg-ok/25' : 'rounded-sm bg-bad/25') : ''}>{p.value}</span>;
  })}</>;
}

export function DiffBody({ before, after, max = 4000 }: { before: string; after: string; max?: number }) {
  const rs = useMemo(() => rows(before, after).slice(0, max), [before, after, max]);
  return (
    <div className="overflow-x-auto font-mono text-[12px] leading-[1.6]">
      {rs.map((r, i) => {
        if (r.t === 'gap') return <div key={i} className="select-none px-3 py-0.5 text-[11px] text-muted bg-surface-2">⋯ {r.n} unchanged lines</div>;
        const sign = r.t === 'add' ? '+' : r.t === 'del' ? '−' : ' ';
        return (
          <div key={i} className={cx('flex whitespace-pre-wrap break-words px-1', r.t === 'add' && 'bg-[var(--diff-add)]', r.t === 'del' && 'bg-[var(--diff-del)]')}>
            <span className={cx('w-5 shrink-0 select-none text-center', r.t === 'add' ? 'text-ok' : r.t === 'del' ? 'text-bad' : 'text-muted')}>{sign}</span>
            <span className="min-w-0 flex-1">
              {r.t === 'del' && r.pair !== undefined ? <Words a={r.text} b={r.pair} side="del" />
                : r.t === 'add' && r.pair !== undefined ? <Words a={r.pair} b={r.text} side="add" />
                : r.text || ' '}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function MiniDiff({ path, before, after }: { path?: string; before: string; after: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      {path && <div className="truncate border-b border-line bg-surface-2 px-2 py-1 font-mono text-[11px] text-muted">{path}</div>}
      <div className="max-h-64 overflow-auto"><DiffBody before={before} after={after} max={400} /></div>
    </div>
  );
}

export function FileDiffCard({ d, defaultOpen = true }: { d: FileDiff; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const stats = useMemo(() => {
    let add = 0, del = 0;
    for (const p of diffLines(d.before, d.after)) { if (p.added) add += p.count ?? 0; if (p.removed) del += p.count ?? 0; }
    return { add, del };
  }, [d]);
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 border-b border-line bg-surface-2 px-3 py-2 text-left">
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="flex-1 font-mono text-[12.5px]">{d.file}</span>
        {!d.before && <span className="text-[11px] text-ok">new file</span>}
        {!d.after && <span className="text-[11px] text-bad">deleted</span>}
        <span className="text-[11.5px] text-ok">+{stats.add}</span>
        <span className="text-[11.5px] text-bad">−{stats.del}</span>
      </button>
      {open && <DiffBody before={d.before} after={d.after} />}
    </div>
  );
}
