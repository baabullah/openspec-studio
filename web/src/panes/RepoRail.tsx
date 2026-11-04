import { useMemo, useState } from 'react';
import {
  Archive, Check, ChevronDown, ChevronRight, Compass, FolderGit2, GitMerge, MessageSquare, MoreHorizontal, Pencil, Play,
  Plus, RefreshCw, Search, Sparkles, Eye,
} from 'lucide-react';
import type { ChangeStage, ChangeSummary } from '../../../shared/protocol.ts';
import { loadRepos, openChange, runAction, selectRepo, useStore } from '../store.ts';
import { Badge, Button, Chip, cx, Dialog, IconButton, Menu, MenuItem, timeAgo, useDismiss } from '../lib/ui.tsx';

const STAGES: { id: ChangeStage; label: string; hint: string }[] = [
  { id: 'draft', label: 'Drafting', hint: 'Planning artifacts in progress' },
  { id: 'review', label: 'In review', hint: 'Read and comment' },
  { id: 'ready', label: 'Ready to build', hint: 'Reviewed, not implemented' },
  { id: 'applying', label: 'Building', hint: 'Tasks in progress' },
  { id: 'done', label: 'Done', hint: 'Sync specs and archive' },
];

function RepoPicker() {
  const { repos, repo, root } = useStore();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const list = repos.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()));
  const cur = repos.find((r) => r.name === repo);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2 text-left shadow-sm hover:border-line-strong">
        <FolderGit2 size={17} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] text-muted">Repository</span>
          <span className="block truncate text-[13.5px] font-semibold">{cur?.name.split('/').pop() ?? 'Choose a repo'}</span>
        </span>
        <ChevronDown size={15} className="text-muted" />
      </button>
      {open && (
        <div className="absolute inset-x-0 z-40 mt-1 rounded-xl border border-line bg-surface shadow-pop">
          <div className="flex items-center gap-2 border-b border-line px-2.5 py-2">
            <Search size={14} className="text-muted" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className="flex-1 bg-transparent text-[13px] outline-none" />
            <IconButton title="Rescan folders" onClick={() => loadRepos(true)}><RefreshCw size={13} /></IconButton>
          </div>
          <div className="max-h-80 overflow-y-auto p-1">
            {list.map((r) => (
              <button key={r.name} onClick={() => { selectRepo(r.name); setOpen(false); setQ(''); }}
                className={cx('flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-2', r.name === repo && 'bg-accent-soft')}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{r.name.split('/').pop()}</span>
                  {r.name.includes('/') && <span className="block truncate text-[11px] text-muted">{r.name}</span>}
                </span>
                {r.session && <span className="h-2 w-2 rounded-full bg-ok" title="agent connected" />}
                {r.openspec ? <Badge tone="accent">OpenSpec</Badge> : <span className="text-[11px] text-muted">not set up</span>}
              </button>
            ))}
            {!list.length && <div className="px-3 py-4 text-center text-xs text-muted">No repos found under {root}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

const ART_LABEL: Record<string, string> = { proposal: 'Proposal', specs: 'Specs', design: 'Design', tasks: 'Tasks' };

/** Planning artifacts as labeled chips, so they don't read as a progress bar. */
function ArtifactChips({ c }: { c: ChangeSummary }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {c.artifacts.map((a) => {
        const done = a.status === 'done';
        return (
          <span key={a.id} title={`${ART_LABEL[a.id] ?? a.id}: ${done ? 'written' : a.status === 'ready' ? 'not written yet' : 'blocked'}`}
            className={cx('inline-flex items-center gap-0.5 rounded-md px-1.5 py-px text-[10.5px] font-medium',
              done ? 'bg-ok-soft text-ok' : 'bg-surface-2 text-muted')}>
            {done ? <Check size={10} strokeWidth={3} /> : <span className="h-1.5 w-1.5 rounded-full border border-current" />}
            {ART_LABEL[a.id] ?? a.id}
          </span>
        );
      })}
    </div>
  );
}

function primaryAction(c: ChangeSummary): { label: string; icon: typeof Play; run: () => void } {
  switch (c.stage) {
    case 'draft': return { label: 'Continue', icon: Pencil, run: () => runAction('update', c.name, 'Continue creating the missing planning artifacts.') };
    case 'review': return { label: 'Review', icon: Eye, run: () => openChange(c.name) };
    case 'ready': return { label: 'Build it', icon: Play, run: () => runAction('apply', c.name) };
    case 'applying': return { label: 'Continue', icon: Play, run: () => runAction('apply', c.name) };
    case 'done': return { label: 'Archive', icon: Archive, run: () => confirmArchive(c.name) };
  }
}

let confirmArchive: (name: string) => void = () => {};

function ChangeCard({ c }: { c: ChangeSummary }) {
  const active = useStore((s) => s.change === c.name);
  const busy = useStore((s) => s.session?.status === 'busy');
  const p = primaryAction(c);
  const pct = c.totalTasks ? Math.round((c.completedTasks / c.totalTasks) * 100) : 0;
  return (
    <div onClick={() => openChange(c.name)}
      className={cx('group cursor-pointer rounded-xl border bg-surface p-2.5 transition hover:shadow-sm', active ? 'border-accent ring-2 ring-accent/15' : 'border-line hover:border-line-strong')}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold" title={c.name}>{c.name}</div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
            <span>{timeAgo(c.lastModified)}</span>
            {c.openComments > 0 && <span className="flex items-center gap-0.5 text-warn"><MessageSquare size={11} /> {c.openComments}</span>}
          </div>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <Menu align="right" trigger={(t) => <IconButton title="More actions" onClick={t} className="opacity-60 group-hover:opacity-100"><MoreHorizontal size={15} /></IconButton>}>
            {(close) => <>
              <MenuItem icon={<Eye />} onClick={() => { openChange(c.name); close(); }}>Open for review</MenuItem>
              <MenuItem icon={<Compass />} disabled={busy} onClick={() => { runAction('explore', undefined, `the change "${c.name}"`); close(); }}>Explore with agent</MenuItem>
              <MenuItem icon={<Sparkles />} disabled={busy} onClick={() => { runAction('update', c.name); close(); }}>Check coherence</MenuItem>
              <MenuItem icon={<Play />} disabled={busy} onClick={() => { runAction('apply', c.name); close(); }}>Build (apply)</MenuItem>
              <MenuItem icon={<GitMerge />} disabled={busy} onClick={() => { runAction('sync', c.name); close(); }}>Sync specs</MenuItem>
              <MenuItem icon={<Archive />} danger disabled={busy} onClick={() => { confirmArchive(c.name); close(); }}>Archive…</MenuItem>
            </>}
          </Menu>
        </div>
      </div>
      <div className="mt-2"><ArtifactChips c={c} /></div>
      {c.totalTasks > 0 && (
        <div className="mt-2 flex items-center gap-2" title="Implementation tasks done (tasks.md checkboxes)">
          <span className="text-[10.5px] font-medium text-muted">Build</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>
          <span className="text-[10.5px] tabular-nums text-muted">{c.completedTasks}/{c.totalTasks} tasks</span>
        </div>
      )}
      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant={c.stage === 'review' ? 'secondary' : 'primary'} className="w-full" disabled={busy && c.stage !== 'review'} onClick={p.run}>
          <p.icon size={13} /> {p.label}
        </Button>
      </div>
    </div>
  );
}

const IDEAS = ['Add a feature: ', 'Fix a bug: ', 'Refactor ', 'Improve performance of ', 'Add tests for '];

function NewChangeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState('');
  const [explore, setExplore] = useState(false);
  const go = () => {
    if (!text.trim() && !explore) return;
    runAction(explore ? 'explore' : 'propose', undefined, text.trim());
    setText(''); onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} title="New change"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!text.trim() && !explore} onClick={go}>{explore ? <><Compass size={14} /> Explore</> : <><Sparkles size={14} /> Propose</>}</Button>
      </>}>
      <div className="mb-2 flex gap-1.5">
        <Chip active={!explore} onClick={() => setExplore(false)}>Propose: agent drafts proposal, specs, design, tasks</Chip>
        <Chip active={explore} onClick={() => setExplore(true)}>Explore first: think it through together</Chip>
      </div>
      <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={3}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) go(); }}
        placeholder={explore ? 'What do you want to explore? (optional)' : 'What should change? One sentence is enough.'}
        className="w-full resize-none rounded-xl border border-line bg-bg px-3 py-2 text-[13.5px] outline-none focus:border-accent" />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {IDEAS.map((i) => <Chip key={i} onClick={() => setText((t) => (t ? t : i))}>{i.trim()}</Chip>)}
      </div>
    </Dialog>
  );
}

