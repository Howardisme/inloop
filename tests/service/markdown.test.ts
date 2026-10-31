import { describe, expect, test } from 'vitest';

import {
  escapeMd,
  renderPrSection,
  renderReviewMarkdown,
} from '../../src/service/markdown.js';
import type { ChangeView } from '../../src/sync/sync.js';

function view(overrides: Partial<ChangeView> = {}): ChangeView {
  return {
    id: 14,
    version: 1,
    title: '標題',
    keyPoint: '重點',
    whatHow: '做法',
    why: '原因',
    shouldKnow: [{ kind: 'concept', text: '概念' }],
    coreDiff: '@@ src/a.ts:3 @@\n-old\n+new',
    hunks: [],
    supersedes: [],
    branch: 'main',
    baseHead: 'abc',
    client: null,
    model: null,
    createdAt: '2026-10-31T00:00:00.000Z',
    commitSha: null,
    existence: 'present',
    ratio: 1,
    review: 'unreviewed',
    latestReview: null,
    supersededBy: null,
    possiblySupersededBy: null,
    locations: [],
    ...overrides,
  };
}

describe('review markdown', () => {
  test('renders the exact record shape', () => {
    expect(renderReviewMarkdown([view()])).toBe([
      '### #14 標題　`未 review`',
      '> **重點**：重點',
      '',
      '- **What & How**：做法',
      '- **Why**：原因',
      '- **You should know**',
      '  - **概念**｜概念',
      '',
      '```diff',
      '@@ src/a.ts:3 @@',
      '-old',
      '+new',
      '```',
    ].join('\n'));
  });

  test('markdown escapes html in title and all record text', () => {
    const output = renderReviewMarkdown([view({
      title: '<img src=x>',
      keyPoint: '<重點>',
      whatHow: '<做法>',
      why: '<原因>',
      shouldKnow: [{ kind: 'risk', text: '<風險>' }],
    })]);

    expect(output).toContain('\\<img src=x\\>');
    expect(output).not.toMatch(/(?<!\\)<img/);
    expect(output).toContain('\\<重點\\>');
    expect(output).toContain('**風險**｜\\<風險\\>');
  });

  test('adds existence and possible replacement indicators', () => {
    const output = renderReviewMarkdown([view({
      existence: 'partial',
      review: 'changed_after_confirm',
      possiblySupersededBy: 20,
    })]);

    expect(output).toContain('### #14 標題　`確認後又改過・已被修改`');
    expect(output).toContain('> **重點**：重點\n> 可能已被 #20 取代\n\n- **What & How**');
  });

  test('omits an empty core diff and separates records', () => {
    const output = renderReviewMarkdown([
      view({ coreDiff: '' }),
      view({ id: 15, title: '第二筆', coreDiff: '' }),
    ]);

    expect(output).not.toContain('```diff');
    expect(output).toContain('\n\n---\n\n');
  });

  test('neutralizes nested diff fences', () => {
    expect(renderReviewMarkdown([view({ coreDiff: '+```ts\n+code\n+```' })]))
      .toContain('+ˋˋˋts\n+code\n+ˋˋˋ');
  });

  test('returns a friendly empty message', () => {
    expect(renderReviewMarkdown([])).toBe('目前沒有需要 review 的紀錄。');
  });
});

describe('PR markdown', () => {
  test('pr section omits notes and includes only risks and shortcuts', () => {
    const output = renderPrSection([view({
      review: 'confirmed',
      latestReview: {
        id: 1,
        changeId: 14,
        changeVersion: 1,
        verdict: 'confirmed',
        note: '私人備註不要輸出',
        source: 'card',
        snapshotHash: 'snapshot',
        createdAt: '2026-10-31T00:00:00.000Z',
      },
      shouldKnow: [
        { kind: 'concept', text: '背景概念' },
        { kind: 'risk', text: '可能失敗' },
        { kind: 'shortcut', text: '暫時寫死' },
      ],
    })]);

    expect(output).toBe([
      '## InLoop 改動紀錄',
      '',
      '- **標題** — 原因（已 review）',
      '  - **風險**｜可能失敗',
      '  - **捷徑**｜暫時寫死',
    ].join('\n'));
    expect(output).not.toContain('私人備註不要輸出');
    expect(output).not.toContain('背景概念');
  });

  test('escapeMd escapes only angle brackets', () => {
    expect(escapeMd('a <b> & c')).toBe('a \\<b\\> & c');
  });
});
