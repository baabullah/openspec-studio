import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ReviewComment } from '../../shared/protocol.ts';

// a fake openspec CLI (a shell script) that counts its runs
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-cli-'));
const counter = path.join(dir, 'runs');
const bin = path.join(dir, 'openspec');
fs.writeFileSync(bin, `#!/bin/sh
echo "$1" >> "${counter}"
if [ "$1" = list ]; then echo '{"changes":[{"name":"c1","completedTasks":0,"totalTasks":1,"lastModified":"x","status":"in-progress"}]}'
else echo '{"changes":[{"changeName":"c1","artifacts":[],"isPlanningComplete":true,"isComplete":false}]}'; fi
`, { mode: 0o755 });
process.env.OPENSPEC_BIN = bin;
const { listChanges } = await import('../src/openspec.ts');

const runs = () => (fs.existsSync(counter) ? fs.readFileSync(counter, 'utf8').trim().split('\n').length : 0);
const repo = path.join(dir, 'repo');
fs.mkdirSync(path.join(repo, 'openspec', 'changes', 'c1'), { recursive: true });
fs.writeFileSync(path.join(repo, 'openspec', 'changes', 'c1', 'tasks.md'), '- [ ] 1.1 do it\n');
const comment = (status: ReviewComment['status']) => ({ status } as ReviewComment);

describe.skipIf(process.platform === 'win32')('change list CLI cache', () => {
  it('runs the CLI again only when files under openspec/ change', async () => {
    let comments = [comment('addressed')];
    const first = await listChanges(repo, () => comments);
    expect(first[0]).toMatchObject({ name: 'c1', openComments: 1, stage: 'review' });
    expect(runs()).toBe(2); // list + status

    // resolving the last comment: no file changed, so no CLI run, but the stage follows at once
    comments = [comment('resolved')];
    const second = await listChanges(repo, () => comments);
    expect(second[0]).toMatchObject({ openComments: 0, stage: 'ready' });
    expect(runs()).toBe(2);

    // the agent edits an artifact: the CLI runs again
    fs.writeFileSync(path.join(repo, 'openspec', 'changes', 'c1', 'tasks.md'), '- [x] 1.1 do it\n- [ ] 1.2 more\n');
    await listChanges(repo, () => comments);
    expect(runs()).toBe(4);
  });
});
