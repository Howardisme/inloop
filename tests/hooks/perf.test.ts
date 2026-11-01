import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, test } from 'vitest';

import type { CliIo } from '../../src/cli/run.js';
import { preCommit } from '../../src/hooks/hooks.js';
import { openRepo } from '../../src/repo.js';
import { makeRepo, type TestRepo } from '../helpers/repo.js';

const repos: TestRepo[] = [];

afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
});

describe('hook performance', () => {
  test('pre-commit stays below 300 ms with 1000 records', () => {
    const repo = makeRepo({ dirName: 'inloop perf 中文 測試' });
    repos.push(repo);
    for (let file = 0; file < 50; file += 1) repo.write(`src/file-${file}.ts`, 'export const value = 0;\n');
    repo.commit('加入基準檔案');
    for (let file = 0; file < 50; file += 1) repo.write(`src/file-${file}.ts`, `export const value = ${file + 1};\n`);
    const ctx = openRepo(repo.dir);
    const hunksByFile = new Map(ctx.git.diffWorkingTree().map((file) => [file.newPath, file.hunks]));
    const branch = ctx.git.currentBranch();
    const baseHead = ctx.git.headSha();
    for (let index = 0; index < 1000; index += 1) {
      const file = `src/file-${index % 50}.ts`;
      const hunks = hunksByFile.get(file) ?? [];
      ctx.store.insertChange({
        title: `效能紀錄 ${index}`,
        keyPoint: '效能測試',
        whatHow: '建立測試紀錄。',
        why: '驗證 hook 速度。',
        shouldKnow: [{ kind: 'concept', text: '效能測試資料' }],
        coreDiff: '',
        hunks: hunks.map((hunk) => ({
          file: hunk.file,
          oldStart: hunk.oldStart,
          newStart: hunk.newStart,
          added: hunk.added,
          removed: hunk.removed,
          span: hunk.span,
          contextBefore: hunk.contextBefore,
          contextAfter: hunk.contextAfter,
          fingerprint: hunk.fingerprint,
        })),
        supersedes: [],
        branch,
        baseHead,
        client: null,
        model: null,
      });
    }
    repo.git('add', 'src/file-0.ts', 'src/file-1.ts');
    const io: CliIo = { out: () => {}, err: () => {}, cwd: repo.dir, env: {}, stdin: async () => '' };

    const timings = Array.from({ length: 3 }, () => {
      const start = performance.now();
      expect(preCommit(ctx, io)).toBe(0);
      return performance.now() - start;
    });

    ctx.store.close();
    expect(Math.min(...timings)).toBeLessThan(300);
  }, 120_000);
});
