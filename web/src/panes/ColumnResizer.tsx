import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { cx } from '../lib/ui.tsx';

/** The agent column's width: at least this wide, and at most AGENT_MAX. */
export const AGENT_MIN = 300;
export const AGENT_MAX = 900;
/** The middle pane (the document) keeps at least this much room. */
export const CENTER_MIN = 480;
const STEP = 16;
const KEY = 'agent-width';

/** Keep a width inside the limits, and leave the document its room in this window. */
export function clampAgentWidth(w: number, viewport: number, railWidth: number): number {
  const max = Math.max(AGENT_MIN, Math.min(AGENT_MAX, viewport - railWidth - CENTER_MIN));
  return Math.round(Math.min(max, Math.max(AGENT_MIN, w)));
}

/** The width the user chose, or null for the layout's default. */
export function readAgentWidth(): number | null {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch { return null; }
}

export function saveAgentWidth(w: number | null) {
  try {
    if (w === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(w));
  } catch { /* private mode */ }
}

/**
 * The handle on the agent column's left edge. Drag it to widen or narrow the
 * chat; arrow keys do the same from the keyboard, double-click restores the default.
 */
export function ColumnResizer({ width, onChange, onReset, railWidth }: {
  width: number;
  onChange: (w: number) => void;
  onReset: () => void;
  railWidth: () => number;
}) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const frame = useRef<number | null>(null);
  const pending = useRef(width);

  // dragging: the document must not select text, and the cursor stays a resize cursor
  const endDrag = () => {
    drag.current = null;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };
  // unmounting mid-drag must not leave the page without text selection or with a resize cursor
  useEffect(() => () => {
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  const limits = () => ({ viewport: window.innerWidth, rail: railWidth() });
  const clamp = (w: number) => { const l = limits(); return clampAgentWidth(w, l.viewport, l.rail); };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: width };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    // the handle sits on the left edge: moving left widens the chat
    pending.current = clamp(d.w + (d.x - e.clientX));
    if (frame.current === null) {
      // one layout update per frame: the document re-lays out (and its comments move) on each change
      frame.current = requestAnimationFrame(() => { frame.current = null; onChange(pending.current); });
    }
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    endDrag();
    onChange(pending.current);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = e.shiftKey ? STEP * 4 : STEP;
    onChange(clamp(width + (e.key === 'ArrowLeft' ? step : -step)));
  };

  const l = limits();
  const max = clampAgentWidth(AGENT_MAX, l.viewport, l.rail);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable window splitter (WAI-ARIA), not a decorative <hr>
    <div role="separator" aria-orientation="vertical" aria-label="Resize the chat panel" aria-valuenow={width} aria-valuemin={AGENT_MIN} aria-valuemax={max}
      tabIndex={0} title="Drag to resize the chat · double-click to reset"
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key} onDoubleClick={onReset}
      className={cx('group absolute inset-y-0 -left-1.5 z-20 w-3 cursor-col-resize touch-none outline-none')}>
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition group-hover:bg-accent group-focus-visible:bg-accent" />
    </div>
  );
}
