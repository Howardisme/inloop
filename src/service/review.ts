import type { Git } from '../git/git.js';
import type { ReviewRow, ReviewSource, Store, Verdict } from '../store/types.js';
import { snapshotHash, type ChangeView } from '../sync/sync.js';
import { ValidationError } from './changes.js';

export type Scope =
  | { kind: 'pending' }
  | { kind: 'all' }
  | { kind: 'today' }
  | { kind: 'file'; path: string }
  | { kind: 'since'; ref: string };

export function parseScope(input = ''): Scope {
  const value = input.trim();
  if (value === '' || value === 'pending' || value === '未 review') {
    return { kind: 'pending' };
  }
  if (value === 'all' || value === '全部') {
    return { kind: 'all' };
  }
  if (value === 'today' || value === '今天') {
    return { kind: 'today' };
  }
  if (value.startsWith('since:')) {
    return { kind: 'since', ref: value.slice('since:'.length) };
  }
  return { kind: 'file', path: value };
}

function localDate(value: Date): string {
  const year = String(value.getFullYear()).padStart(4, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function selectScope(views: ChangeView[], scope: Scope, git: Git): ChangeView[] {
  switch (scope.kind) {
    case 'pending':
      return views.filter((view) =>
        ['unreviewed', 'changed_after_confirm', 'incorrect'].includes(view.review)
        && view.existence !== 'superseded'
        && view.existence !== 'discarded');
    case 'all':
      return views.filter((view) => view.existence !== 'discarded');
    case 'today': {
      const today = localDate(new Date());
      return views.filter((view) => {
        const created = new Date(view.createdAt);
        return !Number.isNaN(created.getTime()) && localDate(created) === today;
      });
    }
    case 'since': {
      const since = git.commitTime(scope.ref);
      return since === null
        ? []
        : views.filter((view) => new Date(view.createdAt).getTime() > since.getTime());
    }
    case 'file': {
      const file = git.resolvePath(scope.path);
      return views.filter((view) => view.locations.some((location) => location.file === file));
    }
  }
}

export function submitReview(
  store: Store,
  git: Git,
  input: { ids: number[]; verdict: Verdict; note?: string; source: ReviewSource },
): ReviewRow[] {
  const changes = input.ids.map((id) => store.getChange(id));
  const missing = input.ids.filter((_, index) => changes[index] === null);
  if (missing.length > 0) {
    throw new ValidationError([`找不到紀錄：${missing.map((id) => `#${id}`).join('、')}`]);
  }

  return changes.map((change) => {
    if (change === null) {
      throw new Error('unreachable');
    }
    return store.addReview({
      changeId: change.id,
      changeVersion: change.version,
      verdict: input.verdict,
      note: input.note ?? '',
      source: input.source,
      snapshotHash: snapshotHash(change, git),
    });
  });
}
