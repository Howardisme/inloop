import type { CliIo } from '../cli/run.js';
import type { RepoContext } from '../repo.js';
import { parseScope, selectScope } from '../service/review.js';
import { findUnrecorded, sync } from '../sync/sync.js';

const ZERO_SHA = /^0+$/;

function lines(input: string): string[][] {
  return input.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/));
}

function pending(ctx: RepoContext, files?: string[]) {
  return selectScope(sync(ctx.store, ctx.git, { files }).views, parseScope('pending'), ctx.git);
}

function printPending(io: CliIo, heading: string, views: ReturnType<typeof pending>): void {
  io.out(`${heading}：${views.length} 筆`);
  for (const view of views) io.out(`- #${view.id} ${view.title}`);
}

export function preCommit(ctx: RepoContext, io: CliIo): number {
  const stagedFiles = ctx.git.stagedFiles();
  const synced = sync(ctx.store, ctx.git, { files: stagedFiles }).views;
  const views = selectScope(synced, parseScope('pending'), ctx.git);
  const unrecorded = findUnrecorded(ctx.store, ctx.git, stagedFiles, synced);
  printPending(io, '這次 commit 涵蓋的未 review 紀錄', views);
  io.out(`未記錄的改動：${unrecorded.length} 筆`);
  return 0;
}

export function postCommit(ctx: RepoContext, io: CliIo): number {
  void io;
  const head = ctx.git.headSha();
  if (head === null) return 0;
  const files = ctx.git.changedFilesInCommit(head);
  const ids = sync(ctx.store, ctx.git, { files }).views
    .filter((view) => view.commitSha === null
      && (view.existence === 'present' || view.existence === 'partial'))
    .map((view) => view.id);
  ctx.store.linkCommit(ids, head);
  return 0;
}

export function postRewrite(ctx: RepoContext, io: CliIo, stdin: string): number {
  void io;
  const pairs = lines(stdin).flatMap((fields): Array<[string, string]> => {
    const [oldSha, newSha] = fields;
    return oldSha === undefined || newSha === undefined ? [] : [[oldSha, newSha]];
  });
  ctx.store.rewriteCommits(pairs);
  return 0;
}

export function prePush(ctx: RepoContext, io: CliIo, stdin: string): number {
  const commits = new Set<string>();
  for (const fields of lines(stdin)) {
    const localSha = fields[1];
    const remoteSha = fields[3];
    if (localSha === undefined || remoteSha === undefined || ZERO_SHA.test(localSha)) continue;
    const args = ZERO_SHA.test(remoteSha)
      ? ['rev-list', localSha, '--not', '--remotes']
      : ['rev-list', localSha, `^${remoteSha}`];
    for (const sha of ctx.git.run(args).split(/\r?\n/).filter(Boolean)) commits.add(sha);
  }

  const views = pending(ctx).filter((view) =>
    view.commitSha !== null && commits.has(view.commitSha));
  printPending(io, '即將 push 的未 review 紀錄', views);
  return ctx.git.config('inloop.prePush') === 'block' && views.length > 0 ? 1 : 0;
}
