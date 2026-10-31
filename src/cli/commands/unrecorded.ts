import { formatUnrecorded } from '../../mcp/format.js';
import type { RepoContext } from '../../repo.js';
import { findUnrecorded } from '../../sync/sync.js';

export function unrecordedCommand(
  context: RepoContext,
  markManual: boolean,
  out: (value: string) => void,
): void {
  const hunks = findUnrecorded(context.store, context.git);
  if (markManual) {
    for (const hunk of hunks) context.store.markManual(hunk.file, hunk.fingerprint);
  }
  const marked = markManual ? `\n已將 ${hunks.length} 筆標記為手動修改。` : '';
  out(`${formatUnrecorded(hunks)}${marked}`);
}