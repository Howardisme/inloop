import { createHash } from 'node:crypto';

import { normalizeLine } from '../core/diff.js';
import { classify, DEFAULT_THRESHOLDS, matchHunk } from '../core/match.js';
import type { MatchThresholds } from '../core/match.js';
import type { Git } from '../git/git.js';
import type { ChangeRow, ReviewRow, Store, StoredHunk } from '../store/types.js';

export type ExistenceStatus = 'present' | 'partial' | 'gone' | 'discarded' | 'superseded';
export type ReviewStatus =
  | 'unreviewed'
  | 'confirmed'
  | 'changed_after_confirm'
  | 'incorrect'
  | 'unimportant';

export interface Location {
  file: string;
  startLine: number | null;
  endLine: number | null;
}

export interface ChangeView extends ChangeRow {
  existence: ExistenceStatus;
  ratio: number;
  review: ReviewStatus;
  latestReview: ReviewRow | null;
  supersededBy: number | null;
  possiblySupersededBy: number | null;
  locations: Location[];
}

export interface SyncOptions {
  thresholds?: MatchThresholds;
  files?: string[];
}

export interface SyncResult {
  views: ChangeView[];
  massChange: { count: number; ids: number[] } | null;
}

export interface UnrecordedHunk {
  file: string;
  newStart: number;
  added: string[];
  removed: string[];
  fingerprint: string;
}

interface MatchedChange {
  ratio: number;
  locations: Location[];
  snapshot: string;
}

type RenameLookup = (change: ChangeRow, file: string) => string;

function renameLookup(git: Git): RenameLookup {
  const cache = new Map<string, Map<string, string>>();
  return (change, file) => {
    const key = change.baseHead ?? '';
    let renames = cache.get(key);
    if (renames === undefined) {
      renames = git.renameMap(change.baseHead);
      cache.set(key, renames);
    }
    return renames.get(file) ?? file;
  };
}

function scopedChanges(store: Store, git: Git): ChangeRow[] {
  const branch = git.currentBranch();
  const reachable = git.commitsReachableFromHead();
  return store.listChanges().filter((change) =>
    change.branch === branch
    || (change.commitSha !== null && reachable.has(change.commitSha))
  );
}

function readCached(git: Git, cache: Map<string, string | null>, file: string): string | null {
  if (!cache.has(file)) {
    cache.set(file, git.readFile(file));
  }
  return cache.get(file) ?? null;
}

function snapshotFor(
  locations: Location[],
  git: Git,
  fileCache: Map<string, string | null>,
): string {
  const sections = locations.map((location) => {
    if (location.startLine === null || location.endLine === null) {
      return '';
    }
    const text = readCached(git, fileCache, location.file);
    if (text === null) {
      return '';
    }
    return text.split(/\r?\n/).slice(location.startLine - 1, location.endLine).join('\n');
  });
  return createHash('sha1').update(sections.join('\u0000')).digest('hex');
}

function matchChange(
  change: ChangeRow,
  git: Git,
  thresholds: MatchThresholds,
  fileCache: Map<string, string | null>,
  renamedPath: RenameLookup,
): MatchedChange {
  let contribution = 0;
  let totalWeight = 0;
  const locations: Location[] = [];

  for (const hunk of change.hunks) {
    const file = renamedPath(change, hunk.file);
    const match = matchHunk(hunk, readCached(git, fileCache, file), thresholds);
    const addedWeight = hunk.added.map(normalizeLine).filter(Boolean).length;
    const weight = hunk.added.length === 0 ? 1 : addedWeight;
    contribution += match.ratio * weight;
    totalWeight += weight;
    locations.push({ file, startLine: match.startLine, endLine: match.endLine });
  }

  const ratio = totalWeight === 0 ? 1 : contribution / totalWeight;
  return {
    ratio,
    locations,
    snapshot: snapshotFor(locations, git, fileCache),
  };
}

function reviewStatus(
  change: ChangeRow,
  latestReview: ReviewRow | null,
  snapshot: string,
): ReviewStatus {
  if (latestReview === null || latestReview.changeVersion < change.version) {
    return 'unreviewed';
  }
  if (latestReview.verdict === 'confirmed' && latestReview.snapshotHash !== snapshot) {
    return 'changed_after_confirm';
  }
  return latestReview.verdict;
}

function supersededBy(changes: ChangeRow[]): Map<number, number> {
  const result = new Map<number, number>();
  for (const change of changes) {
    for (const id of change.supersedes) {
      result.set(id, Math.max(result.get(id) ?? Number.NEGATIVE_INFINITY, change.id));
    }
  }
  return result;
}

function range(hunk: StoredHunk): [number, number] {
  return [hunk.newStart, hunk.newStart + Math.max(hunk.added.length, 1) - 1];
}

