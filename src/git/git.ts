import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { fingerprint, parseUnifiedDiff, type FileDiff } from '../core/diff.js';

const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const MAX_BUFFER = 64 * 1024 * 1024;

export class NotARepoError extends Error {}
export class PathEscapeError extends Error {}

export interface Git {
  root: string;
  commonDir: string;
  run(args: string[], opts?: { input?: string; allowFail?: boolean }): string;
  headSha(): string | null;
  currentBranch(): string | null;
  diffWorkingTree(paths?: string[]): FileDiff[];
  stagedFiles(): string[];
  readFile(path: string): string | null;
  changedFilesInCommit(sha: string): string[];
  commitsReachableFromHead(max?: number): Set<string>;
  commitTime(ref: string): Date | null;
  renameMap(sinceSha: string | null): Map<string, string>;
  resolvePath(input: string): string;
  config(key: string): string | null;
}

interface RunOptions {
  input?: string;
  allowFail?: boolean;
}

interface RunResult {
  stdout: string;
  ok: boolean;
}

function cleanGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return env;
}

function execute(cwd: string, args: string[], opts: RunOptions = {}): RunResult {
  const result = spawnSync('git', ['-c', 'core.quotepath=off', ...args], {
    cwd,
    encoding: 'utf8',
    env: cleanGitEnv(),
    input: opts.input,
    maxBuffer: MAX_BUFFER,
  });

  if (result.error) {
    if (opts.allowFail) {
      return { stdout: result.stdout ?? '', ok: false };
    }
    throw new Error(`git ${args.join(' ')} 執行失敗：${result.error.message}`);
  }

  if (result.status !== 0) {
    if (opts.allowFail) {
      return { stdout: result.stdout, ok: false };
    }
    throw new Error(`git ${args.join(' ')} 執行失敗：${result.stderr}`);
  }

  return { stdout: result.stdout, ok: true };
}

function nulList(output: string): string[] {
  return output.split('\0').filter((value) => value.length > 0);
}

function addRenames(map: Map<string, string>, output: string): void {
  const fields = nulList(output);
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const status = fields[index]?.trimStart() ?? '';
    const oldPath = fields[index + 1];
    const newPath = fields[index + 2];
    if (!status.startsWith('R') || oldPath === undefined || newPath === undefined) {
      continue;
    }

    for (const [source, current] of map) {
      if (current === oldPath) {
        map.set(source, newPath);
      }
    }
    map.set(oldPath, newPath);
  }
}

class CliGit implements Git {
  readonly root: string;
  readonly commonDir: string;
  private readonly reachableCache = new Map<number, Set<string>>();

  constructor(root: string) {
    this.root = root;
    const commonDir = this.run(['rev-parse', '--git-common-dir']);
    this.commonDir = path.resolve(root, commonDir);
  }

  run(args: string[], opts: RunOptions = {}): string {
    return execute(this.root, args, opts).stdout.trim();
  }

  headSha(): string | null {
    const result = execute(this.root, ['rev-parse', '--verify', 'HEAD'], { allowFail: true });
    return result.ok ? result.stdout.trim() : null;
  }

