import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { openGit, type Git } from '../../src/git/git.js';
import {
  parseScope,
  selectScope,
  submitReview,
} from '../../src/service/review.js';
import { ValidationError } from '../../src/service/changes.js';
import { openStore } from '../../src/store/store.js';
import type { Store } from '../../src/store/types.js';
import { snapshotHash, sync, type ChangeView } from '../../src/sync/sync.js';
import { makeRepo, type TestRepo } from '../helpers/repo.js';
import { seedChange } from '../helpers/seed.js';

describe('review service', () => {
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

  function setup(): { repo: TestRepo; store: Store; git: Git } {
    repo = makeRepo();
    git = openGit(repo.dir);
    store = openStore(join(repo.dir, '.git', 'review-test.db'));
    return { repo, store, git };
  }

  test('parseScope accepts aliases and treats other input as a file', () => {
    expect(parseScope()).toEqual({ kind: 'pending' });
    expect(parseScope('未 review')).toEqual({ kind: 'pending' });
    expect(parseScope('全部')).toEqual({ kind: 'all' });
    expect(parseScope('今天')).toEqual({ kind: 'today' });
    expect(parseScope('since:main')).toEqual({ kind: 'since', ref: 'main' });
    expect(parseScope('src/a.ts')).toEqual({ kind: 'file', path: 'src/a.ts' });
  });

  test('pending scope includes changed_after_confirm and incorrect', () => {
    const ctx = setup();
    ctx.repo.write('a.ts', 'a0\na0\na0\na0\n');
    ctx.repo.write('b.ts', 'b0\nb0\nb0\nb0\n');
    ctx.repo.commit('add files');
    ctx.repo.write('a.ts', 'a1\na1\na1\na1\n');
    ctx.repo.write('b.ts', 'b1\nb1\nb1\nb1\n');
    const changed = seedChange(ctx.store, ctx.git, { files: ['a.ts'] });
    const incorrect = seedChange(ctx.store, ctx.git, { files: ['b.ts'] });
    ctx.store.addReview({
      changeId: changed.id,
      changeVersion: changed.version,
      verdict: 'confirmed',
      note: '',
      source: 'card',
      snapshotHash: snapshotHash(changed, ctx.git),
    });
    ctx.store.addReview({
      changeId: incorrect.id,
      changeVersion: incorrect.version,
      verdict: 'incorrect',
      note: '需要重寫',
      source: 'form',
      snapshotHash: snapshotHash(incorrect, ctx.git),
    });
    ctx.repo.write('a.ts', 'a2\na1\na1\na1\n');
    const views = sync(ctx.store, ctx.git).views;

    expect(views.map((view) => view.review)).toEqual(['changed_after_confirm', 'incorrect']);
    expect(selectScope(views, { kind: 'pending' }, ctx.git).map((view) => view.id))
      .toEqual([changed.id, incorrect.id]);
  });

  test('selectScope applies all, today, since, and resolved file filters', () => {
    const ctx = setup();
    ctx.repo.write('src/a.ts', 'content\n');
    const change = seedChange(ctx.store, ctx.git, { files: ['src/a.ts'] });
    const base = sync(ctx.store, ctx.git).views[0] as ChangeView;
    const discarded = { ...base, id: 2, existence: 'discarded' as const };
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const old = { ...base, id: 3, createdAt: yesterday.toISOString() };

    expect(selectScope([base, discarded], { kind: 'all' }, ctx.git).map((view) => view.id))
      .toEqual([change.id]);
    expect(selectScope([base, old], { kind: 'today' }, ctx.git).map((view) => view.id))
      .toEqual([change.id]);
    expect(selectScope([base], { kind: 'file', path: 'src\\a.ts' }, ctx.git))
      .toEqual([base]);
    expect(selectScope([
      { ...base, id: 4, createdAt: '2000-01-01T00:00:00.000Z' },
      { ...base, id: 5, createdAt: '9999-01-01T00:00:00.000Z' },
    ], { kind: 'since', ref: 'HEAD' }, ctx.git).map((view) => view.id)).toEqual([5]);
    expect(selectScope([base], { kind: 'since', ref: 'missing-ref' }, ctx.git)).toEqual([]);
  });

  test('submitReview stores version and current snapshot for every id', () => {
    const ctx = setup();
    ctx.repo.write('a.ts', 'a\n');
    ctx.repo.write('b.ts', 'b\n');
    const first = seedChange(ctx.store, ctx.git, { files: ['a.ts'] });
    const second = seedChange(ctx.store, ctx.git, { files: ['b.ts'] });

    const reviews = submitReview(ctx.store, ctx.git, {
      ids: [first.id, second.id],
      verdict: 'confirmed',
      note: '已理解',
      source: 'card',
    });

    expect(reviews).toHaveLength(2);
    expect(reviews[0]).toMatchObject({
      changeId: first.id,
      changeVersion: first.version,
      snapshotHash: snapshotHash(first, ctx.git),
      note: '已理解',
    });
    expect(ctx.store.latestReview(second.id)).toEqual(reviews[1]);
  });

  test('submitReview rejects an unknown id without writing partial reviews', () => {
    const ctx = setup();
    ctx.repo.write('a.ts', 'a\n');
    const change = seedChange(ctx.store, ctx.git, { files: ['a.ts'] });

    expect(() => submitReview(ctx.store, ctx.git, {
      ids: [change.id, 404],
      verdict: 'confirmed',
      source: 'cli',
    })).toThrow(ValidationError);
    expect(ctx.store.reviews(change.id)).toEqual([]);
  });
});
