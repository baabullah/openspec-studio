import { describe, expect, it } from 'vitest';
import type { AgentEvent, LoggedEvent } from '../../shared/protocol.ts';
import { cleanTitle, fold } from '../src/agent/transcript.ts';

let seq = 0;
const log = (...events: AgentEvent[]): LoggedEvent[] => events.map((event) => ({ seq: ++seq, at: `2026-01-01T00:00:${String(seq).padStart(2, '0')}Z`, event }));
const chunk = (sessionUpdate: string, text: string): AgentEvent => ({ kind: 'update', update: { sessionUpdate, content: { type: 'text', text } } } as AgentEvent);
const tool = (u: Record<string, unknown>): AgentEvent => ({ kind: 'update', update: { sessionUpdate: 'tool_call_update', ...u } } as AgentEvent);

describe('cleanTitle', () => {
  it('drops backticks and a leading cd', () => {
    expect(cleanTitle('`cd "/my repo" && npm test`')).toBe('npm test');
    expect(cleanTitle("cd 'a b'; ls")).toBe('ls');
    expect(cleanTitle('Read file')).toBe('Read file');
  });
});

describe('fold', () => {
  it('merges streamed chunks and tracks the busy turn', () => {
    const { items, busySince } = fold(log(
      { kind: 'user', text: 'hi' },
      chunk('agent_thought_chunk', 'hmm'), chunk('agent_thought_chunk', '…'),
      chunk('agent_message_chunk', 'Hel'), chunk('agent_message_chunk', 'lo'),
    ));
    expect(items.map((i) => i.type)).toEqual(['user', 'thought', 'message']);
    expect(items[2]).toMatchObject({ text: 'Hello' });
    expect(busySince).not.toBeNull();
    expect(fold(log({ kind: 'user', text: 'x' }, { kind: 'turn_end', stopReason: 'end_turn' })).busySince).toBeNull();
  });

  it('updates a tool card in place', () => {
    const { items } = fold(log(
      tool({ sessionUpdate: 'tool_call', toolCallId: 't1', title: '`cd x && ls`', kind: 'execute', status: 'pending' }),
      tool({ toolCallId: 't1', status: 'completed', locations: [{ path: 'a.md' }] }),
    ));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: 'tool', title: 'ls', kind: 'execute', status: 'completed', locations: [{ path: 'a.md' }] });
  });

  it('pairs a resolution with the latest request of that id', () => {
    // interaction ids restart with each agent process
    const perm = (id: string): AgentEvent => ({ kind: 'permission', id, toolCall: { toolCallId: 't' }, options: [] } as unknown as AgentEvent);
    const { items, pending } = fold(log(
      perm('p1'), { kind: 'interaction_resolved', id: 'p1', summary: 'Allow' },
      perm('p1'), // new process, same id, not answered yet
    ));
    expect(items.filter((i) => i.type === 'permission').map((i) => (i as { resolved: string | null }).resolved)).toEqual(['Allow', null]);
    expect(pending).toHaveLength(1);
  });

  it('collects consecutive file writes into one item', () => {
    const { items } = fold(log({ kind: 'file_write', path: 'a.md' }, { kind: 'file_write', path: 'b.md' }, { kind: 'file_write', path: 'a.md' }));
    expect(items).toEqual([expect.objectContaining({ type: 'files', paths: ['a.md', 'b.md'] })]);
  });
});

describe('token usage', () => {
  const usage = { input: 1200, output: 310, cacheRead: 9800, cacheWrite: 450, thought: null, total: 11760 };
  it('keeps each turn usage and sums the current session', () => {
    const { items, totals } = fold(log(
      { kind: 'notice', level: 'info', text: 'New Claude Code session started.' },
      { kind: 'user', text: 'a' }, { kind: 'turn_end', stopReason: 'end_turn', usage },
      { kind: 'user', text: 'b' }, { kind: 'turn_end', stopReason: 'end_turn', usage },
      { kind: 'user', text: 'c' }, { kind: 'turn_end', stopReason: 'end_turn' }, // an agent that reports nothing
    ));
    expect(items.filter((i) => i.type === 'turn_end').map((i) => (i as { usage?: unknown }).usage)).toEqual([usage, usage, undefined]);
    expect(totals).toEqual({ turns: 2, input: 2400, output: 620, cacheRead: 19600, cacheWrite: 900, thought: 0 });
  });
  it('starts again with a new session', () => {
    const { totals } = fold(log(
      { kind: 'turn_end', stopReason: 'end_turn', usage },
      { kind: 'notice', level: 'info', text: 'New Codex session started.' },
    ));
    expect(totals.turns).toBe(0);
  });
});

describe('turn work summary', () => {
  it('lists the commands with their final status and the files changed, per turn', () => {
    const { items } = fold(log(
      { kind: 'user', text: 'old' }, tool({ sessionUpdate: 'tool_call', toolCallId: 'x', title: 'ls', kind: 'execute', status: 'completed' }),
      { kind: 'turn_end', stopReason: 'end_turn' },
      { kind: 'user', text: '/opsx:apply c1', label: 'Apply · c1' },
      tool({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'npm test', kind: 'execute', status: 'in_progress' }),
      tool({ sessionUpdate: 'tool_call', toolCallId: 't2', title: 'Edit app.js', kind: 'edit', status: 'completed', locations: [{ path: '/r/src/app.js' }] }),
      tool({ sessionUpdate: 'tool_call', toolCallId: 't3', title: 'Write hello.js', kind: 'edit', status: 'completed', content: [{ type: 'diff', path: '/r/src/routes/hello.js', oldText: null, newText: 'x' }] }),
      { kind: 'file_write', path: 'openspec/changes/c1/tasks.md' },
      { kind: 'turn_end', stopReason: 'end_turn' },
      tool({ toolCallId: 't1', status: 'failed' }), // the final status arrives late
    ));
    const ends = items.filter((i) => i.type === 'turn_end') as { work: unknown }[];
    expect(ends[0].work).toEqual({ commands: [{ title: 'ls', status: 'completed' }], files: [] });
    expect(ends[1].work).toEqual({
      commands: [{ title: 'npm test', status: 'failed' }],
      files: ['/r/src/app.js', '/r/src/routes/hello.js', 'openspec/changes/c1/tasks.md'],
    });
  });
});
