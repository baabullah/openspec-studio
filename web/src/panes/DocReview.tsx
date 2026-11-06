import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  CheckCheck, FileText, FolderPlus, GitCompareArrows, ListTodo, MessageSquarePlus, Send, Sparkles, Eye, EyeOff, Layers,
  Play, BookOpen,
} from 'lucide-react';
import type { CommentKind, ReviewComment } from '../../../shared/protocol.ts';
import { locate } from '../../../shared/anchor.ts';
import { initRepo, openAddFolder, openFile, review, sendPrompt, setAgent, useStore } from '../store.ts';
import { Badge, Button, cx, Dialog, Spinner } from '../lib/ui.tsx';
import { CommentCard } from '../review/CommentCard.tsx';
import { Composer } from '../review/Composer.tsx';
import { KINDS, STATUS_META, TO_CHECK } from '../review/kinds.tsx';
import { lineHintOf, offsetAtPoint, paint, TextModel } from '../review/textModel.ts';
import { FileDiffCard } from '../review/DiffView.tsx';
import { ReadOnlyDoc } from './ReadOnlyDoc.tsx';
import { ArchivedView } from './ArchivedView.tsx';
import { ValidationPanel } from '../review/ValidationPanel.tsx';
import { artifactOfFile, StalePanel } from '../review/StalePanel.tsx';

const CHANGES_TAB = '__changes__';

// ---- rendered markdown with hover reactions ------------------------------------
function ReactionBar({ onPick }: { onPick: (k: CommentKind, el: HTMLElement) => void }) {
  return (
    <span data-ui contentEditable={false} className="blk-ui select-none" onMouseDown={(e) => e.preventDefault()}>
      <span className="blk-ui-inner">
      {KINDS.map((k) => (
        <button key={k.id} title={k.label} onClick={(e) => { e.stopPropagation(); onPick(k.id, (e.currentTarget.closest('[data-blk]') as HTMLElement)); }}
          className={cx('flex h-6 w-6 items-center justify-center rounded-md hover:bg-surface-2', k.tone)}>
          <k.icon size={13} />
        </button>
      ))}
      </span>
    </span>
  );
}

const DELTA = /^(ADDED|MODIFIED|REMOVED|RENAMED)\b/;
const textOfChildren = (c: ReactNode): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(textOfChildren).join('') : '');

const Doc = memo(function Doc({ content, onReact }: { content: string; onReact: (k: CommentKind, el: HTMLElement) => void }) {
  const components = useMemo<Components>(() => {
    const wrap = (Tag: any) => ({ node, children, ...rest }: any) => (
      <Tag {...rest} data-blk data-line={node?.position?.start.line}
        data-delta={/^h[1-6]$/.test(Tag) ? textOfChildren(children).match(DELTA)?.[1] : undefined}>
        {children}
        <ReactionBar onPick={onReact} />
      </Tag>
    );
    return {
      h1: wrap('h1'), h2: wrap('h2'), h3: wrap('h3'), h4: wrap('h4'), p: wrap('p'), li: wrap('li'), blockquote: wrap('blockquote'),
      pre: ({ node, children, ...rest }: any) => <pre {...rest} data-line={node?.position?.start.line}>{children}</pre>,
      input: ({ node, ...rest }: any) => <input {...rest} disabled />,
    };
  }, [onReact]);
  return <Markdown remarkPlugins={[remarkGfm]} components={components}>{content}</Markdown>;
});

// ---- review canvas ----------------------------------------------------------------
type Draft = { kind: CommentKind; anchor: ReviewComment['anchor']; top: number; left: number };

