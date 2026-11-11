// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { AGENT_MAX, AGENT_MIN, CENTER_MIN, clampAgentWidth, readAgentWidth, saveAgentWidth } from '../src/panes/ColumnResizer.tsx';

describe('chat width limits', () => {
  it('keeps the chat between its minimum and the room the document leaves', () => {
    expect(clampAgentWidth(100, 1440, 272)).toBe(AGENT_MIN);
    // 1440 - 272 - 480 = 688: a wide chat stops there, the document keeps 480px
    expect(clampAgentWidth(5000, 1440, 272)).toBe(1440 - 272 - CENTER_MIN);
    expect(clampAgentWidth(5000, 2560, 272)).toBe(AGENT_MAX);
    expect(clampAgentWidth(600, 1440, 272)).toBe(600);
  });

  it('never goes below the minimum, even in a narrow window', () => {
    expect(clampAgentWidth(600, 900, 210)).toBe(AGENT_MIN);
  });

  it('rounds to whole pixels', () => {
    expect(clampAgentWidth(412.6, 1440, 272)).toBe(413);
  });
});

describe('chat width memory', () => {
  beforeEach(() => localStorage.clear());

  it('remembers the width the user chose, and nothing when reset', () => {
    expect(readAgentWidth()).toBeNull();
    saveAgentWidth(620);
    expect(readAgentWidth()).toBe(620);
    saveAgentWidth(null);
    expect(readAgentWidth()).toBeNull();
  });

  it('ignores a stored value that is not a width', () => {
    localStorage.setItem('agent-width', 'wide');
    expect(readAgentWidth()).toBeNull();
    localStorage.setItem('agent-width', '-5');
    expect(readAgentWidth()).toBeNull();
  });
});
