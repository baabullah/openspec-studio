import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun, WifiOff } from 'lucide-react';
import { boot, initialTheme, setTheme, useStore } from './store.ts';
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
        {!wsUp && <span className="flex items-center gap-1 rounded-full bg-bad-soft px-2 py-0.5 text-[11px] text-bad"><WifiOff size={11} /> server offline · reconnecting…</span>}
      </div>
      <Toasts />
      <AddFolderDialog />
    </div>
  );
}
