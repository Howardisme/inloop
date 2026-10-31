import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { openGit } from '../../src/git/git.js';
import { migrations } from '../../src/store/migrations.js';
import { openStore, storePathFor } from '../../src/store/store.js';
import type { NewChange, Store } from '../../src/store/types.js';
import { makeRepo, type TestRepo } from '../helpers/repo.js';

function newChange(overrides: Partial<NewChange> = {}): NewChange {
  return {
    title: '加入紀錄功能',
    keyPoint: '用 SQLite 保存變更',
    whatHow: '建立 append-only record store。',
    why: '讓後續同步與 review 可以讀取紀錄。',
    shouldKnow: [
      { kind: 'concept', text: '每次修訂都保留舊版本' },
      { kind: 'risk', text: '並行寫入必須序列化' },
    ],
    coreDiff: '+const store = openStore(path);',
    hunks: [{
      file: 'src/中文.ts',
      oldStart: 2,
      newStart: 3,
      added: ['const value = 1;'],
      removed: ['const value = 0;'],
      contextBefore: ['function run() {'],
      contextAfter: ['}'],
      fingerprint: 'fingerprint-1',
    }],
    supersedes: [],
    branch: 'main',
    baseHead: 'abc123',
    client: 'copilot',
    model: 'test-model',
    ...overrides,
  };
}

