import { createHash } from 'node:crypto';

export interface Hunk {
  file: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  added: string[];
  removed: string[];
  span: Array<{ text: string; added: boolean }>;
  contextBefore: string[];
  contextAfter: string[];
  fingerprint: string;
}

export interface FileDiff {
  oldPath: string | null;
  newPath: string | null;
  status: 'added' | 'deleted' | 'modified' | 'renamed';
  binary: boolean;
  hunks: Hunk[];
}

export function normalizeLine(line: string): string {
  return line.replaceAll('\r', '').trim();
}

export function fingerprint(lines: string[]): string {
  const normalized = lines.map(normalizeLine).filter((line) => line.length > 0).join('\n');
  return createHash('sha1').update(normalized).digest('hex');
}

function stripPrefix(path: string): string | null {
  const unquoted = path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path;
  if (unquoted === '/dev/null') {
    return null;
  }
  return unquoted.replace(/^[ab]\//, '');
}

function pathsFromDiffHeader(line: string): [string | null, string | null] {
  const value = line.slice('diff --git '.length);
  const quoted = value.match(/^"a\/(.*)" "b\/(.*)"$/);
  if (quoted) {
    return [quoted[1] ?? null, quoted[2] ?? null];
  }

  const paths = value.match(/^a\/(.*) b\/(.*)$/);
  return [paths?.[1] ?? null, paths?.[2] ?? null];
}

function updateStatus(file: FileDiff, renamed: boolean): void {
  if (renamed) {
    file.status = 'renamed';
  } else if (file.oldPath === null) {
    file.status = 'added';
  } else if (file.newPath === null) {
    file.status = 'deleted';
  } else {
    file.status = 'modified';
  }
}

export function parseUnifiedDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let currentFile: FileDiff | undefined;
  let currentHunk: Hunk | undefined;
  let renamed = false;
  let sawChange = false;

  const finishHunk = (): void => {
    if (!currentHunk) {
      return;
    }
    while (currentHunk.span.at(-1)?.added === false) {
      currentHunk.span.pop();
    }
    currentHunk.fingerprint = fingerprint(
      currentHunk.added.length > 0 ? currentHunk.added : currentHunk.removed,
    );
    currentHunk = undefined;
  };

  const finishFile = (): void => {
    finishHunk();
    if (currentFile) {
      updateStatus(currentFile, renamed);
      files.push(currentFile);
    }
    currentFile = undefined;
  };

  for (const inputLine of text.split('\n')) {
    const line = inputLine.replaceAll('\r', '');

    if (line.startsWith('diff --git ')) {
      finishFile();
      const [oldPath, newPath] = pathsFromDiffHeader(line);
      currentFile = { oldPath, newPath, status: 'modified', binary: false, hunks: [] };
      currentHunk = undefined;
      renamed = false;
      sawChange = false;
      continue;
    }

    if (!currentFile) {
      continue;
    }

    const header = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (header) {
      finishHunk();
      currentHunk = {
        file: currentFile.newPath ?? currentFile.oldPath ?? '',
        oldStart: Number(header[1]),
        oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newLines: header[4] === undefined ? 1 : Number(header[4]),
        added: [],
        removed: [],
        span: [],
        contextBefore: [],
        contextAfter: [],
        fingerprint: '',
      };
      currentFile.hunks.push(currentHunk);
      sawChange = false;
      continue;
    }

    if (currentHunk && line !== '\\ No newline at end of file') {
      if (line.startsWith('+')) {
        currentHunk.added.push(line.slice(1));
        currentHunk.span.push({ text: line.slice(1), added: true });
        currentHunk.contextAfter = [];
        sawChange = true;
        continue;
      }
      if (line.startsWith('-')) {
        currentHunk.removed.push(line.slice(1));
        currentHunk.contextAfter = [];
        sawChange = true;
        continue;
      }
      if (line.startsWith(' ')) {
        const context = line.slice(1);
        if (sawChange) {
          currentHunk.contextAfter.push(context);
          if (currentHunk.span.length > 0) {
            currentHunk.span.push({ text: context, added: false });
          }
        } else {
          currentHunk.contextBefore.push(context);
        }
        continue;
      }
    }

    if (line.startsWith('rename from ')) {
      currentFile.oldPath = line.slice('rename from '.length);
      renamed = true;
    } else if (line.startsWith('rename to ')) {
      currentFile.newPath = line.slice('rename to '.length);
      renamed = true;
    } else if (line.startsWith('--- ')) {
      currentFile.oldPath = stripPrefix(line.slice(4).split('\t', 1)[0] ?? '');
    } else if (line.startsWith('+++ ')) {
      currentFile.newPath = stripPrefix(line.slice(4).split('\t', 1)[0] ?? '');
    } else if (line.startsWith('Binary files ') && line.endsWith(' differ')) {
      currentFile.binary = true;
      currentFile.hunks = [];
    }
  }

  finishFile();
  return files;
}