import { PathEscapeError, type Git } from '../git/git.js';
import type {
  ChangeContent,
  ChangeRow,
  ShouldKnow,
  Store,
  StoredHunk,
} from '../store/types.js';
import { sync } from '../sync/sync.js';

export class ValidationError extends Error {
  constructor(public readonly messages: string[]) {
    super(messages.join('；'));
    this.name = 'ValidationError';
  }
}

export interface RecordInput {
  title: string;
  keyPoint: string;
  whatHow: string;
  why: string;
  shouldKnow: ShouldKnow[];
  files: string[];
  coreDiff?: string;
  supersedes?: number[];
  client?: string;
  model?: string;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sentenceCount(value: string): number {
  return value
    .replace(/\.(?=\s|$)/g, '\u0000')
    .replace(/[。．!?！？]/g, '\u0000')
    .split('\u0000')
    .filter((part) => part.trim().length > 0)
    .length;
}

function lineCount(value: string): number {
  const trimmed = value.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\r?\n/).length;
}

export function validateContent(content: Partial<ChangeContent>): string[] {
  const errors: string[] = [];
  const title = text(content.title);
  const keyPoint = text(content.keyPoint);
  const whatHow = text(content.whatHow);
  const why = text(content.why);
  const coreDiff = text(content.coreDiff);

  if (title.length < 1 || title.length > 60) {
    errors.push('標題需為 1–60 字元');
  }
  if (keyPoint.length < 1 || keyPoint.length > 80) {
    errors.push('重點需為 1–80 字元');
  } else if (sentenceCount(keyPoint) > 1) {
    errors.push('重點最多 1 句');
  }
  if (whatHow.length < 1 || whatHow.length > 300) {
    errors.push('What & How 需為 1–300 字元');
  } else if (sentenceCount(whatHow) > 3) {
    errors.push('What & How 最多 3 句');
  }
  if (why.length < 1 || why.length > 300) {
    errors.push('Why 需為 1–300 字元');
  } else if (sentenceCount(why) > 3) {
    errors.push('Why 最多 3 句');
  }

  const shouldKnow = content.shouldKnow;
  if (!Array.isArray(shouldKnow) || shouldKnow.length < 1 || shouldKnow.length > 5) {
    errors.push('You should know 需有 1–5 個條目');
  }
  if (Array.isArray(shouldKnow)) {
    for (const item of shouldKnow) {
      const itemText = text(item?.text);
      if (!['concept', 'risk', 'shortcut'].includes(item?.kind) || itemText.length < 1 || itemText.length > 120) {
        errors.push('You should know 每個條目需為 1–120 字元，類型為 concept、risk 或 shortcut');
        break;
      }
    }
  }

  if (lineCount(coreDiff) > 60) {
    errors.push('Core diff 最多 60 行');
  }
  return errors;
}

function storedHunks(git: Git, files: string[]): StoredHunk[] {
  return git.diffWorkingTree(files).flatMap((file) => file.hunks.map((hunk) => ({
    file: hunk.file,
    oldStart: hunk.oldStart,
    newStart: hunk.newStart,
    added: hunk.added,
    removed: hunk.removed,
    contextBefore: hunk.contextBefore,
    contextAfter: hunk.contextAfter,
    fingerprint: hunk.fingerprint,
  })));
}

export function renderCoreDiff(hunks: StoredHunk[], max = 3): string {
  const selected = [...hunks]
    .sort((left, right) =>
      right.added.length + right.removed.length - left.added.length - left.removed.length)
    .slice(0, Math.max(0, max));
  const lines = selected.flatMap((hunk, index) => [
    ...(index === 0 ? [] : ['']),
    `@@ ${hunk.file}:${hunk.newStart} @@`,
    ...hunk.removed.map((line) => `-${line}`),
    ...hunk.added.map((line) => `+${line}`),
  ]);
  return lines.slice(0, 60).join('\n');
}

export function recordChange(store: Store, git: Git, input: RecordInput): ChangeRow {
  const content: ChangeContent = {
    title: input.title,
    keyPoint: input.keyPoint,
    whatHow: input.whatHow,
    why: input.why,
    shouldKnow: input.shouldKnow,
    coreDiff: input.coreDiff ?? '',
  };
  const errors = validateContent(content);
  if (input.files.length === 0) {
    errors.push('檔案至少需要一個');
  }
  if (errors.length > 0) {
    throw new ValidationError(errors);
  }

  let files: string[];
  try {
    files = input.files.map((file) => git.resolvePath(file));
  } catch (error) {
    if (error instanceof PathEscapeError) {
      throw new ValidationError([error.message]);
    }
    throw error;
  }

  const supersedes = input.supersedes ?? [];
  const unknown = supersedes.filter((id) => store.getChange(id) === null);
  if (unknown.length > 0) {
    throw new ValidationError([`supersedes 找不到紀錄：${unknown.map((id) => `#${id}`).join('、')}`]);
  }

  const excludedIds = new Set(supersedes);
  const recordedFingerprints = new Set(sync(store, git, { files }).views
    .filter((view) => view.existence !== 'superseded' && !excludedIds.has(view.id))
    .flatMap((view) => view.hunks.map((hunk) => hunk.fingerprint)));
  const hunks = storedHunks(git, files)
    .filter((hunk) => !recordedFingerprints.has(hunk.fingerprint));

  if (hunks.length === 0) {
    throw new ValidationError(['這些檔案沒有尚未記錄的改動']);
  }

  const coreDiff = input.coreDiff ?? renderCoreDiff(hunks);
  return store.insertChange({
    ...content,
    coreDiff,
    hunks,
    supersedes,
    branch: git.currentBranch(),
    baseHead: git.headSha(),
    client: input.client ?? null,
    model: input.model ?? null,
  });
}

export function amendChange(
  store: Store,
  id: number,
  patch: Partial<ChangeContent>,
): ChangeRow {
  const current = store.getChange(id);
  if (current === null) {
    throw new ValidationError([`找不到紀錄 #${id}`]);
  }
  const content: ChangeContent = {
    title: patch.title ?? current.title,
    keyPoint: patch.keyPoint ?? current.keyPoint,
    whatHow: patch.whatHow ?? current.whatHow,
    why: patch.why ?? current.why,
    shouldKnow: patch.shouldKnow ?? current.shouldKnow,
    coreDiff: patch.coreDiff ?? current.coreDiff,
  };
  const errors = validateContent(content);
  if (errors.length > 0) {
    throw new ValidationError(errors);
  }
  return store.amendChange(id, patch);
}
