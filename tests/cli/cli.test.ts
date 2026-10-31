import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { runCli, type CliIo } from '../../src/cli/run.js';
import { openRepo } from '../../src/repo.js';
import type { NewChange } from '../../src/store/types.js';
import { makeRepo, type TestRepo } from '../helpers/repo.js';
import { seedChange } from '../helpers/seed.js';

interface Capture {
  io: CliIo;
  out: string[];
  err: string[];
}

const repos: TestRepo[] = [];

afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
});

function setup(): TestRepo {
  const repo = makeRepo();
  repos.push(repo);
  return repo;
}

function capture(repo: TestRepo): Capture {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      out: (value) => out.push(value),
      err: (value) => err.push(value),
      cwd: repo.dir,
      env: {},
      stdin: async () => '',
    },
  };
}

function seed(repo: TestRepo, overrides: Partial<NewChange> = {}): number {
  const context = openRepo(repo.dir);
  try {
    return seedChange(context.store, context.git, overrides).id;
  } finally {
    context.store.close();
  }
}

describe('inloop CLI', () => {
  test('list shows comprehension debt count', async () => {
    const repo = setup();
    repo.write('src/a.ts', 'export const answer = 42;\n');
    const id = seed(repo, { title: '加入答案常數' });
    const captured = capture(repo);

    const code = await runCli(['list'], captured.io);

    expect(code).toBe(0);
    expect(captured.out).toEqual([
      `#${id}  未 review  存在  加入答案常數\n理解債：1 筆未 review`,
    ]);
    expect(captured.err).toEqual([]);
  });

  test('confirm writes cli review and list drops it', async () => {
    const repo = setup();
    repo.write('src/a.ts', 'export const answer = 42;\n');
    const id = seed(repo);
    const confirmed = capture(repo);

    expect(await runCli(['confirm', String(id), '--note', '已理解'], confirmed.io)).toBe(0);

    const context = openRepo(repo.dir);
    try {
      expect(context.store.latestReview(id)).toMatchObject({
        verdict: 'confirmed',
        note: '已理解',
        source: 'cli',
      });
    } finally {
      context.store.close();
    }

    const listed = capture(repo);
    expect(await runCli(['list'], listed.io)).toBe(0);
    expect(listed.out).toEqual(['理解債：0 筆未 review']);
  });

  test('why with line', async () => {
    const repo = setup();
    repo.write('src/a.ts', 'first\nanswer\nlast\n');
    const id = seed(repo, { title: '說明答案', why: '這一行提供答案。' });
    const captured = capture(repo);

    expect(await runCli(['why', 'src/a.ts:2'], captured.io)).toBe(0);
    expect(captured.out[0]).toContain(`#${id} 說明答案：這一行提供答案。`);
  });

  test('pr omits notes', async () => {
    const repo = setup();
    repo.git('checkout', '-b', 'feature');
    repo.write('src/a.ts', 'export const answer = 42;\n');
    const id = seed(repo, {
      title: '加入答案常數',
      why: '避免重複硬編碼。',
      shouldKnow: [{ kind: 'risk', text: '答案可能改變。' }],
    });
    const confirmed = capture(repo);
    expect(await runCli(['confirm', String(id), '--note', '私人學習筆記'], confirmed.io)).toBe(0);
    const captured = capture(repo);

    expect(await runCli(['pr', '--base', 'main'], captured.io)).toBe(0);
    expect(captured.out[0]).toContain('## InLoop 改動紀錄');
    expect(captured.out[0]).toContain('加入答案常數');
    expect(captured.out[0]).not.toContain('私人學習筆記');
  });

  test('delete requires --yes', async () => {
    const repo = setup();
    repo.write('src/a.ts', 'answer\n');
    const id = seed(repo);
    const captured = capture(repo);

    expect(await runCli(['delete', String(id)], captured.io)).toBe(1);
    expect(captured.err[0]).toContain('--yes');

    const context = openRepo(repo.dir);
    try {
      expect(context.store.getChange(id)).not.toBeNull();
    } finally {
      context.store.close();
    }
  });

  test('unknown command exits 2', async () => {
    const repo = setup();
    const captured = capture(repo);

    expect(await runCli(['wat'], captured.io)).toBe(2);
    expect(captured.err[0]).toContain('用法');
  });

  test('export json round-trips ids', async () => {
    const repo = setup();
    repo.write('src/a.ts', 'answer\n');
    const id = seed(repo);
    const captured = capture(repo);

    expect(await runCli(['export', '--format', 'json'], captured.io)).toBe(0);
    expect((JSON.parse(captured.out[0] as string) as Array<{ id: number }>).map((view) => view.id))
      .toEqual([id]);
  });

  test('show uses unescaped fields and includes review history', async () => {
    const repo = setup();
    repo.write('src/a.ts', '<answer>\n');
    const id = seed(repo, {
      title: '<標題>',
      keyPoint: '<重點>',
      whatHow: '<做法>',
      why: '<原因>',
      shouldKnow: [{ kind: 'concept', text: '<概念>' }],
    });
    expect(await runCli(['confirm', String(id), '--note', '備註'], capture(repo).io)).toBe(0);
    const captured = capture(repo);

    expect(await runCli(['show', String(id)], captured.io)).toBe(0);
    expect(captured.out[0]).toContain('### #1 <標題>');
    expect(captured.out[0]).not.toContain('\\<標題\\>');
    expect(captured.out[0]).toContain('版本：v1');
    expect(captured.out[0]).toMatch(/Review 歷史：\n- .* 已確認 \(cli\)：備註/);
  });

  test('export --out writes UTF-8 relative to io cwd', async () => {
    const repo = setup();
    repo.write('src/a.ts', 'answer\n');
    seed(repo, { title: '中文標題' });
    const captured = capture(repo);

    expect(await runCli(['export', '--out', 'review.md'], captured.io)).toBe(0);
    expect(captured.out).toEqual(['已匯出到 review.md']);
    expect(readFileSync(join(repo.dir, 'review.md'), 'utf8')).toContain('中文標題');
  });

  test('unrecorded --mark-manual hides marked hunks', async () => {
    const repo = setup();
    repo.write('src/manual.ts', 'manual change\n');
    const marked = capture(repo);

    expect(await runCli(['unrecorded', '--mark-manual'], marked.io)).toBe(0);
    expect(marked.out[0]).toContain('src/manual.ts:1');
    expect(marked.out[0]).toContain('已將 1 筆標記為手動修改。');

    const listed = capture(repo);
    expect(await runCli(['unrecorded'], listed.io)).toBe(0);
    expect(listed.out).toEqual(['沒有未記錄的改動。']);
  });

  test('sync prints existence and review counts', async () => {
    const repo = setup();
    repo.write('src/a.ts', 'answer\n');
    seed(repo);
    const captured = capture(repo);

    expect(await runCli(['sync'], captured.io)).toBe(0);
    expect(captured.out[0]).toContain('存在狀態：存在 1');
    expect(captured.out[0]).toContain('Review 狀態：未 review 1');
  });

  test('delete --yes removes the record', async () => {
    const repo = setup();
    repo.write('src/a.ts', 'answer\n');
    const id = seed(repo);
    const captured = capture(repo);

    expect(await runCli(['delete', String(id), '--yes'], captured.io)).toBe(0);
    expect(captured.out).toEqual([`已刪除 #${id}。`]);
  });

  test('missing default PR base asks for --base', async () => {
    const repo = setup();
    repo.git('branch', '-M', 'topic');
    const captured = capture(repo);

    expect(await runCli(['pr'], captured.io)).toBe(1);
    expect(captured.err[0]).toContain('--base');
  });
});