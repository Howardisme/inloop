// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderList, type CardHandlers } from '../../src/app/render.js';
import type { CardRecord } from '../../src/shared/card.js';
import type { Verdict } from '../../src/store/types.js';

function record(id: number, overrides: Partial<CardRecord> = {}): CardRecord {
  return {
    id,
    title: `標題 ${id}`,
    keyPoint: `重點 ${id}`,
    existence: 'present',
    review: 'unreviewed',
    file: `src/${id}.ts`,
    ...overrides,
  };
}

function findButton(root: HTMLElement, label: string): HTMLButtonElement {
  const button = [...root.querySelectorAll('button')]
    .find((candidate) => candidate.textContent === label);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`找不到按鈕：${label}`);
  return button;
}

describe('renderList', () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement('div');
  });

  it('renders html as text', () => {
    const title = '<img src=x onerror=alert(1)>';

    renderList(root, [record(1, { title })], { submit: async () => ({ ok: true, text: '' }) });

    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain(title);
  });

  it('confirm calls handler with id and note', async () => {
    const calls: Array<[number[], Verdict, string]> = [];
    const handlers: CardHandlers = {
      submit: async (ids, verdict, note) => {
        calls.push([ids, verdict, note]);
        return { ok: true, text: '已儲存' };
      },
    };
    renderList(root, [record(7)], handlers);

    findButton(root, '✎').click();
    const input = root.querySelector('input');
    if (!(input instanceof HTMLInputElement)) throw new Error('找不到備註欄');
    input.value = '備註';
    findButton(root, 'Confirmed').click();

    await vi.waitFor(() => {
      expect(calls).toEqual([[[7], 'confirmed', '備註']]);
      expect(root.textContent).toContain('已確認');
    });
    expect(root.querySelector('.row')?.classList.contains('done')).toBe(true);
  });

  it('confirm all sends actionable unhandled ids only', async () => {
    const calls: Array<[number[], Verdict, string]> = [];
    const handlers: CardHandlers = {
      submit: async (ids, verdict, note) => {
        calls.push([ids, verdict, note]);
        return { ok: true, text: '已儲存' };
      },
    };
    renderList(root, [
      record(1),
      record(2, { review: 'changed_after_confirm' }),
      record(3, { review: 'incorrect' }),
      record(4, { review: 'confirmed' }),
      record(5, { review: 'unimportant' }),
    ], handlers);

    const firstRow = root.querySelector('.row');
    const firstConfirm = firstRow?.querySelector('button.primary');
    if (!(firstConfirm instanceof HTMLButtonElement)) throw new Error('找不到單筆確認按鈕');
    firstConfirm.click();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    findButton(root, '全部確認').click();

    await vi.waitFor(() => {
      expect(calls).toEqual([
        [[1], 'confirmed', ''],
        [[2, 3], 'confirmed', ''],
      ]);
    });
    expect(findButton(root, '全部確認').disabled).toBe(true);
    expect(root.textContent).toContain('InLoop review · 0 筆未 review／共 5 筆');
  });

  it('shows one badge and no actions for already handled rows', () => {
    renderList(root, [record(1, { review: 'confirmed' })], {
      submit: async () => ({ ok: true, text: '' }),
    });

    const row = root.querySelector('.row');
    expect(row?.querySelectorAll('.badge')).toHaveLength(1);
    expect(row?.textContent).toContain('已確認');
    expect(row?.querySelector('button')).toBeNull();
  });
  it('shows existence hint', () => {
    renderList(root, [record(1, { existence: 'partial' })], {
      submit: async () => ({ ok: true, text: '' }),
    });

    expect(root.querySelector('.row')?.textContent).toContain('已被修改');
  });

  it('shows an error and keeps actions enabled when submit fails', async () => {
    renderList(root, [record(1)], {
      submit: async () => ({ ok: false, text: '儲存失敗' }),
    });

    findButton(root, 'Confirmed').click();

    await vi.waitFor(() => expect(root.querySelector('#msg')?.textContent).toContain('儲存失敗'));
    expect(findButton(root, 'Confirmed').disabled).toBe(false);
    expect(findButton(root, '全部確認').disabled).toBe(false);
  });
});
