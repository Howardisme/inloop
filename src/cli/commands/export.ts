import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { RepoContext } from '../../repo.js';
import { renderReviewMarkdown } from '../../service/markdown.js';
import { selectScope } from '../../service/review.js';
import { sync } from '../../sync/sync.js';

export function exportCommand(
  context: RepoContext,
  format: 'md' | 'json',
  outputFile: string | undefined,
  cwd: string,
  out: (value: string) => void,
): void {
  const views = selectScope(sync(context.store, context.git).views, { kind: 'all' }, context.git);
  const content = format === 'json'
    ? JSON.stringify(views, null, 2)
    : renderReviewMarkdown(views);
  if (outputFile === undefined) {
    out(content);
    return;
  }
  writeFileSync(resolve(cwd, outputFile), content, 'utf8');
  out(`已匯出到 ${outputFile}`);
}