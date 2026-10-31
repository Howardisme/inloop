import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

it('builds a self-contained review list app', () => {
  execFileSync(process.execPath, ['scripts/build-app.mjs'], { cwd: repoRoot });

  const output = resolve(repoRoot, 'dist/app/review-list.html');
  expect(existsSync(output)).toBe(true);
  expect(readFileSync(output, 'utf8')).not.toContain('__CARD_SCRIPT__');
});
