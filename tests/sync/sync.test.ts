import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { openGit, type Git } from '../../src/git/git.js';
import { EXISTENCE_LABEL, REVIEW_LABEL } from '../../src/service/labels.js';
import { openStore } from '../../src/store/store.js';
import type { ChangeRow, Store } from '../../src/store/types.js';
import {
  findUnrecorded,
  snapshotHash,
  sync,
} from '../../src/sync/sync.js';
import { makeRepo, type TestRepo } from '../helpers/repo.js';
import { seedChange } from '../helpers/seed.js';

describe('sync', () => {
  let repo: TestRepo | undefined;
  let store: Store | undefined;
  let git: Git | undefined;

  afterEach(() => {
    store?.close();
    repo?.cleanup();
    store = undefined;
    repo = undefined;
    git = undefined;
  });

  function setup(opts: { initialCommit?: boolean } = {}): { repo: TestRepo; store: Store; git: Git } {
    repo = makeRepo(opts);
    git = openGit(repo.dir);
    store = openStore(join(repo.dir, '.git', 'sync-test.db'));
    return { repo, store, git };
  }

  function viewFor(id: number): ReturnType<typeof sync>['views'][number] {
    const result = sync(store as Store, git as Git);
    const view = result.views.find((candidate) => candidate.id === id);
    expect(view).toBeDefined();
    return view as NonNullable<typeof view>;
  }

  test('user edits part of recorded code', () => {
    const ctx = setup();
    ctx.repo.write('code.ts', 'const a = 0;\nconst b = 0;\nconst c = 0;\nconst d = 0;\n');
    ctx.repo.commit('add source');
    ctx.repo.write('code.ts', 'const a = 1;\nconst b = 1;\nconst c = 1;\nconst d = 1;\n');
    const change = seedChange(ctx.store, ctx.git);

    ctx.repo.write('code.ts', 'const a = 1;\nconst b = 2;\nconst c = 1;\nconst d = 1;\n');

    expect(viewFor(change.id)).toMatchObject({ existence: 'partial', ratio: 0.5 });
    expect(findUnrecorded(ctx.store, ctx.git)).toEqual([
      expect.objectContaining({ file: 'code.ts', added: expect.arrayContaining(['const b = 2;']) }),
    ]);
  });

  test('explicit supersedes', () => {
    const ctx = setup();
    ctx.repo.write('code.ts', 'export const answer = 42;\n');
    const oldChange = seedChange(ctx.store, ctx.git);
    const replacement = seedChange(ctx.store, ctx.git, { supersedes: [oldChange.id] });

    expect(viewFor(oldChange.id)).toMatchObject({
      existence: 'superseded',
      supersededBy: replacement.id,
    });
  });

  test('redo without supersedes suggests the smallest overlapping higher id', () => {
    const ctx = setup();
    ctx.repo.write('code.ts', 'const value = 0;\n');
    ctx.repo.commit('add source');
    ctx.repo.write('code.ts', 'const value = 1;\n');
    const oldChange = seedChange(ctx.store, ctx.git);
    const oldCommit = ctx.repo.commit('first implementation');
    ctx.store.linkCommit([oldChange.id], oldCommit);

    ctx.repo.write('code.ts', 'const value = 2;\n');
    const replacement = seedChange(ctx.store, ctx.git);
    seedChange(ctx.store, ctx.git);

    expect(viewFor(oldChange.id)).toMatchObject({
      existence: 'gone',
      possiblySupersededBy: replacement.id,
    });
  });

  test('discarded by checkout', () => {
    const ctx = setup();
    ctx.repo.write('code.ts', 'const value = 0;\n');
    ctx.repo.commit('add source');
    ctx.repo.write('code.ts', 'const value = 1;\n');
    const change = seedChange(ctx.store, ctx.git);

    ctx.repo.git('checkout', '--', 'code.ts');

    expect(viewFor(change.id).existence).toBe('discarded');
  });

  test('branch switch hides other branch records and switching back shows them', () => {
    const ctx = setup();
    ctx.repo.write('code.ts', 'const value = 1;\n');
    const change = seedChange(ctx.store, ctx.git);

    ctx.repo.git('switch', '-c', 'other');
    expect(sync(ctx.store, ctx.git).views).toEqual([]);

    ctx.repo.git('switch', 'main');
    expect(sync(ctx.store, ctx.git).views.map((view) => view.id)).toEqual([change.id]);
  });

  test('changed after confirm returns to confirmed when code is restored', () => {
    const ctx = setup();
    ctx.repo.write('code.ts', 'const a = 0;\nconst b = 0;\nconst c = 0;\nconst d = 0;\n');
    ctx.repo.commit('add source');
    const recorded = 'const a = 1;\nconst b = 1;\nconst c = 1;\nconst d = 1;\n';
    ctx.repo.write('code.ts', recorded);
    const change = seedChange(ctx.store, ctx.git);
    ctx.store.addReview({
      changeId: change.id,
      changeVersion: change.version,
      verdict: 'confirmed',
      note: '',
      source: 'card',
      snapshotHash: snapshotHash(change, ctx.git),
    });

    ctx.repo.write('code.ts', 'const a = 1;\nconst b = 2;\nconst c = 1;\nconst d = 1;\n');
    expect(viewFor(change.id).review).toBe('changed_after_confirm');

    ctx.repo.write('code.ts', recorded);
    expect(viewFor(change.id).review).toBe('confirmed');
  });

  test('amend resets review', () => {
    const ctx = setup();
    ctx.repo.write('code.ts', 'const value = 1;\n');
    const change = seedChange(ctx.store, ctx.git);
    ctx.store.addReview({
      changeId: change.id,
      changeVersion: change.version,
      verdict: 'incorrect',
      note: '錯了',
      source: 'form',
      snapshotHash: snapshotHash(change, ctx.git),
    });

    ctx.store.amendChange(change.id, { title: '修正後' });

    expect(viewFor(change.id).review).toBe('unreviewed');
  });

  test('rename keeps record present', () => {
    const ctx = setup();
    ctx.repo.write('old.ts', 'const value = 0;\n');
    ctx.repo.commit('add source');
    ctx.repo.write('old.ts', 'const value = 1;\n');
    const change = seedChange(ctx.store, ctx.git);
    const commit = ctx.repo.commit('implement value');
    ctx.store.linkCommit([change.id], commit);

    ctx.repo.git('mv', 'old.ts', 'new.ts');

    const view = viewFor(change.id);
    expect(view).toMatchObject({ existence: 'present' });
    expect(view.locations[0]?.file).toBe('new.ts');
    expect(view.hunks[0]?.file).toBe('old.ts');
  });

  test('mass reformat is flagged after cache has been filled', () => {
    const ctx = setup();
    ctx.repo.write('code.ts', 'const one = 1;\nconst two = 2;\nconst three = 3;\n');
    const changes = Array.from({ length: 6 }, () => seedChange(ctx.store, ctx.git));
    expect(sync(ctx.store, ctx.git).massChange).toBeNull();

    ctx.repo.write('code.ts', 'totally different\n');
    const result = sync(ctx.store, ctx.git);

    expect(result.massChange).toEqual({ count: 6, ids: changes.map((change) => change.id) });
  });

  test('works before first commit', () => {
    const ctx = setup({ initialCommit: false });
    ctx.repo.write('code.ts', 'const value = 1;\n');
    const change = seedChange(ctx.store, ctx.git);

    expect(viewFor(change.id)).toMatchObject({ existence: 'present', ratio: 1 });
    expect(findUnrecorded(ctx.store, ctx.git)).toEqual([]);
  });

  test('files option limits work', () => {
    const ctx = setup();
    ctx.repo.write('a.ts', 'const a = 0;\n');
    ctx.repo.write('b.ts', 'const b = 0;\n');
    ctx.repo.commit('add sources');
    ctx.repo.write('a.ts', 'const a = 1;\n');
    ctx.repo.write('b.ts', 'const b = 1;\n');
    const a = seedChange(ctx.store, ctx.git, { files: ['a.ts'] });
    seedChange(ctx.store, ctx.git, { files: ['b.ts'] });

    expect(sync(ctx.store, ctx.git, { files: ['a.ts'] }).views.map((view) => view.id)).toEqual([a.id]);
  });

  test('renameMap computed at most once per sync', () => {
    const ctx = setup();
    const changes = Array.from({ length: 5 }, (_, index) => {
      const file = `file-${index}.ts`;
      ctx.repo.write(file, `export const value = ${index};\n`);
      const change = seedChange(ctx.store, ctx.git, { files: [file] });
      ctx.repo.commit(`add file ${index}`);
      return change;
    });
    expect(new Set(changes.map((change) => change.baseHead)).size).toBe(5);
    const renameMap = vi.spyOn(ctx.git, 'renameMap');

    sync(ctx.store, ctx.git);
    expect(renameMap).not.toHaveBeenCalled();

    ctx.repo.git('mv', 'file-4.ts', 'moved.ts');
    const result = sync(ctx.store, ctx.git);

    expect(renameMap).toHaveBeenCalledTimes(1);
    expect(result.views.find((view) => view.id === changes[4]?.id)).toMatchObject({
      existence: 'present',
      locations: [expect.objectContaining({ file: 'moved.ts' })],
    });
  });

  test('aggregates ratios using non-blank added-line weights', () => {
    const ctx = setup();
    ctx.repo.write('a.ts', 'const a = 1;\n\nconst b = 1;\nconst c = 1;\n');
    const change = seedChange(ctx.store, ctx.git);
    const [original] = change.hunks;
    expect(original).toBeDefined();
    const weighted = ctx.store.insertChange({
      ...change,
      title: '加權紀錄',
      hunks: [
        { ...original as ChangeRow['hunks'][number], added: ['missing'] },
        { ...original as ChangeRow['hunks'][number], added: ['const a = 1;', '', 'const b = 1;', 'const c = 1;'] },
      ],
      supersedes: [],
    });

    expect(viewFor(weighted.id).ratio).toBe(0.75);
  });
});

describe('status labels', () => {
  test('uses the shared Traditional Chinese labels', () => {
    expect(EXISTENCE_LABEL).toEqual({
      present: '存在',
      partial: '已被修改',
      gone: '已消失',
      discarded: '已捨棄',
      superseded: '已被取代',
    });
    expect(REVIEW_LABEL).toEqual({
      unreviewed: '未 review',
      confirmed: '已確認',
      changed_after_confirm: '確認後又改過',
      incorrect: '說明不正確',
      unimportant: '不重要',
    });
  });
});
