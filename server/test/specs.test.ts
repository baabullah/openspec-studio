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

describe('archived changes', () => {
  it('maps the dated folder back to the change name and lists its artifacts', async () => {
    const { archivedChangeName, archivedFiles } = await import('../src/openspec.ts');
    expect(archivedChangeName('2026-11-06-add-notes')).toBe('add-notes');
    expect(archivedChangeName('add-notes')).toBe('add-notes');
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-arch-'));
    const dir = path.join(repo, 'openspec', 'changes', 'archive', '2026-11-06-add-notes');
    fs.mkdirSync(path.join(dir, 'specs', 'notes'), { recursive: true });
    for (const f of ['tasks.md', 'proposal.md', 'design.md', 'specs/notes/spec.md', '.openspec.yaml']) fs.writeFileSync(path.join(dir, f), '#');
    expect(archivedFiles(repo, '2026-11-06-add-notes')).toEqual(['proposal.md', 'design.md', 'specs/notes/spec.md', 'tasks.md']) // same order as active changes;
    expect(archivedFiles(repo, 'missing')).toEqual([]);
  });
});

describe('computeStaleness', async () => {
  const { computeStaleness } = await import('../src/openspec.ts');
  // OpenSpec's spec-driven graph
  const graph = [
    { id: 'proposal', requires: [] }, { id: 'specs', requires: ['proposal'] },
    { id: 'design', requires: ['proposal'] }, { id: 'tasks', requires: ['specs', 'design'] },
  ];
  const at = (m: Record<string, number>) => (id: string) => m[id] ?? null;

  it('is quiet when every artifact is newer than what it needs', () => {
    expect(computeStaleness(graph, at({ proposal: 0, specs: 10_000, design: 10_000, tasks: 20_000 }))).toEqual([]);
  });

  it('flags what depends on a changed artifact, and what depends on that', () => {
    expect(computeStaleness(graph, at({ proposal: 30_000, specs: 10_000, design: 10_000, tasks: 20_000 }))).toEqual([
      { id: 'specs', because: ['proposal'] }, { id: 'design', because: ['proposal'] }, { id: 'tasks', because: ['specs', 'design'] },
    ]);
    // only design was edited after tasks
    expect(computeStaleness(graph, at({ proposal: 0, specs: 10_000, design: 30_000, tasks: 20_000 }))).toEqual([{ id: 'tasks', because: ['design'] }]);
  });

  it('treats files written within a second as one generation, and ignores missing ones', () => {
    expect(computeStaleness(graph, at({ proposal: 1_500, specs: 1_000, design: 1_200, tasks: 1_100 }))).toEqual([]);
    expect(computeStaleness(graph, at({ proposal: 30_000, specs: 10_000 }))).toEqual([{ id: 'specs', because: ['proposal'] }]);
  });
});

describe('installedWorkflows', () => {
  it('finds optional workflows from the files openspec writes per tool', async () => {
    const { installedWorkflows } = await import('../src/openspec.ts');
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-wf-'));
    fs.mkdirSync(path.join(repo, '.claude', 'commands', 'opsx'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'commands', 'opsx', 'apply.md'), '#');
    expect(installedWorkflows(repo)).toEqual([]); // core profile only
    fs.writeFileSync(path.join(repo, '.claude', 'commands', 'opsx', 'verify.md'), '#');
    expect(installedWorkflows(repo)).toEqual(['verify']);
    // Codex gets skills only
    const codex = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-wf-'));
    fs.mkdirSync(path.join(codex, '.codex', 'skills', 'openspec-verify-change'), { recursive: true });
    expect(installedWorkflows(codex)).toEqual(['verify']);
    // a verify.md outside an opsx folder is not it
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-wf-'));
    fs.mkdirSync(path.join(other, '.github'), { recursive: true });
    fs.writeFileSync(path.join(other, '.github', 'verify.md'), '#');
    expect(installedWorkflows(other)).toEqual([]);
  });
});