function ReviewCanvas() {
  const { content, comments, change, file, repo, focusComment } = useStore();
  const [showResolved, setShowResolved] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<TextModel | null>(null);
  const [sel, setSel] = useState<{ start: number; end: number; top: number; left: number; line: number } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [positions, setPositions] = useState<Record<string, { start: number; end: number; top: number; fuzzy: boolean }>>({});
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const [layoutTick, force] = useState(0); // bumped by the ResizeObserver

  const visible = comments.filter((c) => c.file === file && (showResolved || c.status !== 'resolved'));
  const [narrow, setNarrow] = useState(false);
  const anchored = narrow ? [] : visible.filter((c) => c.anchor && positions[c.id]);
  const general = visible.filter((c) => !anchored.includes(c));
  const located = visible.filter((c) => c.anchor && positions[c.id]); // for click-to-focus in both modes
  const changeLevel = comments.filter((c) => c.file === null && (showResolved || c.status !== 'resolved'));
  const resolvedCount = comments.filter((c) => c.file === file && c.status === 'resolved').length;
  // the Notes block sits above the document, so showing/hiding it moves every line
  const notesShown = general.length > 0 || changeLevel.length > 0 || resolvedCount > 0;

  const relTop = useCallback((r: DOMRect) => r.top - wrapRef.current!.getBoundingClientRect().top, []);

  // rebuild the text model and locate comments whenever the rendered doc changes or
  // moves: a resize reflows the text, and on first load the comments sit in Notes
  // (no positions yet) until this runs, so the doc shifts up once they move out
  // biome-ignore lint/correctness/useExhaustiveDependencies: content, layoutTick, notesShown and narrow are triggers: they change where the text is
  useLayoutEffect(() => {
    if (!docRef.current) return;
    const model = new TextModel(docRef.current);
    modelRef.current = model;
    const pos: typeof positions = {};
    const groups: Record<string, Range[]> = { 'c-draft': [], 'c-sent': [], 'c-done': [], 'c-focus': [] };
    for (const c of comments) {
      if (c.file !== file || !c.anchor) continue;
      const hit = locate(model.text, c.anchor, { headingPathAt: (o) => model.headingPath(o), lineAt: (o) => model.lineAt(o) });
      if (!hit) continue;
      const range = model.toRange(hit.start, hit.end);
      if (!range) continue;
      const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
      pos[c.id] = { ...hit, top: relTop(rect) };
      if (c.status === 'resolved' && !showResolved) continue;
      const g = c.id === focusComment ? 'c-focus' : STATUS_META[c.status].hl;
      if (g) groups[g].push(range);
    }
    paint(groups);
    setPositions(pos);
  }, [content, comments, file, focusComment, showResolved, relTop, layoutTick, notesShown, narrow]);

  useEffect(() => () => paint({ 'c-draft': [], 'c-sent': [], 'c-done': [], 'c-focus': [] }), []);

  // re-layout on resize
  useEffect(() => {
    const ro = new ResizeObserver(() => { force((x) => x + 1); setNarrow((wrapRef.current?.clientWidth ?? 1000) < 760); });
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // stack margin cards so they don't overlap (Google Docs style)
  useLayoutEffect(() => {
    const sorted = anchored.map((c) => ({ c, top: positions[c.id].top })).sort((a, b) => a.top - b.top);
    // keep the focused card exactly next to its text; push others away from it
    const fi = sorted.findIndex((x) => x.c.id === focusComment);
    const h = (id: string) => cardRefs.current.get(id)?.offsetHeight ?? 60;
    const tops = sorted.map((x) => x.top);
    const GAP = 8;
    if (fi >= 0) {
      for (let i = fi + 1; i < sorted.length; i++) tops[i] = Math.max(tops[i], tops[i - 1] + h(sorted[i - 1].c.id) + GAP);
      for (let i = fi - 1; i >= 0; i--) tops[i] = Math.min(tops[i], tops[i + 1] - h(sorted[i].c.id) - GAP);
      const shift = Math.max(0, -Math.min(0, ...tops));
      for (let i = 0; i < tops.length; i++) tops[i] += shift;
    } else {
      for (let i = 1; i < sorted.length; i++) tops[i] = Math.max(tops[i], tops[i - 1] + h(sorted[i - 1].c.id) + GAP);
    }
    sorted.forEach((x, i) => { const el = cardRefs.current.get(x.c.id); if (el) el.style.top = `${tops[i]}px`; });
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: saveComment is a fresh closure each render but only reads repo/change/file
  const onReact = useCallback((kind: CommentKind, el: HTMLElement) => {
    const m = modelRef.current;
    if (!m || !el) return;
    const r = m.elementRange(el, el.tagName === 'LI' ? 'ul,ol' : undefined);
    if (!r) return;
    const anchor = m.anchor(r.start, r.end, Number(el.dataset.line) || 0);
    if (!anchor) return;
    if (kind === 'ok') { saveComment(kind, '', anchor); return; }
    const rect = el.getBoundingClientRect();
    setDraft({ kind, anchor, top: relTop(rect) + Math.min(rect.height, 28), left: Math.max(0, rect.left - wrapRef.current!.getBoundingClientRect().left + 24) });
    getSelection()?.removeAllRanges();
  }, [change, file, repo, relTop]);

  const saveComment = (kind: CommentKind, body: string, anchor: ReviewComment['anchor']) => {
    if (!repo || !change) return;
    review.add({ repo, change, file, anchor, kind, body });
    setDraft(null); setSel(null);
  };

  // text selection → floating toolbar
  const onMouseUp = () => {
    setTimeout(() => {
      const s = getSelection();
      const m = modelRef.current;
      if (!s || s.isCollapsed || !m || !docRef.current?.contains(s.anchorNode)) { setSel(null); return; }
      const r = s.getRangeAt(0);
      const start = m.offsetOf(r.startContainer, r.startOffset), end = m.offsetOf(r.endContainer, r.endOffset);
      if (end - start < 2) { setSel(null); return; }
      const rect = r.getBoundingClientRect();
      const wrap = wrapRef.current!.getBoundingClientRect();
      setSel({ start, end, top: rect.top - wrap.top - 44, left: Math.max(0, rect.left - wrap.left + rect.width / 2 - 120), line: lineHintOf(r.startContainer) });
    });
  };

  const fromSelection = (kind: CommentKind) => {
    const m = modelRef.current;
    if (!sel || !m) return;
    const anchor = m.anchor(sel.start, sel.end, sel.line);
    if (!anchor) return;
    if (kind === 'ok') { saveComment('ok', '', anchor); getSelection()?.removeAllRanges(); return; }
    setDraft({ kind, anchor, top: sel.top + 44 + 28, left: sel.left });
    setSel(null);
  };

  // click on highlighted text → focus its comment
  const onClick = (e: React.MouseEvent) => {
    if (!getSelection()?.isCollapsed) return;
    const m = modelRef.current;
    if (!m || (e.target as HTMLElement).closest('[data-ui]')) return;
    const off = offsetAtPoint(m, e.clientX, e.clientY);
    if (off === null) return;
    const hits = located.filter((c) => positions[c.id].start <= off && off <= positions[c.id].end)
      .sort((a, b) => (positions[a.id].end - positions[a.id].start) - (positions[b.id].end - positions[b.id].start));
    useStore.setState({ focusComment: hits[0]?.id ?? null });
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" onMouseDown={() => { if (!draft) setSel(null); }}>
      <div ref={wrapRef} className={cx('relative mx-auto flex max-w-[1180px] gap-6 py-6', narrow ? 'px-5' : 'px-8')}>
        <div className="min-w-0 max-w-[760px] flex-1">
          {(general.length > 0 || changeLevel.length > 0 || resolvedCount > 0) && (
            <div className="mb-5 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Notes</span>
                {resolvedCount > 0 && (
                  <button onClick={() => setShowResolved(!showResolved)} className="ml-auto flex items-center gap-1 text-[11.5px] text-muted hover:text-fg">
                    {showResolved ? <EyeOff size={12} /> : <Eye size={12} />} {showResolved ? 'Hide' : 'Show'} {resolvedCount} resolved
                  </button>
                )}
              </div>
              <div className={cx('grid gap-2', !narrow && 'grid-cols-2')}>
                {changeLevel.map((c) => <div key={c.id} className="relative"><span className="absolute -top-2 left-2 z-[1] rounded bg-surface px-1 text-[10px] text-muted">whole change</span><CommentCard c={c} /></div>)}
                {general.map((c) => <CommentCard key={c.id} c={c} showQuote />)}
              </div>
            </div>
          )}
          <div ref={docRef} className="doc" onMouseUp={onMouseUp} onClick={onClick}>
            <Doc content={content} onReact={onReact} />
          </div>
        </div>
        {/* margin */}
        <div className={cx('relative w-[280px] shrink-0', narrow && 'hidden')}>
          {anchored.map((c) => (
            <CommentCard key={c.id} c={c} ref={(el) => { if (el) cardRefs.current.set(c.id, el); else cardRefs.current.delete(c.id); }}
              drifted={positions[c.id]?.fuzzy}
              style={{ position: 'absolute', left: 0, right: 0, top: positions[c.id]?.top ?? 0, transition: 'top 120ms ease-out' }} />
          ))}
        </div>

        {sel && !draft && (
          <div data-ui className="absolute z-30 flex gap-0.5 rounded-xl border border-line bg-surface p-1 shadow-pop" style={{ top: sel.top, left: sel.left }}
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}>
            {KINDS.map((k) => (
              <button key={k.id} onClick={() => fromSelection(k.id)} title={k.label}
                className={cx('flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium hover:bg-surface-2', k.tone)}>
                <k.icon size={14} /> {k.short}
              </button>
            ))}
          </div>
        )}
        {draft && (
          <div className="absolute z-30" style={{ top: draft.top, left: Math.min(draft.left, (wrapRef.current?.clientWidth ?? 800) - 340) }}>
            <Composer kind={draft.kind} quote={draft.anchor?.exact} onCancel={() => setDraft(null)} onSave={(k, b) => saveComment(k, b, draft.anchor)} />
          </div>
        )}
      </div>
    </div>
  );
}

// ---- review rounds (what the agent changed) -----------------------------------------
function ChangesView() {
  const { rounds, comments } = useStore();
  const done = rounds.filter((r) => r.status === 'done');
  if (!done.length) return <div className="p-10 text-center text-sm text-muted">No review rounds yet.</div>;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[980px] space-y-8 px-8 py-6">
        {done.map((r, i) => {
          const cs = comments.filter((c) => r.commentIds.includes(c.id));
          return (
            <section key={r.id} className="space-y-3">
              <div className="flex items-center gap-2">
                <h3 className="text-[15px] font-semibold">Round {done.length - i}</h3>
                <span className="text-xs text-muted">{new Date(r.createdAt).toLocaleString()}</span>
                {!r.resultParsed && <Badge tone="warn">agent sent no report</Badge>}
                {r.stopReason && r.stopReason !== 'end_turn' && <Badge tone="bad">{r.stopReason}</Badge>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {cs.map((c) => (
                  <button key={c.id} onClick={() => { if (c.file) { openFile(c.file); useStore.setState({ focusComment: c.id }); } }}
                    className="flex max-w-72 items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1 text-left text-xs hover:border-line-strong">
                    <Badge tone={STATUS_META[c.status].tone}>{STATUS_META[c.status].label}</Badge>
                    <span className="truncate">{c.body || c.anchor?.exact || c.kind}</span>
                  </button>
                ))}
              </div>
              {r.diffs.length ? r.diffs.map((d) => <FileDiffCard key={d.file} d={d} defaultOpen={i === 0} />)
                : <div className="rounded-xl border border-dashed border-line p-4 text-center text-xs text-muted">No files changed in this round.</div>}
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ---- review bar -------------------------------------------------------------------
function ReviewBar({ onGeneral }: { onGeneral: (scope: 'doc' | 'change') => void }) {
  const { comments, rounds, session, file } = useStore();
  const drafts = comments.filter((c) => c.status === 'draft');
  const toCheck = comments.filter((c) => TO_CHECK.has(c.status));
  const running = rounds.find((r) => r.status === 'running');
  const canSend = drafts.length > 0 && !running && session?.status !== 'busy';
  return (
    <div className="@container flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-line bg-surface px-4 py-2.5">
      <Button size="sm" variant="ghost" disabled={file === CHANGES_TAB} onClick={() => onGeneral('doc')} title="Note on this document">
        <MessageSquarePlus size={14} /><span className="hidden @lg:inline">Note on this doc</span><span className="@lg:hidden">Doc note</span></Button>
      <Button size="sm" variant="ghost" onClick={() => onGeneral('change')} title="Note on the whole change">
        <Layers size={14} /><span className="hidden @lg:inline">Note on whole change</span><span className="@lg:hidden">Change note</span></Button>
      <div className="flex-1" />
      {toCheck.length > 0 && (
        <button className="flex items-center gap-1 text-xs text-ok hover:underline" onClick={() => { for (const c of toCheck) if (c.status === 'addressed') review.patch(c.id, { status: 'resolved' }); }}
          title="Resolve every comment the agent reports as addressed">
          <CheckCheck size={14} /> {toCheck.length} to check · resolve addressed
        </button>
      )}
      {running?.stopReason && session?.status !== 'busy' ? (
        // the review turn stopped early (refusal, error, limits): edits made on Continue still count
        <span className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-warn" title="The verdicts and diff will be collected when the agent finishes">Revision stopped ({running.stopReason.replace(/_/g, ' ')})</span>
          <Button size="sm" variant="primary" disabled={session?.status !== 'ready'} onClick={() => sendPrompt('Continue where you left off.')}><Play size={13} /> Continue</Button>
          <Button size="sm" variant="ghost" onClick={() => review.close()} title="Finish this round with whatever the agent did so far">Close round</Button>
        </span>
      ) : running ? (
        <span className="flex items-center gap-2 text-[13px] text-info"><Spinner /> Agent is revising…</span>
      ) : (
        <Button variant="primary" disabled={!canSend} onClick={() => review.send()}>
          <Send size={14} /> Send review{drafts.length ? ` (${drafts.length})` : ''}
        </Button>
      )}
    </div>
  );
}

// ---- pane ---------------------------------------------------------------------------
export function DocReview() {
  const { repo, repos, roots, reposLoaded, changes, change, file, rounds, agents, agent, comments, browse, specs, content } = useStore();
  const [general, setGeneral] = useState<'doc' | 'change' | null>(null);
  const repoInfo = repos.find((r) => r.id === repo);
  const c = changes.find((x) => x.name === change);
  const lastDone = rounds.find((r) => r.status === 'done');
  const [seenRound, setSeenRound] = useState<string | null>(null);
  const [initing, setIniting] = useState(false);

  if (!repo) {
    return reposLoaded && !roots.length ? (
      <Empty icon={<FolderPlus size={28} />} title="Add the folder with your repos"
        text="Pick a folder on this computer. Studio lists the git and OpenSpec repos inside it, and you can add more folders later.">
        <Button variant="primary" className="mt-4" onClick={() => openAddFolder()}><FolderPlus size={14} /> Add folder</Button>
      </Empty>
    ) : <Empty icon={<FolderPlus size={28} />} title="Pick a repository" text="Choose a repo on the left to start working with OpenSpec." />;
  }

  if (repoInfo && !repoInfo.openspec) {
    const ag = agents.filter((a) => a.openspecTool);
    return (
      <Empty icon={<Sparkles size={28} />} title="Set up OpenSpec in this repo"
        text="Creates the openspec/ folder and installs the workflow commands for your agent. Nothing else in the repo changes.">
        <div className="mt-4 flex flex-wrap justify-center gap-1.5">
          {ag.map((a) => <button key={a.id} onClick={() => setAgent(a.id)} className={cx('rounded-lg border px-3 py-1.5 text-[13px]', a.id === agent ? 'border-accent bg-accent-soft text-accent' : 'border-line hover:border-line-strong')}>{a.label}</button>)}
        </div>
        <Button variant="primary" size="lg" className="mt-4" disabled={initing} onClick={async () => { setIniting(true); await initRepo(); setIniting(false); }}>
          {initing ? <Spinner /> : <Sparkles size={16} />} Initialize OpenSpec
        </Button>
      </Empty>
    );
  }

  if (browse?.kind === 'spec') {
    const sp = specs.find((x) => x.name === browse.name);
    return (
      <ReadOnlyDoc title={browse.name} content={content}
        badges={<><Badge tone="info"><BookOpen size={12} /> main spec</Badge>{sp && <Badge>{sp.requirements} requirement{sp.requirements === 1 ? '' : 's'}</Badge>}</>} />
    );
  }

  if (browse?.kind === 'archived') return <ArchivedView name={browse.name} file={browse.file} data={browse.data} />;

  if (!c) return <Empty icon={<FileText size={28} />} title="Nothing open" text={!useStore.getState().changesLoaded ? 'Loading changes…' : changes.length ? 'Pick a change on the left to review it.' : 'Start with “New change” on the left. The agent drafts the proposal, specs, design and tasks for you to review.'} />;

  const tasksDone = c.totalTasks > 0 ? `${c.completedTasks}/${c.totalTasks}` : null;
  const tabs = [...c.files, ...(rounds.some((r) => r.status === 'done') ? [CHANGES_TAB] : [])];
  const count = (f: string) => comments.filter((x) => x.file === f && x.status !== 'resolved').length;
  const tabLabel = (f: string) => f === CHANGES_TAB ? 'What changed' : f.replace(/\.md$/, '').replace(/^specs\//, 'spec: ').replace(/\/spec$/, '');

  return (
    <main className="flex h-full min-h-0 flex-col bg-bg">
      <header className="border-b border-line bg-surface px-6 pt-3">
        <div className="flex items-center gap-3">
          <h1 className="truncate text-[17px] font-semibold tracking-tight">{c.name}</h1>
          {tasksDone && <Badge tone="ok"><ListTodo size={12} /> {tasksDone} tasks</Badge>}
          {c.openComments > 0 && <Badge tone="warn">{c.openComments} open comments</Badge>}
        </div>
        <div className="mt-2 flex gap-0.5 overflow-x-auto">
          {tabs.map((f) => (
            <button key={f} onClick={() => openFile(f)}
              className={cx('flex shrink-0 items-center gap-1.5 border-b-2 px-3 pb-2 pt-1 text-[13px] transition', f === file ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg')}>
              {f === CHANGES_TAB && <GitCompareArrows size={13} />}
              {tabLabel(f)}
              {f !== CHANGES_TAB && c.stale.some((s) => s.id === artifactOfFile(f)) && <span className="h-1.5 w-1.5 rounded-full bg-warn" title="May be out of date: written before something it depends on changed" />}
              {f !== CHANGES_TAB && count(f) > 0 && <span className="rounded-full bg-warn-soft px-1.5 text-[10.5px] text-warn">{count(f)}</span>}
            </button>
          ))}
        </div>
      </header>
      <ValidationPanel c={c} />
      <StalePanel key={`${repo}:${c.name}`} c={c} />

      {lastDone && lastDone.id !== seenRound && lastDone.diffs.length > 0 && file !== CHANGES_TAB && (
        <div className="flex items-center gap-3 border-b border-info/30 bg-info-soft px-6 py-2 text-[13px]">
          <GitCompareArrows size={15} className="text-info" />
          <span className="flex-1">The agent revised {lastDone.diffs.length} file{lastDone.diffs.length > 1 ? 's' : ''}. Check its replies on your comments, then resolve or reopen.</span>
          <Button size="sm" onClick={() => { setSeenRound(lastDone.id); openFile(CHANGES_TAB); }}>View changes</Button>
          <Button size="sm" variant="ghost" onClick={() => setSeenRound(lastDone.id)}>Dismiss</Button>
        </div>
      )}

      {file === CHANGES_TAB ? <ChangesView /> : <ReviewCanvas />}
      <ReviewBar onGeneral={setGeneral} />

      <Dialog open={!!general} onClose={() => setGeneral(null)} title={general === 'change' ? 'Note on the whole change' : `Note on ${file}`}>
        <div className="[&>div]:w-full [&>div]:border-0 [&>div]:p-0 [&>div]:shadow-none">
          <Composer kind="comment" saveLabel="Add note" onCancel={() => setGeneral(null)}
            onSave={(kind, body) => { review.add({ repo, change: c.name, file: general === 'change' ? null : file, anchor: null, kind, body }); setGeneral(null); }} />
        </div>
      </Dialog>
    </main>
  );
}

function Empty({ icon, title, text, children }: { icon: ReactNode; title: string; text: string; children?: ReactNode }) {
  return (
    <main className="flex h-full flex-col items-center justify-center bg-bg p-8 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">{icon}</div>
      <h2 className="text-[17px] font-semibold">{title}</h2>
      <p className="mt-1 max-w-md text-[13.5px] text-muted">{text}</p>
      {children}
    </main>
  );
}
