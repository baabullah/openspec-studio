import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { safeResolve } from '../src/repos.ts';

describe('safeResolve', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-sbx-'));
  fs.mkdirSync(path.join(base, 'openspec'));
  // a junction on Windows: plain symlinks need admin rights or Developer Mode there (ignored elsewhere)
  fs.symlinkSync(os.tmpdir(), path.join(base, 'escape'), 'junction');

  it('allows paths inside, including files that do not exist yet', () => {
    expect(safeResolve(base, 'openspec/new/file.md')).toBe(path.join(fs.realpathSync(base), 'openspec/new/file.md'));
    expect(safeResolve(base, path.join(base, 'openspec'))).toBe(path.join(fs.realpathSync(base), 'openspec'));
  });

  it('rejects .. and absolute paths outside', () => {
    expect(safeResolve(base, '../x')).toBeNull();
    expect(safeResolve(base, 'openspec/../../x')).toBeNull();
    expect(safeResolve(base, '/etc/passwd')).toBeNull();
  });

  it('rejects symlink escapes', () => {
    expect(safeResolve(base, 'escape/whatever')).toBeNull();
  });
});