function ArchiveDialog({ name, onClose }: { name: string | null; onClose: () => void }) {
  return (
    <Dialog open={!!name} onClose={onClose} title="Archive change"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => { runAction('archive', name!); onClose(); }}><Archive size={14} /> Archive</Button>
      </>}>
      <p className="text-[13.5px] text-fg-2">
        The agent checks that <b className="text-fg">{name}</b> is complete, merges its delta specs into the main specs, and moves it to
        <code className="mx-1 rounded bg-surface-2 px-1 font-mono text-xs">openspec/changes/archive/</code>.
      </p>
    </Dialog>
  );
}

export function RepoRail() {
  const { changes, archived, repo, repos, changesLoaded } = useStore();
  const [newOpen, setNewOpen] = useState(false);
  const [archiveName, setArchiveName] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  confirmArchive = setArchiveName;
  const grouped = useMemo(() => STAGES.map((s) => ({ ...s, items: changes.filter((c) => c.stage === s.id) })).filter((g) => g.items.length), [changes]);
  const hasOpenSpec = repos.find((r) => r.name === repo)?.openspec;

  return (
    <nav className="flex h-full min-h-0 flex-col border-r border-line bg-bg">
      <div className="flex items-center gap-2 px-4 pb-2 pt-3.5">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-accent-fg"><Check size={14} strokeWidth={3} /></div>
        <span className="text-[14px] font-bold tracking-tight">OpenSpec Studio</span>
      </div>
      <div className="px-3 pb-3"><RepoPicker /></div>

      {repo && hasOpenSpec && (
        <>
          <div className="px-3 pb-2">
            <Button variant="primary" size="lg" className="w-full" onClick={() => setNewOpen(true)}><Plus size={16} /> New change</Button>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-4 pt-1">
            {!changesLoaded && [0, 1].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl border border-line bg-surface" />)}
            {changesLoaded && !changes.length && <div className="px-2 py-6 text-center text-xs text-muted">No active changes yet.</div>}
            {grouped.map((g) => (
              <section key={g.id}>
                <div className="mb-1.5 flex items-baseline gap-2 px-1">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-fg-2">{g.label}</h3>
                  <span className="text-[11px] text-muted">{g.items.length}</span>
                </div>
                <div className="space-y-2">{g.items.map((c) => <ChangeCard key={c.name} c={c} />)}</div>
              </section>
            ))}
            {archived.length > 0 && (
              <section>
                <button onClick={() => setShowArchived(!showArchived)} className="flex items-center gap-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted hover:text-fg-2">
                  {showArchived ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Archived <span className="font-normal">{archived.length}</span>
                </button>
                {showArchived && (
                  <ul className="mt-1.5 space-y-0.5 px-1">
                    {archived.map((a) => <li key={a} className="truncate font-mono text-[11.5px] text-muted" title={a}>{a}</li>)}
                  </ul>
                )}
              </section>
            )}
          </div>
        </>
      )}
      <NewChangeDialog open={newOpen} onClose={() => setNewOpen(false)} />
      <ArchiveDialog name={archiveName} onClose={() => setArchiveName(null)} />
    </nav>
  );
}
