import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const templatePath = resolve(repoRoot, 'src/app/card.html');
const outputPath = resolve(repoRoot, 'dist/app/review-list.html');
const marker = '/*__CARD_SCRIPT__*/';

const result = await build({
  entryPoints: [resolve(repoRoot, 'src/app/card.ts')],
  bundle: true,
  format: 'iife',
  minify: true,
  platform: 'browser',
  write: false,
});
const script = result.outputFiles[0]?.text;
if (!script) throw new Error('esbuild 沒有產生卡片程式碼');

const escapedScript = script.replace(/<\/script/gi, '<\\/script');
const template = await readFile(templatePath, 'utf8');
if (!template.includes(marker)) throw new Error('卡片 HTML 缺少 script 標記');

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, template.replace(marker, () => escapedScript), 'utf8');
