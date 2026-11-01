import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, expect, it, vi } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const realOutput = resolve(repoRoot, 'dist/app/review-list.html');
const realMtime = existsSync(realOutput) ? statSync(realOutput).mtimeMs : null;
const tempDir = mkdtempSync(join(tmpdir(), 'inloop-app-build-'));

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

vi.mock('esbuild', () => ({
  build: vi.fn(async () => ({
    outputFiles: [{ text: 'globalThis.example = "</ScRiPt>";' }],
  })),
}));

it('builds a self-contained review list app', () => {
  const output = join(tempDir, 'real.html');
  execFileSync(process.execPath, ['scripts/build-app.mjs'], {
    cwd: repoRoot,
    env: { ...process.env, INLOOP_APP_OUT: output },
  });

  const html = readFileSync(output, 'utf8');
  expect(html).not.toContain('__CARD_SCRIPT__');
  expect(html).toContain('inloop-review-list');
  expect(html.match(/<\/script/gi)).toHaveLength(1);
});

it('escapes closing script sequences from the bundle', async () => {
  const output = join(tempDir, 'mocked.html');
  process.env.INLOOP_APP_OUT = output;
  try {
    await import(/* @vite-ignore */ new URL('../../scripts/build-app.mjs', import.meta.url).href);
  } finally {
    delete process.env.INLOOP_APP_OUT;
  }

  const html = readFileSync(output, 'utf8');
  expect(html).toMatch(/<\\\/script>/i);
  expect(html.match(/<\/script/gi)).toHaveLength(1);
});

it('never touches the real build output', () => {
  const now = existsSync(realOutput) ? statSync(realOutput).mtimeMs : null;
  expect(now).toBe(realMtime);
});
