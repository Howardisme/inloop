import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { openGit, type Git } from '../../src/git/git.js';
import {
  amendChange,
  recordChange,
  renderCoreDiff,
  validateContent,
  ValidationError,
} from '../../src/service/changes.js';
import { openStore } from '../../src/store/store.js';
import type { ChangeContent, Store, StoredHunk } from '../../src/store/types.js';
import { makeRepo, type TestRepo } from '../helpers/repo.js';

const CONTENT: ChangeContent = {
  title: '加入服務層',
  keyPoint: '集中處理改動紀錄',
  whatHow: '讀取工作目錄差異並寫入資料庫。',
  why: '讓 agent 留下可供人 review 的原因。',
  shouldKnow: [{ kind: 'concept', text: '一個 Why 對應一筆紀錄' }],
  coreDiff: '',
};

function hunk(overrides: Partial<StoredHunk> = {}): StoredHunk {
  return {
    file: 'src/a.ts',
    oldStart: 1,
    newStart: 1,
    added: ['new'],
    removed: ['old'],
    contextBefore: [],
    contextAfter: [],
    fingerprint: 'fp',
    ...overrides,
  };
}

describe('change content validation', () => {
  test('rejects title over 60 chars', () => {
    expect(validateContent({ ...CONTENT, title: '字'.repeat(61) }))
      .toEqual(expect.arrayContaining([expect.stringContaining('標題')]));
  });

  test('rejects 4 sentences in why', () => {
    expect(validateContent({ ...CONTENT, why: '第一句。第二句！第三句？第四句。' }))
      .toEqual(expect.arrayContaining([expect.stringContaining('Why')]));
  });

  test('counts only sentence dots, not numeric or identifier dots', () => {
    expect(validateContent({
      ...CONTENT,
      why: '版本 1.5 由 retry.ts 與 a.b.c 處理. 最後完成。',
    })).toEqual([]);
  });

  test('validates all documented field bounds and names', () => {
    const errors = validateContent({
      title: '',
      keyPoint: `${'重'.repeat(81)}。第二句。`,
      whatHow: '',
      why: '理'.repeat(301),
      shouldKnow: [
        { kind: 'concept', text: '' },
        { kind: 'risk', text: '風'.repeat(121) },
        { kind: 'shortcut', text: '捷徑' },
        { kind: 'concept', text: '概念' },
        { kind: 'risk', text: '風險' },
        { kind: 'shortcut', text: '太多' },
      ],
      coreDiff: Array.from({ length: 61 }, () => '+line').join('\n'),
    });

    for (const field of ['標題', '重點', 'What & How', 'Why', 'You should know', 'Core diff']) {
      expect(errors.some((message) => message.includes(field))).toBe(true);
    }
  });
});

