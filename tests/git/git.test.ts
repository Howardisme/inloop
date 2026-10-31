import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { fingerprint } from '../../src/core/diff.js';
import { NotARepoError, openGit, PathEscapeError } from '../../src/git/git.js';
import { makeRepo, type TestRepo } from '../helpers/repo.js';

const repos: TestRepo[] = [];

function repo(opts?: Parameters<typeof makeRepo>[0]): TestRepo {
  const created = makeRepo(opts);
  repos.push(created);
  return created;
}

afterEach(() => {
  for (const created of repos.splice(0)) {
    created.cleanup();
  }
});

describe('Git', () => {
  it('diffWorkingTree sees modified, staged and untracked files', () => {
    const testRepo = repo();
    testRepo.write('modified.ts', 'before\n');
    testRepo.commit('add tracked file');
    testRepo.write('modified.ts', 'after\n');
    testRepo.write('staged.ts', 'staged\n');
    testRepo.git('add', 'staged.ts');
    testRepo.write('src/中文.ts', '第一行\n第二行\n');

    const git = openGit(testRepo.dir);
    const diffs = new Map(git.diffWorkingTree().map((file) => [file.newPath ?? file.oldPath, file]));

    expect(diffs.get('modified.ts')).toMatchObject({ status: 'modified', binary: false });
    expect(diffs.get('staged.ts')).toMatchObject({ status: 'added', binary: false });
    expect(diffs.get('src/中文.ts')).toMatchObject({
      oldPath: null,
      newPath: 'src/中文.ts',
      status: 'added',
      binary: false,
      hunks: [{
        file: 'src/中文.ts',
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 2,
        added: ['第一行', '第二行'],
        removed: [],
        contextBefore: [],
        contextAfter: [],
        fingerprint: fingerprint(['第一行', '第二行']),
      }],
    });
  });

  it('filters working-tree diffs and skips binary files', () => {
    const testRepo = repo();
    testRepo.write('one.ts', 'one\n');
    testRepo.write('two.ts', 'two\n');
    testRepo.write('binary.dat', 'text\0binary');

    const git = openGit(testRepo.dir);

    expect(git.diffWorkingTree().map((file) => file.newPath).sort()).toEqual(['one.ts', 'two.ts']);
    expect(git.diffWorkingTree(['one.ts']).map((file) => file.newPath)).toEqual(['one.ts']);
    expect(git.diffWorkingTree([])).toEqual([]);
  });

  it('works before first commit', () => {
    const testRepo = repo({ initialCommit: false });
    testRepo.write('first.ts', 'first\n');
    testRepo.git('add', 'first.ts');
    testRepo.write('second.ts', 'second\n');
    const git = openGit(testRepo.dir);

    expect(git.headSha()).toBeNull();
    expect(git.stagedFiles()).toEqual(['first.ts']);
    expect(git.diffWorkingTree().map((file) => file.newPath).sort()).toEqual([
      'first.ts',
      'second.ts',
    ]);
  });

  it('renameMap follows git mv then edit', () => {
    const testRepo = repo();
    testRepo.write('a.ts', 'line one\nline two\nline three\n');
    const beforeRename = testRepo.commit('add a');
    testRepo.git('mv', 'a.ts', 'b.ts');
    testRepo.commit('rename a to b');
    testRepo.git('mv', 'b.ts', 'c.ts');
    testRepo.write('c.ts', 'line one\nline two edited\nline three\n');

    expect(openGit(testRepo.dir).renameMap(beforeRename).get('a.ts')).toBe('c.ts');
  });

  it('renameMap includes working-tree renames when sinceSha is null', () => {
    const testRepo = repo();
    testRepo.write('old.ts', 'line one\nline two\n');
    testRepo.commit('add old');
    testRepo.git('mv', 'old.ts', 'new.ts');

    expect(openGit(testRepo.dir).renameMap(null).get('old.ts')).toBe('new.ts');
  });

  it('renameMap tolerates unknown sinceSha', () => {
    const testRepo = repo();

    expect(openGit(testRepo.dir).renameMap(
      '0123456789abcdef0123456789abcdef01234567',
    )).toBeInstanceOf(Map);
  });

  it('resolvePath rejects escapes', () => {
    const testRepo = repo();
    const git = openGit(testRepo.dir);

    expect(() => git.resolvePath('../x')).toThrow(
      new PathEscapeError('路徑超出 repository 範圍：../x'),
    );
    expect(() => git.resolvePath(resolve(testRepo.dir, '..', 'outside.ts'))).toThrow(PathEscapeError);
    expect(() => git.resolvePath(testRepo.dir)).toThrow(PathEscapeError);
    expect(git.resolvePath(join(testRepo.dir, 'src', 'a.ts'))).toBe('src/a.ts');
    expect(git.resolvePath('src\\nested\\a.ts')).toBe('src/nested/a.ts');
  });

  it('openGit outside repo throws NotARepoError', () => {
    const outside = mkdtempSync(join(tmpdir(), 'inloop-outside-'));
    try {
      expect(() => openGit(outside)).toThrow(
        new NotARepoError(`不是 git repository：${outside}`),
      );
    } finally {
      rmSync(outside, { recursive: true, force: true, maxRetries: 5 });
    }
  });

  it('currentBranch null when detached', () => {
    const testRepo = repo();
    testRepo.git('checkout', '--detach', 'HEAD');

    expect(openGit(testRepo.dir).currentBranch()).toBeNull();
  });

  it('provides repository metadata and commit queries', () => {
    const testRepo = repo();
    testRepo.write('src/query.ts', 'query\n');
    const sha = testRepo.commit('add query');
    const git = openGit(join(testRepo.dir, 'src'));

    expect(git.root).toBe(resolve(testRepo.dir));
    expect(git.commonDir).toBe(resolve(testRepo.dir, '.git'));
    expect(git.currentBranch()).toBe('main');
    expect(git.headSha()).toBe(sha);
    expect(git.changedFilesInCommit(sha)).toEqual(['src/query.ts']);
    expect(git.commitsReachableFromHead(1)).toEqual(new Set([sha]));
    expect(git.commitTime(sha)).toBeInstanceOf(Date);
    expect(git.commitTime('missing-ref')).toBeNull();
    expect(git.config('user.name')).toBe('InLoop Test');
    expect(git.config('missing.key')).toBeNull();
  });

  it('reads working-tree files and reports staged paths', () => {
    const testRepo = repo();
    testRepo.write('src/staged.ts', 'content\n');
    testRepo.git('add', 'src/staged.ts');
    const git = openGit(testRepo.dir);

    expect(git.stagedFiles()).toEqual(['src/staged.ts']);
    expect(git.readFile('src/staged.ts')).toBe('content\n');
    expect(git.readFile('missing.ts')).toBeNull();
    expect(() => git.readFile('../outside.ts')).toThrow(PathEscapeError);
  });

  it('does not inherit hook-specific git environment variables', () => {
    const testRepo = repo();
    const previous = {
      GIT_DIR: process.env.GIT_DIR,
      GIT_WORK_TREE: process.env.GIT_WORK_TREE,
      GIT_INDEX_FILE: process.env.GIT_INDEX_FILE,
    };
    process.env.GIT_DIR = 'invalid-git-dir';
    process.env.GIT_WORK_TREE = 'invalid-work-tree';
    process.env.GIT_INDEX_FILE = 'invalid-index';

    try {
      expect(openGit(testRepo.dir).currentBranch()).toBe('main');
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it('caches commits reachable from HEAD on one Git object', () => {
    const testRepo = repo();
    const git = openGit(testRepo.dir);
    const first = git.commitsReachableFromHead();
    testRepo.write('later.ts', 'later\n');
    const laterSha = testRepo.commit('later commit');

    expect(git.commitsReachableFromHead()).toBe(first);
    expect(first.has(laterSha)).toBe(false);
  });

  it('run includes stderr on failure and allowFail returns stdout', () => {
    const testRepo = repo();
    const git = openGit(testRepo.dir);

    const failed = spawnSync('git', ['-c', 'core.quotepath=off', 'show', 'missing-ref'], {
      cwd: testRepo.dir,
      encoding: 'utf8',
    });
    expect(() => git.run(['show', 'missing-ref'])).toThrow(
      new Error(`git show missing-ref 執行失敗：${failed.stderr}`),
    );
    expect(git.run(['rev-parse', '--verify', 'missing-ref'], { allowFail: true })).toBe('');
    expect(git.run(['hash-object', '--stdin'], { input: 'test\n' })).toBe(
      '9daeafb9864cf43055ae93beb0afd6c7d144bfa4',
    );
  });
});
