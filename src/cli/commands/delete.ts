import type { RepoContext } from '../../repo.js';

export function deleteCommand(
  context: RepoContext,
  id: number,
  confirmed: boolean,
  out: (value: string) => void,
): void {
  if (!confirmed) throw new Error(`刪除 #${id} 需要明確加上 --yes。`);
  if (context.store.getChange(id) === null) throw new Error(`找不到紀錄 #${id}`);
  context.store.deleteChange(id);
  out(`已刪除 #${id}。`);
}