import type { ShouldKnowKind } from '../store/types.js';
import type { ChangeView } from '../sync/sync.js';
import { EXISTENCE_LABEL, REVIEW_LABEL } from './labels.js';

const SHOULD_KNOW_LABEL: Record<ShouldKnowKind, string> = {
  concept: '概念',
  risk: '風險',
  shortcut: '捷徑',
};

export function escapeMd(value: string): string {
  return value.replaceAll('<', '\\<').replaceAll('>', '\\>');
}

function reviewStatus(view: ChangeView): string {
  const review = REVIEW_LABEL[view.review];
  return view.existence === 'present'
    ? review
    : `${review}・${EXISTENCE_LABEL[view.existence]}`;
}

function renderRecord(view: ChangeView): string {
  const lines = [
    `### #${view.id} ${escapeMd(view.title)}　\`${reviewStatus(view)}\``,
    `> **重點**：${escapeMd(view.keyPoint)}`,
  ];
  if (view.possiblySupersededBy !== null) {
    lines.push(`> 可能已被 #${view.possiblySupersededBy} 取代`);
  }
  lines.push(
    '',
    `- **What & How**：${escapeMd(view.whatHow)}`,
    `- **Why**：${escapeMd(view.why)}`,
    '- **You should know**',
    ...view.shouldKnow.map((item) =>
      `  - **${SHOULD_KNOW_LABEL[item.kind]}**｜${escapeMd(item.text)}`),
  );
  if (view.coreDiff.length > 0) {
    lines.push('', '```diff', view.coreDiff.replaceAll('```', 'ˋˋˋ'), '```');
  }
  return lines.join('\n');
}

export function renderReviewMarkdown(views: ChangeView[]): string {
  if (views.length === 0) {
    return '目前沒有需要 review 的紀錄。';
  }
  return views.map(renderRecord).join('\n\n---\n\n');
}

function hasCompletedReview(view: ChangeView): boolean {
  return view.review === 'confirmed' || view.review === 'unimportant';
}

export function renderPrSection(views: ChangeView[]): string {
  const lines = ['## InLoop 改動紀錄'];
  for (const view of views) {
    const status = hasCompletedReview(view) ? '已 review' : '未 review';
    lines.push('', `- **${escapeMd(view.title)}** — ${escapeMd(view.why)}（${status}）`);
    for (const item of view.shouldKnow) {
      if (item.kind === 'risk' || item.kind === 'shortcut') {
        lines.push(`  - **${SHOULD_KNOW_LABEL[item.kind]}**｜${escapeMd(item.text)}`);
      }
    }
  }
  return lines.join('\n');
}
