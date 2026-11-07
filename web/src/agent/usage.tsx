import type { ContextUsage, TurnUsage } from '../../../shared/protocol.ts';
import type { UsageTotals } from './transcript.ts';
import { cx } from '../lib/ui.tsx';

/** 950 → "950", 15_500 → "15.5k", 200_000 → "200k", 1_250_000 → "1.25M" */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
}

export function fmtCost(c: { amount: number; currency: string }): string {
  if (c.currency === 'USD') return `$${c.amount < 1 ? c.amount.toFixed(3) : c.amount.toFixed(2)}`;
  return `${c.amount.toFixed(2)} ${c.currency}`;
}

/** One turn's tokens, under its end-of-turn line: "in 1.2k · cache 9.8k read · 450 write · out 310". */
export function TurnUsageLine({ u }: { u: TurnUsage }) {
  const parts = [`in ${fmtTokens(u.input)}`];
  if (u.cacheRead || u.cacheWrite) parts.push(`cache ${fmtTokens(u.cacheRead ?? 0)} read · ${fmtTokens(u.cacheWrite ?? 0)} write`);
  parts.push(`out ${fmtTokens(u.output)}`);
  if (u.thought) parts.push(`thinking ${fmtTokens(u.thought)}`);
  return (
    <div className="-mt-1 text-center text-[10.5px] tabular-nums text-muted" title={`Tokens for this turn, as the agent reported them. Total ${u.total.toLocaleString()}.`}>
      {parts.join(' · ')}
    </div>
  );
}

/** Header gauge: how full the context window is, the session cost, and the session's token totals on hover. */
export function ContextMeter({ context, totals }: { context: ContextUsage | null; totals: UsageTotals }) {
  if (!context && !totals.turns) return null;
  const pct = context ? Math.min(100, Math.round((context.used / context.size) * 100)) : null;
  const tone = pct === null ? '' : pct >= 85 ? 'text-bad' : pct >= 60 ? 'text-warn' : 'text-muted';
  const lines = [
    context && `Context: ${fmtTokens(context.used)} of ${fmtTokens(context.size)} tokens (${pct}%)`,
    context?.cost && `Session cost: ${fmtCost(context.cost)}`,
    totals.turns > 0 && `This session, ${totals.turns} turn${totals.turns > 1 ? 's' : ''}: input ${fmtTokens(totals.input)} · cache read ${fmtTokens(totals.cacheRead)} · cache write ${fmtTokens(totals.cacheWrite)} · output ${fmtTokens(totals.output)}${totals.thought ? ` · thinking ${fmtTokens(totals.thought)}` : ''}`,
    'As reported by the agent.',
  ].filter(Boolean).join('\n');
  return (
    <span className={cx('flex items-center gap-1.5 text-[11px] tabular-nums', tone)} title={lines} data-testid="context-meter">
      {pct !== null && (
        <>
          <span className="relative h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
            <span className={cx('absolute inset-y-0 left-0 rounded-full', pct >= 85 ? 'bg-bad' : pct >= 60 ? 'bg-warn' : 'bg-accent')} style={{ width: `${Math.max(pct, 2)}%` }} />
          </span>
          context {pct}%
        </>
      )}
      {context?.cost && <span className="text-muted">{fmtCost(context.cost)}</span>}
      {pct === null && totals.turns > 0 && <span className="text-muted">{fmtTokens(totals.input + totals.cacheRead + totals.cacheWrite + totals.output)} tok</span>}
    </span>
  );
}
