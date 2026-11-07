import { describe, expect, it } from 'vitest';
import { relativeTo } from '../src/agent/TurnWorkLine.tsx';

describe('relativeTo', () => {
  it('shows paths relative to the repo, on any OS', () => {
    expect(relativeTo('/home/me/app', '/home/me/app/src/a.js')).toBe('src/a.js');
    expect(relativeTo('C:\\Users\\me\\app', 'c:\\users\\me\\app\\src\\a.js')).toBe('src/a.js');
    expect(relativeTo('/home/me/app', 'openspec/x.md')).toBe('openspec/x.md');
    expect(relativeTo('/home/me/app', '/home/me/application/a.js')).toBe('/home/me/application/a.js');
  });
});
