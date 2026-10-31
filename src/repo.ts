import { openGit, type Git } from './git/git.js';
import { openStore, storePathFor } from './store/store.js';
import type { Store } from './store/types.js';

export interface RepoContext {
  git: Git;
  store: Store;
}

function usable(value: string | undefined): value is string {
  return value !== undefined && value.length > 0 && !value.includes('${');
}

export function resolveRepoPath(
  argv: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
): string {
  const index = argv.indexOf('--repo');
  const argument = index === -1 ? undefined : argv[index + 1];
  if (usable(argument)) return argument;
  if (usable(env.INLOOP_REPO)) return env.INLOOP_REPO;
  return cwd;
}

export function openRepo(path: string): RepoContext {
  const git = openGit(path);
  return { git, store: openStore(storePathFor(git)) };
}
