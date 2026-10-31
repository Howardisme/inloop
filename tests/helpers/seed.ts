import type { Git } from '../../src/git/git.js';
import type { ChangeRow, NewChange, Store, StoredHunk } from '../../src/store/types.js';

const DEFAULT_CHANGE: Omit<NewChange, 'hunks' | 'branch' | 'baseHead'> = {
  title: '測試改動',
  keyPoint: '重點',
  whatHow: '改了東西。',
  why: '因為需要。',
  shouldKnow: [{ kind: 'concept', text: '概念' }],
  coreDiff: '',
  supersedes: [],
  client: null,
  model: null,
};

export function seedChange(
  store: Store,
  git: Git,
  over: Partial<NewChange> & { files?: string[] } = {},
): ChangeRow {
  const { files, ...overrides } = over;
  const hunks: StoredHunk[] = git.diffWorkingTree(files).flatMap((file) => file.hunks.map((hunk) => ({
    file: hunk.file,
    oldStart: hunk.oldStart,
    newStart: hunk.newStart,
    added: hunk.added,
    removed: hunk.removed,
    contextBefore: hunk.contextBefore,
    contextAfter: hunk.contextAfter,
    fingerprint: hunk.fingerprint,
  })));

  return store.insertChange({
    ...DEFAULT_CHANGE,
    hunks,
    branch: git.currentBranch(),
    baseHead: git.headSha(),
    ...overrides,
  });
}
