import { describe, expect, it } from 'vitest';
import { toContextUsage, toTurnUsage } from '../src/acp/hub.ts';

describe('agent usage', () => {
  it('reads context use and cost from usage_update', () => {
    expect(toContextUsage({ sessionUpdate: 'usage_update', used: 15500, size: 200000, cost: { amount: 0.04, currency: 'USD' } }))
      .toEqual({ used: 15500, size: 200000, cost: { amount: 0.04, currency: 'USD' } });
    // Codex and CodeBuddy send no cost
    expect(toContextUsage({ used: 0, size: 272000 })).toEqual({ used: 0, size: 272000, cost: null });
    expect(toContextUsage({ used: 10, size: 0 })).toBeNull();
    expect(toContextUsage({ used: 'x', size: 10 })).toBeNull();
  });

  it('reads per-turn tokens from the prompt response', () => {
    // claude-agent-acp: input excludes cache; Codex sends the same fields
    expect(toTurnUsage({ inputTokens: 1200, cachedReadTokens: 9800, cachedWriteTokens: 450, outputTokens: 310, totalTokens: 11760 }))
      .toEqual({ input: 1200, output: 310, cacheRead: 9800, cacheWrite: 450, thought: null, total: 11760 });
    expect(toTurnUsage({ inputTokens: 5, outputTokens: 7 })).toEqual({ input: 5, output: 7, cacheRead: null, cacheWrite: null, thought: null, total: 12 });
    expect(toTurnUsage(undefined)).toBeNull();
    expect(toTurnUsage({ outputTokens: 1 })).toBeNull();
  });
});
