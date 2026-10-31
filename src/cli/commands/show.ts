import type { RepoContext } from '../../repo.js';
import { EXISTENCE_LABEL, REVIEW_LABEL } from '../../service/labels.js';
import type { ShouldKnowKind } from '../../store/types.js';
import { sync, type ChangeView } from '../../sync/sync.js';

const SHOULD_KNOW_LABEL: Record<ShouldKnowKind, string> = {
  concept: '概念',
  risk: '風險',
  shortcut: '捷徑',
};

function status(view: ChangeView): string {
  return view.existence === 'present'
    ? REVIEW_LABEL[view.review]
    : `${REVIEW_LABEL[view.review]}・${EXISTENCE_LABEL[view.existence]}`;
}

function markdown(view: ChangeView): string {
  const lines = [
    `### #${view.id} ${view.title}　\`${status(view)}\``,
    `> **重點**：${view.keyPoint}`,
    '',
    `- **What & How**：${view.whatHow}`,
    `- **Why**：${view.why}`,
    '- **You should know**',
    ...view.shouldKnow.map((item) => `  - **${SHOULD_KNOW_LABEL[item.kind]}**｜${item.text}`),
  ];
  if (view.coreDiff.length > 0) lines.push('', '```diff', view.coreDiff, '```');
  return lines.join('\n');
}

export function showCommand(
  context: RepoContext,
  id: number,
  out: (value: string) => void,
): void {
  const view = sync(context.store, context.git).views.find((candidate) => candidate.id === id);
  if (view === undefined) throw new Error(`找不到紀錄 #${id}`);
  const history = context.store.reviews(id).map((review) => {
    const note = review.note.length === 0 ? '' : `：${review.note}`;
    return `- ${review.createdAt} ${REVIEW_LABEL[review.verdict]} (${review.source})${note}`;
  });
  out([
    markdown(view),
    '',
    `版本：v${view.version}`,
    '',
    'Review 歷史：',
    ...history,
  ].join('\n'));
}