  currentBranch(): string | null {
    const result = execute(this.root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
      allowFail: true,
    });
    return result.ok ? result.stdout.trim() : null;
  }

  diffWorkingTree(paths?: string[]): FileDiff[] {
    if (paths !== undefined && paths.length === 0) {
      return [];
    }
    const requestedPaths = paths?.map((value) => this.resolvePath(value));
    const base = this.headSha() === null ? EMPTY_TREE_SHA : 'HEAD';
    const pathArgs = ['--', ...(requestedPaths ?? [])];
    const tracked = execute(
      this.root,
      ['diff', '--no-color', '--no-ext-diff', '-M', '-U3', base, ...pathArgs],
    ).stdout;
    const diffs = parseUnifiedDiff(tracked).filter((file) => !file.binary);

    const untracked = execute(this.root, [
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
      ...pathArgs,
    ]).stdout;

    for (const file of nulList(untracked)) {
      const absolutePath = path.join(this.root, ...file.split('/'));
      const contents = readFileSync(absolutePath);
      if (contents.includes(0)) {
        continue;
      }
      const text = contents.toString('utf8').replaceAll('\r', '');
      const lines = text.split('\n');
      if (lines.at(-1) === '') {
        lines.pop();
      }
      diffs.push({
        oldPath: null,
        newPath: file,
        status: 'added',
        binary: false,
        hunks: [{
          file,
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: lines.length,
          added: lines,
          removed: [],
          contextBefore: [],
          contextAfter: [],
          fingerprint: fingerprint(lines),
        }],
      });
    }

    return diffs;
  }

  stagedFiles(): string[] {
    const base = this.headSha() === null ? [EMPTY_TREE_SHA] : [];
    return nulList(execute(this.root, ['diff', '--cached', '--name-only', '-z', ...base]).stdout);
  }

  readFile(input: string): string | null {
    const relativePath = this.resolvePath(input);
    try {
      return readFileSync(path.join(this.root, ...relativePath.split('/')), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  changedFilesInCommit(sha: string): string[] {
    return nulList(execute(this.root, [
      'diff-tree',
      '--root',
      '--no-commit-id',
      '--name-only',
      '-r',
      '-z',
      sha,
    ]).stdout);
  }

  commitsReachableFromHead(max = 5000): Set<string> {
    const cached = this.reachableCache.get(max);
    if (cached) {
      return cached;
    }
    const head = this.headSha();
    const commits = head === null
      ? new Set<string>()
      : new Set(this.run(['rev-list', `--max-count=${max}`, 'HEAD']).split('\n').filter(Boolean));
    this.reachableCache.set(max, commits);
    return commits;
  }

  commitTime(ref: string): Date | null {
    const result = execute(this.root, ['show', '-s', '--format=%cI', ref], { allowFail: true });
    if (!result.ok) {
      return null;
    }
    const date = new Date(result.stdout.trim());
    return Number.isNaN(date.getTime()) ? null : date;
  }

  renameMap(sinceSha: string | null): Map<string, string> {
    const renames = new Map<string, string>();
    const head = this.headSha();
    if (head === null) {
      return renames;
    }

    if (sinceSha !== null) {
      addRenames(renames, execute(this.root, [
        'log',
        '-M',
        '--name-status',
        '-z',
        '--diff-filter=R',
        '--format=',
        '--reverse',
        `${sinceSha}..HEAD`,
      ]).stdout);
    }
    addRenames(renames, execute(this.root, [
      'diff',
      '-M',
      '--name-status',
      '-z',
      '--diff-filter=R',
      'HEAD',
    ]).stdout);
    return renames;
  }

  resolvePath(input: string): string {
    const normalizedInput = input.replace(/[\\/]+/g, path.sep);
    const absolutePath = path.resolve(this.root, normalizedInput);
    const rootForComparison = process.platform === 'win32' ? this.root.toLowerCase() : this.root;
    const pathForComparison = process.platform === 'win32'
      ? absolutePath.toLowerCase()
      : absolutePath;
    const rootPrefix = rootForComparison.endsWith(path.sep)
      ? rootForComparison
      : `${rootForComparison}${path.sep}`;

    if (pathForComparison === rootForComparison || !pathForComparison.startsWith(rootPrefix)) {
      throw new PathEscapeError(`路徑超出 repository 範圍：${input}`);
    }

    return path.relative(this.root, absolutePath).split(path.sep).join('/');
  }

  config(key: string): string | null {
    const result = execute(this.root, ['config', '--get', key], { allowFail: true });
    return result.ok ? result.stdout.trim() : null;
  }
}

export function openGit(cwd: string): Git {
  const result = execute(path.resolve(cwd), ['rev-parse', '--show-toplevel'], { allowFail: true });
  if (!result.ok) {
    throw new NotARepoError(`不是 git repository：${cwd}`);
  }
  return new CliGit(path.resolve(result.stdout.trim()));
}
