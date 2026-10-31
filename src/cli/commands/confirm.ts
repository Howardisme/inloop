import type { RepoContext } from '../../repo.js';
import { REVIEW_LABEL } from '../../service/labels.js';
import { submitReview } from '../../service/review.js';
import type { Verdict } from '../../store/types.js';

export function confirmCommand(
  context: RepoContext,
  ids: number[],
  verdict: Verdict,
  note: string | undefined,
  out: (value: string) => void,
): void {
  submitReview(context.store, context.git, { ids, verdict, note, source: 'cli' });
  out(`${ids.map((id) => `#${id}`).join('、')}：${REVIEW_LABEL[verdict]}`);
}