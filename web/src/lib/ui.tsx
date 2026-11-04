import { clsx } from 'clsx';
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';

export const cx = clsx;

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ok';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:brightness-110 border-transparent shadow-sm',
  secondary: 'bg-surface text-fg border-line hover:border-line-strong hover:bg-surface-2',
  ghost: 'bg-transparent text-fg-2 border-transparent hover:bg-surface-2 hover:text-fg',
  danger: 'bg-surface text-bad border-line hover:bg-bad-soft hover:border-bad/40',
  ok: 'bg-ok text-white border-transparent hover:brightness-110 shadow-sm',
};

export function Button({ variant = 'secondary', size = 'md', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <button
      {...p}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition select-none whitespace-nowrap disabled:opacity-45 disabled:pointer-events-none',
        size === 'sm' && 'h-7 px-2.5 text-xs', size === 'md' && 'h-8 px-3 text-[13px]', size === 'lg' && 'h-10 px-4 text-sm',
        VARIANT[variant], className,
      )}
    />
  );
}

export function IconButton({ className, title, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { title: string }) {
  return (
    <button {...p} title={title} aria-label={title}
      className={cx('inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg transition disabled:opacity-40', className)} />
  );
}

export function Badge({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'bad' | 'info'; children: ReactNode; className?: string }) {
  const t = {
    neutral: 'bg-surface-2 text-fg-2', accent: 'bg-accent-soft text-accent', ok: 'bg-ok-soft text-ok',
    warn: 'bg-warn-soft text-warn', bad: 'bg-bad-soft text-bad', info: 'bg-info-soft text-info',
  }[tone];
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4', t, className)}>{children}</span>;
}

/** Close on outside click / Escape. */
export function useDismiss<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const t = setTimeout(() => document.addEventListener('mousedown', down));
    document.addEventListener('keydown', key);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open, onClose]);
  return ref;
}

export function Menu({ trigger, children, align = 'left', className }: { trigger: (open: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; className?: string }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useDismiss<HTMLDivElement>(open, close);
  return (
    <div className="relative" ref={ref}>
      {trigger(() => setOpen((o) => !o))}
      {open && (
        <div className={cx('absolute z-40 mt-1 min-w-48 rounded-xl border border-line bg-surface p-1 shadow-pop', align === 'right' ? 'right-0' : 'left-0', className)}>
          {children(close)}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ icon, children, onClick, danger, disabled, hint }: { icon?: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean; hint?: string }) {
  return (
    <button disabled={disabled} onClick={onClick}
      className={cx('flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-2 disabled:opacity-40', danger ? 'text-bad' : 'text-fg')}>
      <span className="w-4 text-muted [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      <span className="flex-1">{children}</span>
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </button>
  );
}

export function Dialog({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useDismiss<HTMLDivElement>(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[12vh] backdrop-blur-[2px]">
      <div ref={ref} className={cx('w-full rounded-2xl border border-line bg-surface shadow-pop', wide ? 'max-w-2xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <IconButton title="Close" onClick={onClose}><X size={16} /></IconButton>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Chip({ active, onClick, children, className }: { active?: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button onClick={onClick}
      className={cx('rounded-full border px-2.5 py-1 text-xs transition', active ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-fg-2 hover:border-line-strong hover:text-fg', className)}>
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx('inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent', className)} />;
}

export const timeAgo = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
