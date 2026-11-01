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
  const row = new Uint32Array(needle.length + 1);

  for (let fileIndex = 0; fileIndex < file.length; fileIndex += 1) {
    const fileLine = file[fileIndex];
    for (let needleIndex = needle.length - 1; needleIndex >= 0; needleIndex -= 1) {
      const rowIndex = needleIndex + 1;
      if (fileLine?.text !== needle[needleIndex]) {
        row[rowIndex] = 0;
        continue;
      }

      const length = (row[needleIndex] ?? 0) + 1;
      row[rowIndex] = length;
      if (length > best.length) {
        best = {
          length,
          startLine: file[fileIndex - length + 1]?.lineNumber ?? null,
          endLine: fileLine.lineNumber,
        };
        if (best.length === needle.length) {
          return best;
        }
      }
    }
  }

  return best;
}

interface SpanLine {
  text: string;
  added: boolean;
}

function bestSpanRun(span: SpanLine[], file: NormalizedFileLine[], totalAdded: number): BestRun {
  let best: BestRun = { length: 0, startLine: null, endLine: null };
  const lengths = new Uint32Array(span.length + 1);
  const addedCounts = new Uint32Array(span.length + 1);

  for (let fileIndex = 0; fileIndex < file.length; fileIndex += 1) {
    const fileLine = file[fileIndex];
    for (let spanIndex = span.length - 1; spanIndex >= 0; spanIndex -= 1) {
      const rowIndex = spanIndex + 1;
      if (fileLine?.text !== span[spanIndex]?.text) {
        lengths[rowIndex] = 0;
        addedCounts[rowIndex] = 0;
        continue;
      }

      const length = (lengths[spanIndex] ?? 0) + 1;
      const addedCount = (addedCounts[spanIndex] ?? 0) + (span[spanIndex]?.added ? 1 : 0);
      lengths[rowIndex] = length;
      addedCounts[rowIndex] = addedCount;
      const startLine = file[fileIndex - length + 1]?.lineNumber ?? null;
      const endLine = fileLine?.lineNumber ?? null;
      if (addedCount > best.length
        || (addedCount === best.length && addedCount > 0 && startLine !== null
          && (best.startLine === null || startLine < best.startLine
            || (startLine === best.startLine && endLine !== null
              && (best.endLine === null || endLine > best.endLine))))) {
        best = { length: addedCount, startLine, endLine };
        if (best.length === totalAdded) {
          return best;
        }
      }
    }
  }

  return best;
}

export function matchHunk(
  h: Pick<Hunk, 'added' | 'removed'> & { span?: Array<{ text: string; added: boolean }> },
  fileText: string | null,
  t: MatchThresholds = DEFAULT_THRESHOLDS,
): HunkMatch {
  if (fileText === null) {
    return { ratio: 0, existence: 'gone', startLine: null, endLine: null };
  }

  const added = normalizedLines(h.added);
  const file = normalizedFileLines(fileText);
  const span = h.span
    ?.map((line) => ({ text: normalizeLine(line.text), added: line.added }))
    .filter((line) => line.text.length > 0);
  const spanAdded = span?.filter((line) => line.added).length ?? 0;

  if (span !== undefined && spanAdded > 0) {
    const best = bestSpanRun(span, file, spanAdded);
    const ratio = best.length / spanAdded;
    return {
      ratio,
      existence: classify(ratio, t),
      startLine: best.startLine,
      endLine: best.endLine,
    };
  }

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
