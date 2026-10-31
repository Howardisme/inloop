import type { RepoContext } from '../../repo.js';
import { renderPrSection } from '../../service/markdown.js';
import { sync } from '../../sync/sync.js';

function resolveBase(context: RepoContext, requested: string | undefined): string {
  const candidates = requested === undefined ? ['origin/HEAD', 'main', 'master'] : [requested];
  const base = candidates.find((candidate) => context.git.commitTime(candidate) !== null);
  if (base === undefined) {
    throw new Error('找不到可用的 base branch，請用 --base <ref> 指定。');
  }
  return base;
}

export function prCommand(
  context: RepoContext,
  requestedBase: string | undefined,
  out: (value: string) => void,
): void {
  const base = resolveBase(context, requestedBase);
  const commits = new Set(context.git.run(['rev-list', `${base}..HEAD`]).split('\n').filter(Boolean));
  const branch = context.git.currentBranch();
  const views = sync(context.store, context.git).views.filter((view) =>
    (view.commitSha !== null && commits.has(view.commitSha))
    || (view.commitSha === null && view.branch === branch));
  out(renderPrSection(views));
}