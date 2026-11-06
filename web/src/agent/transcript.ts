import type { LoggedEvent, TurnUsage } from '../../../shared/protocol.ts';

export interface ToolItem {
  type: 'tool'; key: string; id: string; title: string; kind: string; status: string;
  content: any[]; locations: { path: string; line?: number }[]; rawInput?: any;
}
export type Item =
  | { type: 'user'; key: string; text: string; label?: string; at: string }
  | { type: 'message'; key: string; text: string }
  | { type: 'thought'; key: string; text: string }
  | ToolItem
  | { type: 'plan'; key: string; entries: { content: string; status: string; priority?: string }[] }
  | { type: 'permission'; key: string; id: string; toolCall: any; options: { optionId: string; name: string; kind: string }[]; resolved: string | null; tool?: ToolItem }
  | { type: 'elicitation'; key: string; id: string; message: string; schema: any; resolved: string | null }
  | { type: 'notice'; key: string; level: 'info' | 'error'; text: string }
  | { type: 'files'; key: string; paths: string[] }
  | { type: 'turn_end'; key: string; stopReason: string; usage?: TurnUsage };

/** Tokens summed over the turns of the current agent session. */
export interface UsageTotals { turns: number; input: number; output: number; cacheRead: number; cacheWrite: number; thought: number }
const noUsage = (): UsageTotals => ({ turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thought: 0 });

/** Tool titles are often the raw shell command: drop backticks and a leading `cd <dir> &&`. */
export const cleanTitle = (t: string) => t.trim().replace(/^`+|`+$/g, '').replace(/^cd\s+("[^"]+"|'[^']+'|\S+)\s*(&&|;)\s*/, '');

const textOf = (c: any) => (c?.type === 'text' ? String(c.text ?? '') : '');

/** Fold the raw event log into display items (streamed chunks merged, tool calls updated in place). */
export function fold(entries: LoggedEvent[]): { items: Item[]; pending: Item[]; busySince: string | null; totals: UsageTotals } {
  const items: Item[] = [];
  const tools = new Map<string, ToolItem>();
  // Interaction ids restart with each agent process (p1, p2, …), so a
  // resolution belongs to the latest request with that id *before* it,
  // not to any request with the same id. Key resolutions by request seq.
  const resolvedBySeq = new Map<number, string>();
  const latestReq = new Map<string, number>();
  for (const { seq, event } of entries) {
    if (event.kind === 'permission' || event.kind === 'elicitation') latestReq.set(event.id, seq);
    else if (event.kind === 'interaction_resolved') {
      const req = latestReq.get(event.id);
      if (req !== undefined) { resolvedBySeq.set(req, event.summary); latestReq.delete(event.id); }
    }
  }

  let last: Item | undefined;
  let plan: Extract<Item, { type: 'plan' }> | null = null;
  let busySince: string | null = null;
  let totals = noUsage();

  for (const { seq, at, event: e } of entries) {
    const key = String(seq);
    last = items.at(-1);
    switch (e.kind) {
      case 'user':
        items.push({ type: 'user', key, text: e.text, label: e.label, at });
        plan = null; busySince = at;
        break;
      case 'turn_end':
        items.push({ type: 'turn_end', key, stopReason: e.stopReason, usage: e.usage });
        busySince = null;
        if (e.usage) {
          totals.turns++;
          totals.input += e.usage.input; totals.output += e.usage.output;
          totals.cacheRead += e.usage.cacheRead ?? 0; totals.cacheWrite += e.usage.cacheWrite ?? 0; totals.thought += e.usage.thought ?? 0;
        }
        break;
      case 'notice':
        items.push({ type: 'notice', key, level: e.level, text: e.text });
        if (/^New .* session started\./.test(e.text)) totals = noUsage(); // a fresh session starts counting again
        break;
      case 'file_write':
        if (last?.type === 'files') { if (!last.paths.includes(e.path)) last.paths.push(e.path); }
        else items.push({ type: 'files', key, paths: [e.path] });
        break;
      case 'permission':
        items.push({ type: 'permission', key, id: e.id, toolCall: e.toolCall, options: e.options, resolved: resolvedBySeq.get(seq) ?? null, tool: tools.get(e.toolCall?.toolCallId) });
        break;
      case 'elicitation':
        items.push({ type: 'elicitation', key, id: e.id, message: e.message, schema: e.schema, resolved: resolvedBySeq.get(seq) ?? null });
        break;
      case 'update': {
        const u = e.update;
        const k = u.sessionUpdate;
        if (k === 'agent_message_chunk') {
          if (last?.type === 'message') last.text += textOf(u.content);
          else items.push({ type: 'message', key, text: textOf(u.content) });
        } else if (k === 'agent_thought_chunk') {
          if (last?.type === 'thought') last.text += textOf(u.content);
          else items.push({ type: 'thought', key, text: textOf(u.content) });
        } else if (k === 'tool_call' || k === 'tool_call_update') {
          let t = tools.get(u.toolCallId);
          if (!t) {
            t = { type: 'tool', key, id: u.toolCallId, title: 'Tool', kind: 'other', status: 'pending', content: [], locations: [] };
            tools.set(u.toolCallId, t);
            items.push(t);
          }
          if (u.title) t.title = cleanTitle(u.title);
          if (u.kind) t.kind = u.kind;
          if (u.status) t.status = u.status;
          if (Array.isArray(u.content)) t.content = u.content;
          if (Array.isArray(u.locations)) t.locations = u.locations;
          if (u.rawInput !== undefined) t.rawInput = u.rawInput;
        } else if (k === 'plan') {
          if (plan) plan.entries = u.entries ?? [];
          else { plan = { type: 'plan', key, entries: u.entries ?? [] }; items.push(plan); }
        }
        break;
      }
    }
  }
  // permissions that arrived before their tool card was known
  for (const it of items) if (it.type === 'permission' && !it.tool) it.tool = tools.get(it.toolCall?.toolCallId);
  const pending = items.filter((i) => (i.type === 'permission' || i.type === 'elicitation') && !i.resolved);
  return { items, pending, busySince, totals };
}
