import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import type { Git } from '../git/git.js';
import { migrations } from './migrations.js';
import type {
  ChangeContent,
  ChangeRow,
  NewChange,
  ReviewRow,
  ReviewSource,
  ShouldKnow,
  Store,
  StoredHunk,
  Verdict,
} from './types.js';

interface ChangeDbRow {
  id: number;
  version: number;
  title: string;
  key_point: string;
  what_how: string;
  why: string;
  should_know: string;
  core_diff: string;
  branch: string | null;
  base_head: string | null;
  client: string | null;
  model: string | null;
  created_at: string;
  commit_sha: string | null;
}

interface HunkDbRow {
  file: string;
  old_start: number;
  new_start: number;
  added: string;
  removed: string;
  context_before: string;
  context_after: string;
  fingerprint: string;
}

interface VersionDbRow {
  version: number;
  title: string;
  key_point: string;
  what_how: string;
  why: string;
  should_know: string;
  core_diff: string;
  created_at: string;
}

interface ReviewDbRow {
  id: number;
  change_id: number;
  change_version: number;
  verdict: string;
  note: string;
  source: string;
  snapshot_hash: string;
  created_at: string;
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function contentFromRow(row: ChangeDbRow | VersionDbRow): ChangeContent {
  return {
    title: row.title,
    keyPoint: row.key_point,
    whatHow: row.what_how,
    why: row.why,
    shouldKnow: parseJson<ShouldKnow[]>(row.should_know),
    coreDiff: row.core_diff,
  };
}

function hunkFromRow(row: HunkDbRow): StoredHunk {
  return {
    file: row.file,
    oldStart: row.old_start,
    newStart: row.new_start,
    added: parseJson<string[]>(row.added),
    removed: parseJson<string[]>(row.removed),
    contextBefore: parseJson<string[]>(row.context_before),
    contextAfter: parseJson<string[]>(row.context_after),
    fingerprint: row.fingerprint,
  };
}

function reviewFromRow(row: ReviewDbRow): ReviewRow {
  return {
    id: row.id,
    changeId: row.change_id,
    changeVersion: row.change_version,
    verdict: row.verdict as Verdict,
    note: row.note,
    source: row.source as ReviewSource,
    snapshotHash: row.snapshot_hash,
    createdAt: row.created_at,
  };
}

class SqliteStore implements Store {
  constructor(private readonly db: DatabaseSync) {}

  private write<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private hunks(changeId: number): StoredHunk[] {
    const rows = this.db.prepare(`
      SELECT file, old_start, new_start, added, removed, context_before, context_after, fingerprint
      FROM hunks WHERE change_id = ? ORDER BY position
    `).all(changeId) as unknown as HunkDbRow[];
    return rows.map(hunkFromRow);
  }

  private supersedes(changeId: number): number[] {
    const rows = this.db.prepare(`
      SELECT supersedes_id FROM supersedes WHERE change_id = ? ORDER BY rowid
    `).all(changeId) as unknown as Array<{ supersedes_id: number }>;
    return rows.map((row) => row.supersedes_id);
  }

  private changeFromRow(
    row: ChangeDbRow,
    hunks = this.hunks(row.id),
    supersedes = this.supersedes(row.id),
  ): ChangeRow {
    return {
      ...contentFromRow(row),
      id: row.id,
      version: row.version,
      hunks,
      supersedes,
      branch: row.branch,
      baseHead: row.base_head,
      client: row.client,
      model: row.model,
      createdAt: row.created_at,
      commitSha: row.commit_sha,
    };
  }

  private selectChange(id: number): ChangeRow | null {
    const row = this.db.prepare('SELECT * FROM changes WHERE id = ?').get(id) as
      | ChangeDbRow
      | undefined;
    return row === undefined ? null : this.changeFromRow(row);
  }

