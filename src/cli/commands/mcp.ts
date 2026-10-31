import { readFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

import { createServer } from '../../mcp/server.js';

function appHtml(): string {
  try {
    return readFileSync(new URL('../../app/review-list.html', import.meta.url), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return '<!doctype html><html lang="zh-Hant"><body>卡片尚未建置，請先執行 npm run build。</body></html>';
  }
}

export async function mcpCommand(repoPath: string, cwd: string): Promise<void> {
  const server = createServer({ repoPath, cwd, appHtml });
  await server.connect(new StdioServerTransport());
}