import { describe, expect, it } from 'vitest';
import { fmtCost, fmtTokens } from '../src/agent/usage.tsx';

describe('fmtTokens / fmtCost', () => {
  it('formats compactly', () => {
    expect([950, 1200, 15_500, 200_000, 1_250_000, 2_000_000].map(fmtTokens)).toEqual(['950', '1.2k', '15.5k', '200k', '1.25M', '2M']);
    expect(fmtCost({ amount: 0.0123, currency: 'USD' })).toBe('$0.012');
    expect(fmtCost({ amount: 3.456, currency: 'USD' })).toBe('$3.46');
    expect(fmtCost({ amount: 12, currency: 'credits' })).toBe('12.00 credits');
  });
});
