import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface TestRepo {
  dir: string;
  write(path: string, content: string): void;
  remove(path: string): void;
  git(...args: string[]): string;
  commit(msg: string): string;
  cleanup(): void;
}

function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return env;
}

export function makeRepo(
  opts: { dirName?: string; initialCommit?: boolean } = {},
): TestRepo {
  const tempRoot = mkdtempSync(join(tmpdir(), 'inloop-'));
  const dir = join(tempRoot, opts.dirName ?? 'inloop repo 測試');
  mkdirSync(dir, { recursive: true });

  const git = (...args: string[]): string => execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    env: gitEnv(),
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();

  git('init', '-b', 'main');
  git('config', 'user.name', 'InLoop Test');
  git('config', 'user.email', 'inloop@example.test');
  git('config', 'core.autocrlf', 'false');

  const repo: TestRepo = {
    dir,
    write(path, content) {
      const target = join(dir, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf8');
    },
    remove(path) {
      unlinkSync(join(dir, path));
    },
    git,
    commit(msg) {
      git('add', '-A');
      git('commit', '-m', msg);
      return git('rev-parse', 'HEAD');
    },
    cleanup() {
      rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5 });
    },
  };

  if (opts.initialCommit ?? true) {
    repo.write('README.md', '# Test repository\n');
    repo.commit('initial commit');
  }

  return repo;
}
