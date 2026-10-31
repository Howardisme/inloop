import type { ChangeView, SyncResult, UnrecordedHunk } from '../sync/sync.js';
import { EXISTENCE_LABEL, REVIEW_LABEL } from '../service/labels.js';
import type { CardRecord } from '../shared/card.js';

export function massChangeWarning(result: SyncResult): string {
  return result.massChange === null
    ? ''
    : `偵測到 ${result.massChange.count} 筆紀錄同時消失，可能是格式化工具重排了檔案。請先確認再繼續。\n`;
}

export function formatChangeList(views: ChangeView[], pendingCount: number): string {
  return [
    ...views.map((view) =>
      `#${view.id} ${view.title}（${EXISTENCE_LABEL[view.existence]}、${REVIEW_LABEL[view.review]}）`),
    `理解債：${pendingCount} 筆未 review`,
  ].join('\n');
}

export function formatUnrecorded(hunks: UnrecordedHunk[]): string {
  if (hunks.length === 0) return '沒有未記錄的改動。';
  return hunks.map((hunk) =>
    `${hunk.file}:${hunk.newStart}（+${hunk.added.length}/-${hunk.removed.length} 行）`).join('\n');
}

export function toCardRecords(views: ChangeView[]): CardRecord[] {
  return views.map((view) => ({
    id: view.id,
    title: view.title,
    keyPoint: view.keyPoint,
    existence: view.existence,
    review: view.review,
    file: view.locations[0]?.file ?? null,
  }));
}