function rangesOverlap(left: [number, number], right: [number, number]): boolean {
  return left[0] <= right[1] && right[0] <= left[1];
}

function possibleReplacement(
  old: ChangeRow,
  changes: ChangeRow[],
  renamedPath: RenameLookup,
): number | null {
  for (const candidate of changes) {
    if (candidate.id <= old.id) continue;
    const overlaps = old.hunks.some((oldHunk) => candidate.hunks.some((candidateHunk) =>
      renamedPath(old, oldHunk.file) === renamedPath(candidate, candidateHunk.file)
      && rangesOverlap(range(oldHunk), range(candidateHunk))
    ));
    if (overlaps) return candidate.id;
  }
  return null;
}

function selectedChanges(
  changes: ChangeRow[],
  git: Git,
  files: string[] | undefined,
  renamedPath: RenameLookup,
): ChangeRow[] {
  if (files === undefined) return changes;
  const requested = new Set(files.map((file) => git.resolvePath(file)));
  return changes.filter((change) =>
    change.hunks.some((hunk) => requested.has(renamedPath(change, hunk.file)))
  );
}

export function sync(store: Store, git: Git, opts: SyncOptions = {}): SyncResult {
  const thresholds = opts.thresholds ?? DEFAULT_THRESHOLDS;
  const allScoped = scopedChanges(store, git);
  const renamedPath = renameLookup(git);
  const changes = selectedChanges(allScoped, git, opts.files, renamedPath);
  const explicitReplacements = supersededBy(allScoped);
  const fileCache = new Map<string, string | null>();

  const views = changes.map((change): ChangeView => {
    const matched = matchChange(change, git, thresholds, fileCache, renamedPath);
    const replacement = explicitReplacements.get(change.id) ?? null;
    const classified = classify(matched.ratio, thresholds);
    const existence: ExistenceStatus = replacement !== null
      ? 'superseded'
      : classified === 'gone' && change.commitSha === null
      ? 'discarded'
      : classified;
    const latestReview = store.latestReview(change.id);
    return {
      ...change,
      existence,
      ratio: matched.ratio,
      review: reviewStatus(change, latestReview, matched.snapshot),
      latestReview,
      supersededBy: replacement,
      possiblySupersededBy: existence === 'gone'
        ? possibleReplacement(change, allScoped, renamedPath)
        : null,
      locations: matched.locations,
    };
  });

  const previous = store.getStatusCache();
  const previousPresent = views.filter((view) => {
    const status = previous.get(view.id);
    return status === 'present' || status === 'partial';
  });
  const disappeared = previousPresent
    .filter((view) => view.existence === 'gone' || view.existence === 'discarded')
    .map((view) => view.id);
  const minimum = Math.max(5, previousPresent.length * 0.3);
  const massChange = disappeared.length >= minimum
    ? { count: disappeared.length, ids: disappeared }
    : null;

  store.putStatusCache(new Map(views.map((view) => [view.id, view.existence])));
  return { views, massChange };
}

export function snapshotHash(change: ChangeRow, git: Git): string {
  const fileCache = new Map<string, string | null>();
  const renamedPath = renameLookup(git);
  return matchChange(change, git, DEFAULT_THRESHOLDS, fileCache, renamedPath).snapshot;
}

function normalized(lines: string[]): string[] {
  return lines.map(normalizeLine).filter(Boolean);
}

export function findUnrecorded(store: Store, git: Git, paths?: string[]): UnrecordedHunk[] {
  const diffs = git.diffWorkingTree(paths);
  const views = sync(store, git, { files: paths }).views
    .filter((view) => view.existence !== 'superseded');
  const additions = new Map<string, Set<string>>();
  const removals = new Map<string, Set<string>>();

  for (const view of views) {
    view.hunks.forEach((hunk, index) => {
      const file = view.locations[index]?.file ?? hunk.file;
      const added = additions.get(file) ?? new Set<string>();
      const removed = removals.get(file) ?? new Set<string>();
      normalized(hunk.added).forEach((line) => added.add(line));
      normalized(hunk.removed).forEach((line) => removed.add(line));
      additions.set(file, added);
      removals.set(file, removed);
    });
  }

  return diffs.flatMap((file) => file.hunks.filter((hunk) => {
    if (store.isManual(hunk.file, hunk.fingerprint)) return false;
    const usesAdded = hunk.added.length > 0;
    const lines = normalized(usesAdded ? hunk.added : hunk.removed);
    if (lines.length === 0) return false;
    const recorded = (usesAdded ? additions : removals).get(hunk.file) ?? new Set<string>();
    const coverage = lines.filter((line) => recorded.has(line)).length / lines.length;
    return coverage < 0.9;
  }).map((hunk) => ({
    file: hunk.file,
    newStart: hunk.newStart,
    added: hunk.added,
    removed: hunk.removed,
    fingerprint: hunk.fingerprint,
  })));
}