describe('change recording', () => {
  let repo: TestRepo | undefined;
  let store: Store | undefined;
  let git: Git | undefined;

  afterEach(() => {
    store?.close();
    repo?.cleanup();
    store = undefined;
    repo = undefined;
    git = undefined;
  });

  function setup(): { repo: TestRepo; store: Store; git: Git } {
    repo = makeRepo();
    git = openGit(repo.dir);
    store = openStore(join(repo.dir, '.git', 'changes-test.db'));
    return { repo, store, git };
  }

  test('records only unrecorded hunks', () => {
    const ctx = setup();
    const lines = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`);
    ctx.repo.write('src/code.ts', `${lines.join('\n')}\n`);
    ctx.repo.commit('add source');

    lines[2] = 'first recorded edit';
    ctx.repo.write('src/code.ts', `${lines.join('\n')}\n`);
    const first = recordChange(ctx.store, ctx.git, { ...CONTENT, files: ['src/code.ts'] });

    lines[27] = 'second unrecorded edit';
    ctx.repo.write('src/code.ts', `${lines.join('\n')}\n`);
    const second = recordChange(ctx.store, ctx.git, { ...CONTENT, title: '第二筆', files: ['src/code.ts'] });

    expect(first.hunks).toHaveLength(1);
    expect(second.hunks).toHaveLength(1);
    expect(second.hunks[0]?.added).toEqual(['second unrecorded edit']);
    expect(second.hunks[0]?.fingerprint).not.toBe(first.hunks[0]?.fingerprint);
  });

  test('rejects path escape as validation error', () => {
    const ctx = setup();

    try {
      recordChange(ctx.store, ctx.git, { ...CONTENT, files: ['../x'] });
      expect.unreachable('expected validation error');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).messages).toEqual([
        '路徑超出 repository 範圍：../x',
      ]);
    }
  });

  test('rejects empty files and unknown supersedes ids', () => {
    const ctx = setup();
    ctx.repo.write('code.ts', 'new code\n');

    expect(() => recordChange(ctx.store, ctx.git, { ...CONTENT, files: [] }))
      .toThrowError(expect.objectContaining({ messages: [expect.stringContaining('檔案')] }));
    expect(() => recordChange(ctx.store, ctx.git, {
      ...CONTENT,
      files: ['code.ts'],
      supersedes: [404],
    })).toThrowError(expect.objectContaining({ messages: [expect.stringContaining('supersedes')] }));
  });

  test('rejects files with no unrecorded changes', () => {
    const ctx = setup();
    ctx.repo.write('code.ts', 'new code\n');
    recordChange(ctx.store, ctx.git, { ...CONTENT, files: ['code.ts'] });

    expect(() => recordChange(ctx.store, ctx.git, { ...CONTENT, files: ['code.ts'] }))
      .toThrowError(expect.objectContaining({
        messages: ['這些檔案沒有尚未記錄的改動'],
      }));
  });

  test('superseding a record allows its hunk to be recorded again', () => {
    const ctx = setup();
    ctx.repo.write('code.ts', 'new code\n');
    const original = recordChange(ctx.store, ctx.git, { ...CONTENT, files: ['code.ts'] });

    const replacement = recordChange(ctx.store, ctx.git, {
      ...CONTENT,
      title: '取代原紀錄',
      files: ['code.ts'],
      supersedes: [original.id],
      client: 'copilot',
      model: 'test-model',
      coreDiff: undefined,
    });

    expect(replacement.hunks).toEqual(original.hunks);
    expect(replacement.supersedes).toEqual([original.id]);
    expect(replacement.client).toBe('copilot');
    expect(replacement.model).toBe('test-model');
    expect(replacement.coreDiff).toContain('@@ code.ts:1 @@');
    expect(replacement.branch).toBe('main');
    expect(replacement.baseHead).toBe(ctx.git.headSha());
  });

  test('amend validates merged content and preserves history', () => {
    const ctx = setup();
    ctx.repo.write('code.ts', 'new code\n');
    const change = recordChange(ctx.store, ctx.git, { ...CONTENT, files: ['code.ts'] });

    expect(() => amendChange(ctx.store, change.id, { why: '一。二。三。四。' }))
      .toThrowError(expect.objectContaining({ messages: [expect.stringContaining('Why')] }));

    const amended = amendChange(ctx.store, change.id, { title: '修訂標題' });
    expect(amended).toMatchObject({ id: change.id, version: 2, title: '修訂標題' });
    expect(ctx.store.getVersions(change.id)).toHaveLength(1);
  });
});

describe('core diff rendering', () => {
  test('chooses the three hunks with most changed lines', () => {
    const rendered = renderCoreDiff([
      hunk({ file: 'one.ts', fingerprint: 'one', added: ['1'], removed: [] }),
      hunk({ file: 'four.ts', fingerprint: 'four', added: ['1', '2', '3', '4'], removed: [] }),
      hunk({ file: 'two.ts', fingerprint: 'two', added: ['1', '2'], removed: [] }),
      hunk({ file: 'three.ts', fingerprint: 'three', added: ['1', '2', '3'], removed: [] }),
    ]);

    expect(rendered).not.toContain('@@ one.ts:1 @@');
    expect(rendered.indexOf('@@ four.ts:1 @@')).toBeLessThan(rendered.indexOf('@@ two.ts:1 @@'));
    expect(rendered).toContain('@@ three.ts:1 @@');
  });

  test('renders removed lines before added lines and truncates to 60 lines', () => {
    const rendered = renderCoreDiff([
      hunk({
        file: 'long.ts',
        newStart: 8,
        removed: ['old one', 'old two'],
        added: Array.from({ length: 70 }, (_, index) => `new ${index + 1}`),
      }),
    ]);

    const lines = rendered.split('\n');
    expect(lines).toHaveLength(60);
    expect(lines.slice(0, 4)).toEqual([
      '@@ long.ts:8 @@',
      '-old one',
      '-old two',
      '+new 1',
    ]);
  });
});
