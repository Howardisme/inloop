import type { RepoContext } from '../../repo.js';
import { formatWhy, whyQuery } from '../../service/why.js';

export function whyCommand(
  context: RepoContext,
  target: string,
  out: (value: string) => void,
): void {
  const matched = /^(.*):(\d+)$/.exec(target);
  const file = matched?.[1] ?? target;
  const line = matched === null ? undefined : Number(matched[2]);
  if (file.length === 0 || line === 0) throw new Error('查詢目標必須是 file 或 file:line。');
  out(formatWhy(whyQuery(context.store, context.git, file, line)));
}