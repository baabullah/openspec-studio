import { Archive, Bot, History } from 'lucide-react';
import type { ArchivedChange, ReviewComment, ReviewRound } from '../../../shared/protocol.ts';
import { HISTORY_TAB, openArchivedFile, useStore } from '../store.ts';
import { Badge } from '../lib/ui.tsx';
import { kindOf, STATUS_META } from '../review/kinds.tsx';
import { FileDiffCard } from '../review/DiffView.tsx';
import { ReadOnlyDoc } from './ReadOnlyDoc.tsx';
import { CommitButton } from './GitActions.tsx';

const tabLabel = (f: string) => f.replace(/\.md$/, '').replace(/^specs\//, 'spec: ').replace(/\/spec$/, '');
const archivedOn = (name: string) => name.match(/^(\d{4}-\d{2}-\d{2})-/)?.[1] ?? null;

/** An archived change: its artifacts as they were archived, and the review history Studio kept. */
export function ArchivedView({ name, file, data }: { name: string; file: string; data: ArchivedChange }) {
  const content = useStore((s) => s.content);
  const date = archivedOn(name);
  const historyCount = data.rounds.length + data.comments.length;
  const tabs = [
    ...data.files.map((f) => ({ id: f, label: tabLabel(f) })),
    { id: HISTORY_TAB, label: <><History size={13} /> History{historyCount > 0 && <span className="text-[10.5px] text-muted">{data.rounds.length} round{data.rounds.length === 1 ? '' : 's'}</span>}</> },
  ];
  return (
    <ReadOnlyDoc title={data.change} tabs={tabs} tab={file} onTab={openArchivedFile} content={content}
      badges={<><Badge><Archive size={12} /> archived{date ? ` ${date}` : ''}</Badge><span className="truncate font-mono text-[11.5px] text-muted" title={`openspec/changes/archive/${name}`}>{name}</span>
        <CommitButton key={name} what={`the archive of ${data.change}`} defaultMessage={`Archive ${data.change}: move it to the archive and update the main specs`} /></>}>
      {file === HISTORY_TAB ? <HistoryView data={data} /> : undefined}
    </ReadOnlyDoc>
  );
}

function HistoryView({ data }: { data: ArchivedChange }) {
  if (data.historyHidden) {
    return <Note>A new active change is also called <b className="font-mono">{data.change}</b>; Studio keeps review history by name, so it is shown with that change.</Note>;
  }
  if (!data.rounds.length && !data.comments.length) {
    return <Note>Studio has no review history for this change: it was reviewed without Studio, or before Studio was used on this repo.</Note>;
  }
  const rounds = [...data.rounds].sort((a, b) => a.createdAt.localeCompare(b.createdAt)); // oldest = round 1
  const byId = new Map(data.comments.map((c) => [c.id, c]));
  const inRounds = new Set(rounds.flatMap((r) => r.commentIds));
  const others = data.comments.filter((c) => !inRounds.has(c.id));
  return (
    <div className="mx-auto max-w-[980px] space-y-8 px-8 py-6">
      {[...rounds].reverse().map((r) => (
        <RoundView key={r.id} r={r} n={rounds.indexOf(r) + 1} comments={r.commentIds.map((id) => byId.get(id)).filter((c): c is ReviewComment => !!c)} />
      ))}
      {others.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-[15px] font-semibold">Comments not sent in a round</h3>
          {others.map((c) => <CommentSummary key={c.id} c={c} />)}
        </section>
      )}
    </div>
  );
}

function RoundView({ r, n, comments }: { r: ReviewRound; n: number; comments: ReviewComment[] }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-semibold">Round {n}</h3>
        <span className="text-xs text-muted">{new Date(r.createdAt).toLocaleString()}</span>
        {r.status === 'done' && !r.resultParsed && <Badge tone="warn">agent sent no report</Badge>}
        {r.stopReason && r.stopReason !== 'end_turn' && <Badge tone="bad">{r.stopReason}</Badge>}
      </div>
      <div className="space-y-2">{comments.map((c) => <CommentSummary key={c.id} c={c} />)}</div>
      {r.diffs.length
        ? r.diffs.map((d) => <FileDiffCard key={d.file} d={d} defaultOpen={false} />)
        : <div className="rounded-xl border border-dashed border-line p-3 text-center text-xs text-muted">No files changed in this round.</div>}
    </section>
  );
}

/** One comment as a static card: kind, verdict, where, quote, note and the agent's reply. */
function CommentSummary({ c }: { c: ReviewComment }) {
  const k = kindOf(c.kind);
  const st = STATUS_META[c.status];
  return (
    <div className="rounded-xl border border-line bg-surface p-2.5 text-[12.5px]">
      <div className="flex items-center gap-1.5">
        <k.icon size={13} className={k.tone} />
        <span className="font-medium">{k.short}</span>
        <span className="truncate font-mono text-[11px] text-muted">{c.file ? tabLabel(c.file) : 'whole change'}</span>
        <Badge tone={st.tone} className="ml-auto">{st.label}</Badge>
      </div>
      {c.anchor && <div className="mt-1.5 line-clamp-2 border-l-2 border-line-strong pl-2 text-[11.5px] italic text-muted">{c.anchor.exact}</div>}
      {c.body && <div className="mt-1.5 whitespace-pre-wrap break-words">{c.body}</div>}
      {c.agentNote && (
        <div className="mt-2 flex gap-1.5 rounded-lg bg-surface-2 px-2 py-1.5 text-[12px] text-fg-2">
          <Bot size={13} className="mt-0.5 shrink-0 text-accent" /><span>{c.agentNote}</span>
        </div>
      )}
    </div>
  );
}

const Note = ({ children }: { children: React.ReactNode }) => (
  <div className="mx-auto max-w-[640px] px-8 py-10 text-center text-[13px] text-muted">{children}</div>
);
