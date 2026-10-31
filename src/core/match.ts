import { normalizeLine } from './diff.js';
import type { Hunk } from './diff.js';

export type Existence = 'present' | 'partial' | 'gone';

export interface MatchThresholds {
  present: number;
  gone: number;
}

export const DEFAULT_THRESHOLDS: MatchThresholds = { present: 0.9, gone: 0.1 };

export interface HunkMatch {
  ratio: number;
  existence: Existence;
  startLine: number | null;
  endLine: number | null;
}

interface NormalizedFileLine {
  text: string;
  lineNumber: number;
}

interface BestRun {
  length: number;
  startLine: number | null;
  endLine: number | null;
}

export function classify(ratio: number, t: MatchThresholds = DEFAULT_THRESHOLDS): Existence {
  if (ratio >= t.present) {
    return 'present';
  }
  if (ratio < t.gone) {
    return 'gone';
  }
  return 'partial';
}

function normalizedLines(lines: string[]): string[] {
  return lines.map(normalizeLine).filter((line) => line.length > 0);
}

function normalizedFileLines(fileText: string): NormalizedFileLine[] {
  return fileText
    .split('\n')
    .map((line, index) => ({ text: normalizeLine(line), lineNumber: index + 1 }))
    .filter((line) => line.text.length > 0);
}

function longestRun(needle: string[], file: NormalizedFileLine[]): BestRun {
  let best: BestRun = { length: 0, startLine: null, endLine: null };

  for (let fileStart = 0; fileStart < file.length; fileStart += 1) {
    for (let needleStart = 0; needleStart < needle.length; needleStart += 1) {
      let length = 0;
      while (
        fileStart + length < file.length
        && needleStart + length < needle.length
        && file[fileStart + length]?.text === needle[needleStart + length]
      ) {
        length += 1;
      }

      if (length > best.length) {
        best = {
          length,
          startLine: file[fileStart]?.lineNumber ?? null,
          endLine: file[fileStart + length - 1]?.lineNumber ?? null,
        };
      }
    }
  }

  return best;
}

export function matchHunk(
  h: Pick<Hunk, 'added' | 'removed'>,
  fileText: string | null,
  t: MatchThresholds = DEFAULT_THRESHOLDS,
): HunkMatch {
  if (fileText === null) {
    return { ratio: 0, existence: 'gone', startLine: null, endLine: null };
  }

  const added = normalizedLines(h.added);
  const file = normalizedFileLines(fileText);

  if (added.length > 0) {
    const best = longestRun(added, file);
    const ratio = best.length / added.length;
    return {
      ratio,
      existence: classify(ratio, t),
      startLine: best.startLine,
      endLine: best.endLine,
    };
  }

  const removed = normalizedLines(h.removed);
  if (removed.length === 0) {
    return { ratio: 1, existence: 'present', startLine: null, endLine: null };
  }

  const removedRatio = longestRun(removed, file).length / removed.length;
  if (removedRatio >= t.present) {
    return { ratio: 0, existence: 'gone', startLine: null, endLine: null };
  }
  return { ratio: 1, existence: 'present', startLine: null, endLine: null };
}
