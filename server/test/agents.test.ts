import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-agents-'));
process.env.STUDIO_DATA = DATA;
const { agents, getAgent } = await import('../src/agents.ts');
const file = path.join(DATA, 'agents.json');

describe('custom agents', () => {
  it('reads agents.json once and again only after it changes', () => {
    expect(getAgent('gemini')).toBeNull();
    fs.writeFileSync(file, JSON.stringify([{ id: 'gemini', cmd: 'gemini', style: '/x:{action} {args}' }]));
    const read = vi.spyOn(fs, 'readFileSync');
    expect(getAgent('gemini')?.command('apply', 'c1')).toBe('/x:apply c1');
    agents(); agents();
    expect(read).toHaveBeenCalledTimes(1);

    fs.writeFileSync(file, JSON.stringify([{ id: 'gemini', label: 'Gemini 2', cmd: 'gemini' }]));
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5000)); // coarse mtime on some filesystems
    expect(getAgent('gemini')?.label).toBe('Gemini 2');
    expect(read).toHaveBeenCalledTimes(2);

    fs.rmSync(file);
    expect(getAgent('gemini')).toBeNull();
    read.mockRestore();
  });
});
