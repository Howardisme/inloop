export const migrations: readonly string[] = [
  `
    CREATE TABLE changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      key_point TEXT NOT NULL,
      what_how TEXT NOT NULL,
      why TEXT NOT NULL,
      should_know TEXT NOT NULL,
      core_diff TEXT NOT NULL,
      branch TEXT,
      base_head TEXT,
      client TEXT,
      model TEXT,
      created_at TEXT NOT NULL,
      commit_sha TEXT
    );

    CREATE TABLE change_versions (
      change_id INTEGER NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      key_point TEXT NOT NULL,
      what_how TEXT NOT NULL,
      why TEXT NOT NULL,
      should_know TEXT NOT NULL,
      core_diff TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (change_id, version)
    );

    CREATE TABLE hunks (
      change_id INTEGER NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      file TEXT NOT NULL,
      old_start INTEGER NOT NULL,
      new_start INTEGER NOT NULL,
      added TEXT NOT NULL,
      removed TEXT NOT NULL,
      context_before TEXT NOT NULL,
      context_after TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      PRIMARY KEY (change_id, position)
    );

    CREATE TABLE supersedes (
      change_id INTEGER NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
      supersedes_id INTEGER NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
      PRIMARY KEY (change_id, supersedes_id)
    );

    CREATE TABLE reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      change_id INTEGER NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
      change_version INTEGER NOT NULL,
      verdict TEXT NOT NULL,
      note TEXT NOT NULL,
      source TEXT NOT NULL,
      snapshot_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE manual_hunks (
      file TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      PRIMARY KEY (file, fingerprint)
    );

    CREATE TABLE status_cache (
      change_id INTEGER PRIMARY KEY REFERENCES changes(id) ON DELETE CASCADE,
      status TEXT NOT NULL
    );
  `,
  `ALTER TABLE hunks ADD COLUMN span TEXT`,
];
