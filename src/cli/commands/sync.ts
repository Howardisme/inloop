import type { RepoContext } from '../../repo.js';
import { massChangeWarning } from '../../mcp/format.js';
import { EXISTENCE_LABEL, REVIEW_LABEL } from '../../service/labels.js';
import { sync, type ExistenceStatus, type ReviewStatus } from '../../sync/sync.js';

const EXISTENCE: ExistenceStatus[] = ['present', 'partial', 'gone', 'discarded', 'superseded'];
const REVIEW: ReviewStatus[] = [
  'unreviewed',
  'confirmed',
  'changed_after_confirm',
  'incorrect',
  'unimportant',
];

export function syncCommand(context: RepoContext, out: (value: string) => void): void {
  const result = sync(context.store, context.git);
  const existence = EXISTENCE.map((status) =>
    `${EXISTENCE_LABEL[status]} ${result.views.filter((view) => view.existence === status).length}`);
  const review = REVIEW.map((status) =>
    `${REVIEW_LABEL[status]} ${result.views.filter((view) => view.review === status).length}`);
  out(`${massChangeWarning(result)}存在狀態：${existence.join('、')}\nReview 狀態：${review.join('、')}`);
}