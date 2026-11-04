export type AgentVerdict = 'addressed' | 'partial' | 'declined' | 'answered';
export interface ResultItem { id: string; status: AgentVerdict; note: string }

const VERDICTS = new Set<AgentVerdict>(['addressed', 'partial', 'declined', 'answered']);

/**
 * Extract the last ```review-result block from the agent's reply.
 * Returns null when there is none or it cannot be parsed; invalid items are skipped.
 */
export function parseReviewResult(reply: string): ResultItem[] | null {
  const blocks = [...reply.matchAll(/```review-result[^\n]*\n([\s\S]*?)```/g)];
  const body = blocks.at(-1)?.[1];
  if (!body) return null;
  let data: unknown;
  try { data = JSON.parse(body.trim()); } catch { return null; }
  if (!Array.isArray(data)) return null;
  const out: ResultItem[] = [];
  for (const it of data) {
    if (!it || typeof it !== 'object') continue;
    const { id, status, note } = it as Record<string, unknown>;
    const s = String(status ?? '').toLowerCase().trim() as AgentVerdict;
    if (typeof id !== 'string' || !VERDICTS.has(s)) continue;
    out.push({ id, status: s, note: typeof note === 'string' ? note : '' });
  }
  return out;
}

/** The reply without the machine-readable block, for display. */
export const stripReviewResult = (reply: string) => reply.replace(/```review-result[^\n]*\n[\s\S]*?```/g, '').trim();