describe('store', () => {
  let repo: TestRepo | undefined;
  let store: Store | undefined;

  afterEach(() => {
    store?.close();
    repo?.cleanup();
    store = undefined;
    repo = undefined;
  });

  function setup(): { dbPath: string; store: Store } {
    repo = makeRepo();
    const dbPath = join(repo.dir, 'data', 'inloop.db');
    store = openStore(dbPath);
    return { dbPath, store };
  }

  test('insert and read back', () => {
    const { store } = setup();
    const input = newChange({ supersedes: [] });

    const inserted = store.insertChange(input);

    expect(inserted).toEqual({
      ...input,
      id: 1,
      version: 1,
      createdAt: expect.any(String),
      commitSha: null,
    });
    expect(new Date(inserted.createdAt).toISOString()).toBe(inserted.createdAt);
    expect(store.getChange(inserted.id)).toEqual(inserted);
    expect(store.listChanges()).toEqual([inserted]);
  });

  test('insert rolls back all rows when a dependent write fails', () => {
    const { store } = setup();

    expect(() => store.insertChange(newChange({ supersedes: [999] }))).toThrow();

    expect(store.listChanges()).toEqual([]);
  });

  test('amend keeps history', () => {
    const { store } = setup();
    const inserted = store.insertChange(newChange());

    store.amendChange(inserted.id, { title: '第一次修訂' });
    const amended = store.amendChange(inserted.id, { why: '第二次修訂原因。' });

    expect(amended.version).toBe(3);
    expect(amended.title).toBe('第一次修訂');
    expect(amended.why).toBe('第二次修訂原因。');
    expect(amended.hunks).toEqual(inserted.hunks);
    expect(store.getVersions(inserted.id)).toEqual([
      expect.objectContaining({ version: 1, title: inserted.title, why: inserted.why }),
      expect.objectContaining({ version: 2, title: '第一次修訂', why: inserted.why }),
    ]);
  });

  test('amend rejects an unknown id', () => {
    const { store } = setup();
    expect(() => store.amendChange(42, { title: '不存在' })).toThrow('找不到紀錄 #42');
  });

  test('an identical amend still creates a version', () => {
    const { store } = setup();
    const inserted = store.insertChange(newChange());

    const amended = store.amendChange(inserted.id, { title: inserted.title });

    expect(amended.version).toBe(2);
    expect(store.getVersions(inserted.id)).toHaveLength(1);
  });

  test('reviews are append-only', () => {
    const { store } = setup();
    const change = store.insertChange(newChange());
    const first = store.addReview({
      changeId: change.id,
      changeVersion: change.version,
      verdict: 'confirmed',
      note: '看過了',
      source: 'card',
      snapshotHash: 'snapshot-1',
    });
    const second = store.addReview({
      changeId: change.id,
      changeVersion: change.version,
      verdict: 'incorrect',
      note: '內容有誤',
      source: 'form',
      snapshotHash: 'snapshot-2',
    });

    expect(store.reviews(change.id)).toEqual([first, second]);
    expect(store.latestReview(change.id)).toEqual(second);
    expect(second.createdAt).toEqual(expect.any(String));
  });

  test('linkCommit only fills empty', () => {
    const { store } = setup();
    const first = store.insertChange(newChange({ title: '第一筆' }));
    const second = store.insertChange(newChange({ title: '第二筆' }));

    expect(store.linkCommit([first.id], 'old-sha')).toBe(1);
    expect(store.linkCommit([first.id, second.id], 'new-sha')).toBe(1);
    expect(store.getChange(first.id)?.commitSha).toBe('old-sha');
    expect(store.getChange(second.id)?.commitSha).toBe('new-sha');
  });

  test('rewriteCommits maps old to new', () => {
    const { store } = setup();
    const first = store.insertChange(newChange({ title: '第一筆' }));
    const second = store.insertChange(newChange({ title: '第二筆' }));
    store.linkCommit([first.id], 'old-a');
    store.linkCommit([second.id], 'old-b');

    expect(store.rewriteCommits([['old-a', 'new-a'], ['missing', 'unused']])).toBe(1);
    expect(store.getChange(first.id)?.commitSha).toBe('new-a');
    expect(store.getChange(second.id)?.commitSha).toBe('old-b');
  });

  test('manual hunks and status cache round trip', () => {
    const { store } = setup();
    const first = store.insertChange(newChange({ title: '第一筆' }));
    const second = store.insertChange(newChange({ title: '第二筆' }));

    expect(store.isManual('src/a.ts', 'fp')).toBe(false);
    store.markManual('src/a.ts', 'fp');
    expect(store.isManual('src/a.ts', 'fp')).toBe(true);

    store.putStatusCache(new Map([[first.id, 'present'], [second.id, 'gone']]));
    store.putStatusCache(new Map([[first.id, 'partial']]));
    expect(store.getStatusCache()).toEqual(new Map([
      [first.id, 'partial'],
      [second.id, 'gone'],
    ]));
  });

  test('delete removes a change and dependent rows', () => {
    const { store } = setup();
    const first = store.insertChange(newChange());
    const second = store.insertChange(newChange({ supersedes: [first.id] }));
    store.amendChange(first.id, { title: '修訂後' });
    store.addReview({
      changeId: first.id,
      changeVersion: 2,
      verdict: 'unimportant',
      note: '',
      source: 'cli',
      snapshotHash: 'snapshot',
    });
    store.putStatusCache(new Map([[first.id, 'present']]));

    store.deleteChange(first.id);

    expect(store.getChange(first.id)).toBeNull();
    expect(store.getVersions(first.id)).toEqual([]);
    expect(store.reviews(first.id)).toEqual([]);
    expect(store.getStatusCache().has(first.id)).toBe(false);
    expect(store.getChange(second.id)?.supersedes).toEqual([]);
  });

  test('migrations are idempotent', () => {
    const { dbPath, store: first } = setup();
    first.close();
    store = openStore(dbPath);

    const inspect = new DatabaseSync(dbPath);
    const row = inspect.prepare('PRAGMA user_version').get() as { user_version: number };
    inspect.close();

    expect(row.user_version).toBe(migrations.length);
  });

  test('storePathFor uses common dir', () => {
    repo = makeRepo();
    const worktreeDir = `${repo.dir}-worktree`;
    repo.git('worktree', 'add', '-b', 'linked', worktreeDir);

    const mainPath = storePathFor(openGit(repo.dir));
    const worktreePath = storePathFor(openGit(worktreeDir));

    expect(worktreePath).toBe(mainPath);
    expect(mainPath).toBe(join(openGit(repo.dir).commonDir, 'inloop', 'inloop.db'));
  });
});
