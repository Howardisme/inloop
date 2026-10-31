import type { CliIo } from '../run.js';
import { postCommit, postRewrite, preCommit, prePush } from '../../hooks/hooks.js';
import type { RepoContext } from '../../repo.js';

export type HookName = 'pre-commit' | 'post-commit' | 'post-rewrite' | 'pre-push';

export function isHookName(value: string | undefined): value is HookName {
  return value === 'pre-commit' || value === 'post-commit'
    || value === 'post-rewrite' || value === 'pre-push';
}

export function hookCommand(
  context: RepoContext,
  name: HookName,
  stdin: string,
  io: CliIo,
): number {
  try {
    switch (name) {
      case 'pre-commit': return preCommit(context, io);
      case 'post-commit': return postCommit(context, io);
      case 'post-rewrite': return postRewrite(context, io, stdin);
      case 'pre-push': return prePush(context, io, stdin);
    }
  } catch (error) {
    io.err(`InLoop hook 警告：${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
}
