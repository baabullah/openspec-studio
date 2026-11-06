import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listSpecs } from '../src/openspec.ts';

describe('listSpecs', () => {
  it('lists capabilities with a spec.md and counts their requirements', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-specs-'));
    const mk = (name: string, text?: string) => {
      fs.mkdirSync(path.join(repo, 'openspec', 'specs', name), { recursive: true });
      if (text !== undefined) fs.writeFileSync(path.join(repo, 'openspec', 'specs', name, 'spec.md'), text);
    };
    mk('notes', '# notes\n## Requirements\n### Requirement: Create\n#### Scenario: a\n### Requirement: List\n');
    mk('auth', '# auth\n### Requirement: Login\n');
    mk('empty'); // no spec.md: not a capability
    expect(listSpecs(repo)).toEqual([
      { name: 'auth', file: 'specs/auth/spec.md', requirements: 1 },
      { name: 'notes', file: 'specs/notes/spec.md', requirements: 2 },
    ]);
    expect(listSpecs(path.join(repo, 'nowhere'))).toEqual([]);
  });
});
