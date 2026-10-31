import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it, vi } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

vi.mock('esbuild', () => ({
  build: vi.fn(async () => ({
    outputFiles: [{ text: 'globalThis.example = "</ScRiPt>";' }],
  })),
}));

it('builds a self-contained review list app', () => {
  execFileSync(process.execPath, ['scripts/build-app.mjs'], { cwd: repoRoot });

  const output = resolve(repoRoot, 'dist/app/review-list.html');
  expect(existsSync(output)).toBe(true);
  const html = readFileSync(output, 'utf8');
  expect(html).not.toContain('__CARD_SCRIPT__');
  expect(html.match(/<\/script/gi)).toHaveLength(1);
});

it('escapes closing script sequences from the bundle', async () => {
  await import(/* @vite-ignore */ new URL('../../scripts/build-app.mjs', import.meta.url).href);

  const output = resolve(repoRoot, 'dist/app/review-list.html');
  const html = readFileSync(output, 'utf8');
  expect(html.match(/<\/script/gi)).toHaveLength(1);
});
