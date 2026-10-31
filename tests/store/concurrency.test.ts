import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';

import { openStore } from '../../src/store/store.js';
import { makeRepo, type TestRepo } from '../helpers/repo.js';

function runWriter(dbPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'tests/store/writer.ts', dbPath, '200'],
      { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) reject(new Error(`writer exited ${String(code)}: ${stderr}`));
      else if (stderr !== '') reject(new Error(`writer printed stderr: ${stderr}`));
      else resolve();
    });
  });
}

let repo: TestRepo | undefined;
afterEach(() => repo?.cleanup());

test('concurrent writers serialize without corruption', async () => {
  repo = makeRepo();
  const dbPath = join(repo.dir, 'inloop.db');

  await Promise.all([runWriter(dbPath), runWriter(dbPath)]);

  const store = openStore(dbPath);
  expect(store.listChanges()).toHaveLength(400);
  store.close();

  const inspect = new DatabaseSync(dbPath);
  const row = inspect.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
  inspect.close();
  expect(row.integrity_check).toBe('ok');
}, 30_000);
