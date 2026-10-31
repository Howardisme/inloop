import type { RepoContext } from '../../repo.js';
import { EXISTENCE_LABEL, REVIEW_LABEL } from '../../service/labels.js';
import { parseScope, selectScope } from '../../service/review.js';
import { sync } from '../../sync/sync.js';

export function listCommand(
  context: RepoContext,
  scope: string | undefined,
  out: (value: string) => void,
): void {
  const result = sync(context.store, context.git);
  const views = selectScope(result.views, parseScope(scope), context.git);
  const pending = selectScope(result.views, parseScope(), context.git).length;
  out([
    ...views.map((view) =>
      `#${view.id}  ${REVIEW_LABEL[view.review]}  ${EXISTENCE_LABEL[view.existence]}  ${view.title}`),
    `理解債：${pending} 筆未 review`,
  ].join('\n'));
}