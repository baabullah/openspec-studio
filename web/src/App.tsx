import { useEffect, useState } from 'react';
import { ArrowUpCircle, Monitor, Moon, Sun, WifiOff, X } from 'lucide-react';
import type { UpdateInfo } from '../../shared/protocol.ts';
import { api } from './lib/api.ts';
import { boot, initialTheme, setTheme, toast, useStore } from './store.ts';
import { cx, IconButton } from './lib/ui.tsx';
import { RepoRail } from './panes/RepoRail.tsx';
import { DocReview } from './panes/DocReview.tsx';
import { AgentPanel } from './panes/AgentPanel.tsx';
import { AddFolderDialog } from './panes/Folders.tsx';
import { ErrorBoundary } from './lib/ErrorBoundary.tsx';

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-16 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div key={t.id} className={cx('pointer-events-auto max-w-lg rounded-xl px-4 py-2 text-[13px] shadow-pop',
          t.level === 'error' ? 'bg-bad text-white' : 'bg-fg text-bg')}>{t.text}</div>
      ))}
    </div>
  );
}

function ThemeToggle() {
  const [t, setT] = useState(initialTheme);
  const next = { system: 'light', light: 'dark', dark: 'system' } as const;
  const Icon = t === 'light' ? Sun : t === 'dark' ? Moon : Monitor;
  return <IconButton title={`Theme: ${t}`} onClick={() => { const n = next[t]; setTheme(n); setT(n); }}><Icon size={15} /></IconButton>;
}

const DISMISS_KEY = 'update-dismissed';
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

/** "Studio x.y.z is available": click copies the update command; hidden per version. */
function UpdatePill() {
  const [u, setU] = useState<UpdateInfo | null>(null);
  const [hidden, setHidden] = useState<string | null>(() => lsGet(DISMISS_KEY));
  useEffect(() => { api.update().then(setU).catch(() => {}); }, []);
  if (!u?.newer || !u.latest || hidden === u.latest) return null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(u.command); toast(`Copied: ${u.command}. Run it in a terminal, then restart Studio.`); }
    catch { toast(`Update with: ${u.command}`); }
  };
  return (
    <span className="flex items-center rounded-full bg-accent-soft text-[11px] text-accent">
      <button type="button" onClick={copy} className="flex items-center gap-1 py-0.5 pl-2 pr-1 hover:underline"
        title={`You have ${u.current}. Click to copy the update command: ${u.command}`}>
        <ArrowUpCircle size={12} /> Studio {u.latest} available
      </button>
      <button type="button" title="Hide until the next version" onClick={() => { lsSet(DISMISS_KEY, u.latest!); setHidden(u.latest); }}
        className="rounded-full py-0.5 pl-0.5 pr-1.5 opacity-70 hover:opacity-100"><X size={11} /></button>
    </span>
  );
}

export function App() {
  const wsUp = useStore((s) => s.wsUp);
  const repo = useStore((s) => s.repo);
  const change = useStore((s) => s.change);
  useEffect(() => { setTheme(initialTheme()); boot(); }, []);
  return (
    <div className="grid h-full grid-cols-[272px_minmax(0,1fr)_400px] max-xl:grid-cols-[230px_minmax(0,1fr)_340px] max-lg:grid-cols-[210px_minmax(0,1fr)_300px]">
      <ErrorBoundary name="Repositories"><RepoRail /></ErrorBoundary>
      <ErrorBoundary name="Review" resetKey={`${repo}|${change}`}><DocReview /></ErrorBoundary>
      <ErrorBoundary name="Agent panel" resetKey={repo}><AgentPanel /></ErrorBoundary>
      <div className="fixed bottom-3 left-3 z-40 flex items-center gap-1">
        <ThemeToggle />
        <UpdatePill />
        {!wsUp && <span className="flex items-center gap-1 rounded-full bg-bad-soft px-2 py-0.5 text-[11px] text-bad"><WifiOff size={11} /> server offline · reconnecting…</span>}
      </div>
      <Toasts />
      <AddFolderDialog />
    </div>
  );
}