  insertChange(change: NewChange): ChangeRow {
    return this.write(() => {
      const createdAt = new Date().toISOString();
      const result = this.db.prepare(`
        INSERT INTO changes (
          version, title, key_point, what_how, why, should_know, core_diff,
          branch, base_head, client, model, created_at, commit_sha
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(
        change.title,
        change.keyPoint,
        change.whatHow,
        change.why,
        JSON.stringify(change.shouldKnow),
        change.coreDiff,
        change.branch,
        change.baseHead,
        change.client,
        change.model,
        createdAt,
      );
      const id = Number(result.lastInsertRowid);
      const insertHunk = this.db.prepare(`
        INSERT INTO hunks (
          change_id, position, file, old_start, new_start, added, removed,
          context_before, context_after, fingerprint
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      change.hunks.forEach((hunk, position) => {
        insertHunk.run(
          id,
          position,
          hunk.file,
          hunk.oldStart,
          hunk.newStart,
          JSON.stringify(hunk.added),
          JSON.stringify(hunk.removed),
          JSON.stringify(hunk.contextBefore),
          JSON.stringify(hunk.contextAfter),
          hunk.fingerprint,
        );
      });
      const insertSupersedes = this.db.prepare(
        'INSERT INTO supersedes (change_id, supersedes_id) VALUES (?, ?)',
      );
      change.supersedes.forEach((supersededId) => insertSupersedes.run(id, supersededId));
      return this.selectChange(id) as ChangeRow;
    });
  }

  amendChange(id: number, patch: Partial<ChangeContent>): ChangeRow {
    return this.write(() => {
      const current = this.selectChange(id);
      if (current === null) {
        throw new Error(`找不到紀錄 #${id}`);
      }
      this.db.prepare(`
        INSERT INTO change_versions (
          change_id, version, title, key_point, what_how, why,
          should_know, core_diff, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        current.version,
        current.title,
        current.keyPoint,
        current.whatHow,
        current.why,
        JSON.stringify(current.shouldKnow),
        current.coreDiff,
        current.createdAt,
      );
      const next = { ...current, ...patch };
      const createdAt = new Date().toISOString();
      this.db.prepare(`
        UPDATE changes SET version = ?, title = ?, key_point = ?, what_how = ?, why = ?,
          should_know = ?, core_diff = ?, created_at = ? WHERE id = ?
      `).run(
        current.version + 1,
        next.title,
        next.keyPoint,
        next.whatHow,
        next.why,
        JSON.stringify(next.shouldKnow),
        next.coreDiff,
        createdAt,
        id,
      );
      return this.selectChange(id) as ChangeRow;
    });
  }

  getChange(id: number): ChangeRow | null {
    return this.selectChange(id);
  }

  listChanges(): ChangeRow[] {
    const rows = this.db.prepare('SELECT * FROM changes ORDER BY id').all() as unknown as ChangeDbRow[];
    if (rows.length === 0) return [];

    const hunkRows = this.db.prepare(`
      SELECT change_id, file, old_start, new_start, added, removed,
        context_before, context_after, fingerprint
      FROM hunks ORDER BY change_id, position
    `).all() as unknown as Array<HunkDbRow & { change_id: number }>;
    const hunks = new Map<number, StoredHunk[]>();
    for (const row of hunkRows) {
      const values = hunks.get(row.change_id) ?? [];
      values.push(hunkFromRow(row));
      hunks.set(row.change_id, values);
    }

    const supersedeRows = this.db.prepare(`
      SELECT change_id, supersedes_id FROM supersedes ORDER BY change_id, rowid
    `).all() as unknown as Array<{ change_id: number; supersedes_id: number }>;
    const supersedes = new Map<number, number[]>();
    for (const row of supersedeRows) {
      const values = supersedes.get(row.change_id) ?? [];
      values.push(row.supersedes_id);
      supersedes.set(row.change_id, values);
    }

    return rows.map((row) => this.changeFromRow(
      row,
      hunks.get(row.id) ?? [],
      supersedes.get(row.id) ?? [],
    ));
  }

  getVersions(id: number): Array<ChangeContent & { version: number; createdAt: string }> {
    const rows = this.db.prepare(`
      SELECT version, title, key_point, what_how, why, should_know, core_diff, created_at
      FROM change_versions WHERE change_id = ? ORDER BY version
    `).all(id) as unknown as VersionDbRow[];
    return rows.map((row) => ({
      ...contentFromRow(row),
      version: row.version,
      createdAt: row.created_at,
    }));
  }

  addReview(review: Omit<ReviewRow, 'id' | 'createdAt'>): ReviewRow {
    return this.write(() => {
      const createdAt = new Date().toISOString();
      const result = this.db.prepare(`
        INSERT INTO reviews (
          change_id, change_version, verdict, note, source, snapshot_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        review.changeId,
        review.changeVersion,
        review.verdict,
        review.note,
        review.source,
        review.snapshotHash,
        createdAt,
      );
      return {
        ...review,
        id: Number(result.lastInsertRowid),
        createdAt,
      };
    });
  }

  latestReview(changeId: number): ReviewRow | null {
    const row = this.db.prepare(`
      SELECT * FROM reviews WHERE change_id = ? ORDER BY id DESC LIMIT 1
    `).get(changeId) as ReviewDbRow | undefined;
    return row === undefined ? null : reviewFromRow(row);
  }

  reviews(changeId: number): ReviewRow[] {
    const rows = this.db.prepare(`
      SELECT * FROM reviews WHERE change_id = ? ORDER BY id
    `).all(changeId) as unknown as ReviewDbRow[];
    return rows.map(reviewFromRow);
  }

  linkCommit(changeIds: number[], sha: string): number {
    if (changeIds.length === 0) return 0;
    return this.write(() => {
      const placeholders = changeIds.map(() => '?').join(', ');
      const result = this.db.prepare(`
        UPDATE changes SET commit_sha = ?
        WHERE commit_sha IS NULL AND id IN (${placeholders})
      `).run(sha, ...changeIds);
      return Number(result.changes);
    });
  }

  rewriteCommits(pairs: Array<[oldSha: string, newSha: string]>): number {
    if (pairs.length === 0) return 0;
    return this.write(() => {
      const cases = pairs.map(() => 'WHEN ? THEN ?').join(' ');
      const oldPlaceholders = pairs.map(() => '?').join(', ');
      const values: SQLInputValue[] = pairs.flatMap(([oldSha, newSha]) => [oldSha, newSha]);
      const oldShas = pairs.map(([oldSha]) => oldSha);
      const result = this.db.prepare(`
        UPDATE changes SET commit_sha = CASE commit_sha ${cases} ELSE commit_sha END
        WHERE commit_sha IN (${oldPlaceholders})
      `).run(...values, ...oldShas);
      return Number(result.changes);
    });
  }

  markManual(file: string, fingerprint: string): void {
    this.write(() => {
      this.db.prepare(`
        INSERT OR IGNORE INTO manual_hunks (file, fingerprint) VALUES (?, ?)
      `).run(file, fingerprint);
    });
  }

  isManual(file: string, fingerprint: string): boolean {
    return this.db.prepare(`
      SELECT 1 FROM manual_hunks WHERE file = ? AND fingerprint = ?
    `).get(file, fingerprint) !== undefined;
  }

  getStatusCache(): Map<number, string> {
    const rows = this.db.prepare(`
      SELECT change_id, status FROM status_cache ORDER BY change_id
    `).all() as unknown as Array<{ change_id: number; status: string }>;
    return new Map(rows.map((row) => [row.change_id, row.status]));
  }

  putStatusCache(statuses: Map<number, string>): void {
    if (statuses.size === 0) return;
    this.write(() => {
      const upsert = this.db.prepare(`
        INSERT INTO status_cache (change_id, status) VALUES (?, ?)
        ON CONFLICT(change_id) DO UPDATE SET status = excluded.status
      `);
      for (const [changeId, status] of statuses) {
        upsert.run(changeId, status);
      }
    });
  }

  deleteChange(id: number): void {
    this.write(() => {
      this.db.prepare('DELETE FROM changes WHERE id = ?').run(id);
    });
  }

  close(): void {
    this.db.close();
  }
}

function migrate(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
    for (let index = row.user_version; index < migrations.length; index += 1) {
      db.exec(migrations[index] as string);
      db.exec(`PRAGMA user_version = ${index + 1}`);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function openStore(dbPath: string): Store {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA journal_mode = WAL');
    migrate(db);
    return new SqliteStore(db);
  } catch (error) {
    db.close();
    throw error;
  }
}

export function storePathFor(git: Git): string {
  return join(git.commonDir, 'inloop', 'inloop.db');
}
