export type ShouldKnowKind = 'concept' | 'risk' | 'shortcut';

export interface ShouldKnow {
  kind: ShouldKnowKind;
  text: string;
}

export interface ChangeContent {
  title: string;
  keyPoint: string;
  whatHow: string;
  why: string;
  shouldKnow: ShouldKnow[];
  coreDiff: string;
}

export interface StoredHunk {
  file: string;
  oldStart: number;
  newStart: number;
  added: string[];
  removed: string[];
  span?: Array<{ text: string; added: boolean }>;
  contextBefore: string[];
  contextAfter: string[];
  fingerprint: string;
}

export interface NewChange extends ChangeContent {
  hunks: StoredHunk[];
  supersedes: number[];
  branch: string | null;
  baseHead: string | null;
  client: string | null;
  model: string | null;
}

export interface ChangeRow extends NewChange {
  id: number;
  version: number;
  createdAt: string;
  commitSha: string | null;
}

export type Verdict = 'confirmed' | 'incorrect' | 'unimportant';
export type ReviewSource = 'card' | 'form' | 'cli';

export interface ReviewRow {
  id: number;
  changeId: number;
  changeVersion: number;
  verdict: Verdict;
  note: string;
  source: ReviewSource;
  snapshotHash: string;
  createdAt: string;
}

export interface Store {
  insertChange(c: NewChange): ChangeRow;
  amendChange(id: number, patch: Partial<ChangeContent>): ChangeRow;
  getChange(id: number): ChangeRow | null;
  listChanges(): ChangeRow[];
  getVersions(id: number): Array<ChangeContent & { version: number; createdAt: string }>;
  addReview(r: Omit<ReviewRow, 'id' | 'createdAt'>): ReviewRow;
  latestReview(changeId: number): ReviewRow | null;
  reviews(changeId: number): ReviewRow[];
  linkCommit(changeIds: number[], sha: string): number;
  rewriteCommits(pairs: Array<[oldSha: string, newSha: string]>): number;
  markManual(file: string, fingerprint: string): void;
  isManual(file: string, fingerprint: string): boolean;
  getStatusCache(): Map<number, string>;
  putStatusCache(m: Map<number, string>): void;
  deleteChange(id: number): void;
  close(): void;
}
