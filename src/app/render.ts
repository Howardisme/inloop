import { EXISTENCE_LABEL, REVIEW_LABEL } from '../service/labels.js';
import type { CardRecord } from '../shared/card.js';
import type { Verdict } from '../store/types.js';

export interface CardHandlers {
  submit(ids: number[], verdict: Verdict, note: string): Promise<{ ok: boolean; text: string }>;
}

const ACTIONABLE_REVIEWS = new Set<CardRecord['review']>([
  'unreviewed',
  'changed_after_confirm',
  'incorrect',
]);

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function button(text: string, onClick: () => void, className?: string): HTMLButtonElement {
  const node = element('button', className);
  node.type = 'button';
  node.textContent = text;
  node.addEventListener('click', onClick);
  return node;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function renderList(root: HTMLElement, records: CardRecord[], handlers: CardHandlers): void {
  const handled = new Map<number, Verdict>();
  let message = '';

  const isPending = (record: CardRecord): boolean =>
    ACTIONABLE_REVIEWS.has(record.review) && !handled.has(record.id);

  const submit = async (ids: number[], verdict: Verdict, note: string): Promise<void> => {
    try {
      const result = await handlers.submit(ids, verdict, note);
      if (result.ok) {
        for (const id of ids) handled.set(id, verdict);
      }
      message = result.text;
    } catch (error) {
      message = `呼叫失敗：${errorText(error)}`;
    }
    render();
  };

  const renderRow = (record: CardRecord): HTMLDivElement => {
    const localVerdict = handled.get(record.id);
    const done = localVerdict !== undefined
      || record.review === 'confirmed'
      || record.review === 'unimportant';
    const row = element('div', `row${done ? ' done' : ''}`);

    const id = element('span', 'id');
    id.textContent = `#${record.id}`;

    const content = element('div');
    const title = element('div', 'title');
    title.textContent = record.title;
    const keyPoint = element('div', 'key');
    keyPoint.textContent = record.keyPoint;
    content.append(title, keyPoint);

    const hints = element('div', 'hints');
    if (record.existence !== 'present') {
      const existence = element('span', 'badge');
      existence.textContent = EXISTENCE_LABEL[record.existence];
      hints.append(existence);
    }
    if (!done && record.review !== 'unreviewed') {
      const review = element('span', record.review === 'confirmed' ? 'badge ok' : 'badge');
      review.textContent = REVIEW_LABEL[record.review];
      hints.append(review);
    }
    if (hints.childElementCount > 0) content.append(hints);

    const noteInput = element('input');
    noteInput.type = 'text';
    noteInput.placeholder = '我的理解不同／有疑問（可留空）';
    noteInput.hidden = true;
    content.append(noteInput);

    const actions = element('div', 'actions');
    if (done) {
      const badge = element('span', 'badge ok');
      badge.textContent = REVIEW_LABEL[localVerdict ?? record.review];
      actions.append(badge);
    } else {
      actions.append(
        button('Confirmed', () => void submit([record.id], 'confirmed', noteInput.value.trim()), 'primary'),
        button('✎', () => {
          noteInput.hidden = !noteInput.hidden;
          if (!noteInput.hidden) noteInput.focus();
        }),
        button('說明不正確', () => void submit([record.id], 'incorrect', noteInput.value.trim())),
        button('不重要', () => void submit([record.id], 'unimportant', noteInput.value.trim())),
      );
      actions.children[1]?.setAttribute('title', '寫備註');
    }

    row.append(id, content, actions);
    return row;
  };

  const render = (): void => {
    const pending = records.filter(isPending);
    const list = element('div', 'list');
    const bar = element('div', 'bar');
    const heading = element('span');
    heading.textContent = `InLoop review · ${pending.length} 筆未 review／共 ${records.length} 筆`;
    const spacer = element('span', 'spacer');
    const confirmAll = button(
      '全部確認',
      () => void submit(pending.map((record) => record.id), 'confirmed', ''),
    );
    confirmAll.disabled = pending.length === 0;
    bar.append(heading, spacer, confirmAll);
    list.append(bar, ...records.map(renderRow));
    if (message) {
      const status = element('div');
      status.id = 'msg';
      status.textContent = message;
      list.append(status);
    }
    root.replaceChildren(list);
  };

  render();
}
