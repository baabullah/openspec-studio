import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { env: { STUDIO_DATA: path.join(os.tmpdir(), 'openspec-studio-test') } },
});
