import { describe, expect, it } from 'vitest';
import { fromOpenAIUsage, sumUsage, toContextUsage, toTurnUsage, TurnUsageMeter } from '../src/acp/hub.ts';

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

  // CodeBuddy 2.179: no `usage` in the prompt response; one usage_update per model request
  // carries OpenAI-shaped counts in _meta.usage (captured from a real session)
  const cbUpdate = (messageId: string | undefined, usage: unknown) => ({
    sessionUpdate: 'usage_update', used: 50063, size: 1000000,
    _meta: { 'codebuddy.ai/requestId': '01a1bea601f470acaa42af7afeac3452', ...(messageId ? { 'codebuddy.ai/messageId': messageId } : {}), usage },
  });
  const pong = { prompt_tokens: 23051, completion_tokens: 29, total_tokens: 23080, prompt_tokens_details: { cached_tokens: 1408 }, completion_tokens_details: { reasoning_tokens: 26 } };

  it('reads OpenAI-shaped request usage', () => {
    expect(fromOpenAIUsage(pong)).toEqual({ input: 21643, output: 29, cacheRead: 1408, cacheWrite: null, thought: 26, total: 23080 });
    expect(fromOpenAIUsage({ prompt_tokens: 10, completion_tokens: 2 })).toEqual({ input: 10, output: 2, cacheRead: null, cacheWrite: null, thought: null, total: 12 });
    expect(fromOpenAIUsage(undefined)).toBeNull();
    expect(fromOpenAIUsage({ completion_tokens: 2 })).toBeNull();
  });

  it('sums the requests of a CodeBuddy turn, once per message', () => {
    const m = new TurnUsageMeter();
    expect(m.total()).toBeNull();
    m.add({ sessionUpdate: 'usage_update', used: 0, size: 1000000 }); // context only
    m.add(cbUpdate(undefined, undefined)); // request started, no counts yet
    m.add(cbUpdate('msg-1', pong));
    m.add(cbUpdate('msg-1', pong)); // repeated report of the same request
    m.add(cbUpdate('msg-2', { prompt_tokens: 24000, completion_tokens: 100, total_tokens: 24100, prompt_tokens_details: { cached_tokens: 23000 } }));
    expect(m.total()).toEqual({ input: 21643 + 1000, output: 129, cacheRead: 1408 + 23000, cacheWrite: null, thought: 26, total: 23080 + 24100 });
    m.reset();
    expect(m.total()).toBeNull();
  });

  it('adds nullable fields only when some request reported them', () => {
    const a = { input: 1, output: 1, cacheRead: null, cacheWrite: null, thought: null, total: 2 };
    expect(sumUsage([a, a])).toEqual({ input: 2, output: 2, cacheRead: null, cacheWrite: null, thought: null, total: 4 });
    expect(sumUsage([a, { ...a, thought: 5 }])?.thought).toBe(5);
    expect(sumUsage([])).toBeNull();
  });
});
