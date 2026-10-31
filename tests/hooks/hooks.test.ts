import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';

import { runCli, type CliIo } from '../../src/cli/run.js';
import { postCommit, postRewrite, preCommit, prePush } from '../../src/hooks/hooks.js';
import { init } from '../../src/init/install.js';
import { openRepo, type RepoContext } from '../../src/repo.js';
import { makeRepo, type TestRepo } from '../helpers/repo.js';
import { seedChange } from '../helpers/seed.js';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const cliPath = join(repoRoot, 'dist', 'cli', 'main.js');
const repos: TestRepo[] = [];

beforeAll(() => {
  if (!existsSync(cliPath)) {
    execFileSync('npm', ['run', 'build'], { cwd: repoRoot, shell: true, stdio: 'pipe' });
  }
});

afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
});

function setup(): { repo: TestRepo; ctx: RepoContext } {
  const repo = makeRepo({ dirName: 'inloop hooks 中文 測試' });
  repos.push(repo);
  return { repo, ctx: openRepo(repo.dir) };
}

function capture(cwd: string): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { out: (s) => out.push(s), err: (s) => err.push(s), cwd, env: {}, stdin: async () => '' },
  };
}

function recordChineseFile(repo: TestRepo, ctx: RepoContext): number {
  repo.write('src/中文.ts', 'export const answer = 42;\n');
  return seedChange(ctx.store, ctx.git, { files: ['src/中文.ts'] }).id;
}

describe('git hooks', () => {
  test('post-commit links records', () => {
    const { repo, ctx } = setup();
    const id = recordChineseFile(repo, ctx);
    repo.commit('加入中文檔案');

    expect(postCommit(ctx, capture(repo.dir).io)).toBe(0);
    expect(ctx.store.getChange(id)?.commitSha).toBe(repo.git('rev-parse', 'HEAD'));
    ctx.store.close();
  });

  test('post-rewrite updates sha after amend and ignores extra fields', () => {
    const { repo, ctx } = setup();
    const id = recordChineseFile(repo, ctx);
    const oldSha = repo.commit('加入中文檔案');
    postCommit(ctx, capture(repo.dir).io);
    repo.git('commit', '--amend', '-m', '修正訊息');
    const newSha = repo.git('rev-parse', 'HEAD');

    expect(postRewrite(ctx, capture(repo.dir).io, `${oldSha} ${newSha} ignored\n`)).toBe(0);
    expect(ctx.store.getChange(id)?.commitSha).toBe(newSha);
    ctx.store.close();
  });

  test('hook command accepts the post-rewrite type argument', async () => {
    const { repo, ctx } = setup();
    const id = recordChineseFile(repo, ctx);
    const oldSha = repo.commit('加入中文檔案');
    postCommit(ctx, capture(repo.dir).io);
    repo.git('commit', '--amend', '-m', '修正訊息');
    const newSha = repo.git('rev-parse', 'HEAD');
    ctx.store.close();
    const captured = capture(repo.dir);
    captured.io.stdin = async () => `${oldSha} ${newSha} ignored\n`;

    expect(await runCli(['hook', 'post-rewrite', 'amend'], captured.io)).toBe(0);
    const reopened = openRepo(repo.dir);
    try {
      expect(reopened.store.getChange(id)?.commitSha).toBe(newSha);
    } finally {
      reopened.store.close();
    }
  });

  test('pre-commit reminds but never blocks', () => {
    const { repo, ctx } = setup();
    recordChineseFile(repo, ctx);
    repo.git('add', 'src/中文.ts');
    const captured = capture(repo.dir);

    expect(preCommit(ctx, captured.io)).toBe(0);
    expect(captured.out.join('\n')).toContain('1 筆');
    expect(captured.out.join('\n')).toContain('測試改動');
    ctx.store.close();
  });

  test('pre-push blocks only when configured', () => {
    const { repo, ctx } = setup();
    recordChineseFile(repo, ctx);
    const remoteSha = repo.git('rev-parse', 'HEAD');
    const localSha = repo.commit('加入中文檔案');
    postCommit(ctx, capture(repo.dir).io);
    const stdin = `refs/heads/main ${localSha} refs/heads/main ${remoteSha}\n`;

    expect(prePush(ctx, capture(repo.dir).io, stdin)).toBe(0);
    repo.git('config', 'inloop.prePush', 'block');
    expect(prePush(ctx, capture(repo.dir).io, stdin)).toBe(1);
    expect(prePush(ctx, capture(repo.dir).io,
      `refs/heads/main ${'0'.repeat(40)} refs/heads/main ${remoteSha}\n`)).toBe(0);
    ctx.store.close();
  });

  test('pre-push handles a new remote branch', () => {
    const { repo, ctx } = setup();
    recordChineseFile(repo, ctx);
    const localSha = repo.commit('加入中文檔案');
    postCommit(ctx, capture(repo.dir).io);
    repo.git('config', 'inloop.prePush', 'block');

    expect(prePush(ctx, capture(repo.dir).io,
      `refs/heads/topic ${localSha} refs/heads/topic ${'0'.repeat(40)}\n`)).toBe(1);
    ctx.store.close();
  });

  test('hook command warns and exits zero when repository setup fails', async () => {
    const { repo, ctx } = setup();
    ctx.store.close();
    const captured = capture(join(repo.dir, 'missing directory'));

    expect(await runCli(['hook', 'pre-commit'], captured.io)).toBe(0);
    expect(captured.err).toHaveLength(1);
    expect(captured.err[0]).toContain('InLoop hook 警告：');
  });
  test('installed hooks run end-to-end', () => {
    const { repo, ctx } = setup();
    const id = recordChineseFile(repo, ctx);
    init(ctx.git, cliPath, { mcp: 'none', instructions: 'none', hooks: true }, capture(repo.dir).io);
    ctx.store.close();

    const sha = repo.commit('透過實際 hook 連結');
    const reopened = openRepo(repo.dir);
    try {
      expect(reopened.store.getChange(id)?.commitSha).toBe(sha);
    } finally {
      reopened.store.close();
    }
  });
});
