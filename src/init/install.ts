import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import type { CliIo } from '../cli/run.js';
import type { Git } from '../git/git.js';
import { INSTRUCTIONS } from './instructions.js';

export interface InitOptions {
  mcp: 'user' | 'workspace' | 'none';
  instructions: 'user' | 'repo' | 'none';
  hooks: boolean;
  paths?: { vscodeUserDir?: string; copilotHome?: string };
}

const HOOK_NAMES = ['pre-commit', 'post-commit', 'post-rewrite', 'pre-push'] as const;
const HOOK_START = '# >>> inloop >>>';
const HOOK_END = '# <<< inloop <<<';
const INSTRUCTION_START = '<!-- >>> inloop >>> -->';
const INSTRUCTION_END = '<!-- <<< inloop <<< -->';
const PROMPT_CONTENT = `---\napplyTo: '**'\n---\n# InLoop\n\n${INSTRUCTIONS}\n`;

export function vscodeUserDir(): string {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Code', 'User');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Code', 'User');
  }
  return join(homedir(), '.config', 'Code', 'User');
}

function forwardSlashes(value: string): string {
  return value.replaceAll('\\', '/');
}

function read(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function appendBlock(
  path: string,
  start: string,
  end: string,
  body: string,
  metadata: (eof: 'newline' | 'none') => string,
): boolean {
  const current = read(path) ?? '';
  if (current.includes(start)) return false;
  const eof = current.length > 0 && !current.endsWith('\n') ? 'none' : 'newline';
  const separator = eof === 'none' ? '\n' : '';
  write(path, `${current}${separator}${start}\n${metadata(eof)}\n${body}\n${end}\n`);
  return true;
}

function removeBlock(path: string, start: string, end: string, noEofMarker: string): boolean {
  const current = read(path);
  if (current === null) return false;
  const startAt = current.indexOf(start);
  if (startAt < 0) return false;
  const endAt = current.indexOf(end, startAt + start.length);
  if (endAt < 0) return false;
  let after = endAt + end.length;
  if (current.slice(after, after + 2) === '\r\n') after += 2;
  else if (current[after] === '\n') after += 1;
  let before = current.slice(0, startAt);
  const block = current.slice(startAt, after);
  if (block.includes(noEofMarker) && before.endsWith('\n')) before = before.slice(0, -1);
  write(path, before + current.slice(after));
  return true;
}

function hookDir(git: Git): string {
  const configured = git.run(['rev-parse', '--git-path', 'hooks']);
  return isAbsolute(configured) ? configured : resolve(git.root, configured);
}

function installHooks(git: Git, cliPath: string, io: CliIo): void {
  const directory = hookDir(git);
  mkdirSync(directory, { recursive: true });
  const executable = forwardSlashes(process.execPath);
  const cli = forwardSlashes(resolve(cliPath));
  for (const name of HOOK_NAMES) {
    const path = join(directory, name);
    if (read(path) === null) write(path, '#!/bin/sh\n');
    const changed = appendBlock(
      path,
      HOOK_START,
      HOOK_END,
      `"${executable}" "${cli}" hook ${name} "$@"`,
      (eof) => `# inloop-eof: ${eof}`,
    );
    if (process.platform !== 'win32') chmodSync(path, 0o755);
    if (changed) io.out(`已更新 git hook：${path}`);
  }
}

function uninstallHooks(git: Git, io: CliIo): void {
  for (const name of HOOK_NAMES) {
    const path = join(hookDir(git), name);
    if (!removeBlock(path, HOOK_START, HOOK_END, '# inloop-eof: none')) continue;
    const remaining = read(path) ?? '';
    if (/^#!\/bin\/sh\r?\n?$/.test(remaining)) rmSync(path, { force: true });
    io.out(`已移除 git hook：${path}`);
  }
}

function stripJsonc(input: string): string {
  let output = '';
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] as string;
    const next = input[index + 1];
    if (lineComment) {
      if (char === '\n') {
        lineComment = false;
        output += char;
      }
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      } else if (char === '\n') output += '\n';
      continue;
    }
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
    } else if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
    } else if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
    } else {
      output += char;
    }
  }

  let cleaned = '';
  inString = false;
  escaped = false;
  for (let index = 0; index < output.length; index += 1) {
    const char = output[index] as string;
    if (inString) {
      cleaned += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      cleaned += char;
      continue;
    }
    if (char === ',') {
      let lookahead = index + 1;
      while (/\s/.test(output[lookahead] ?? '')) lookahead += 1;
      if (output[lookahead] === '}' || output[lookahead] === ']') continue;
    }
    cleaned += char;
  }
  return cleaned;
}

interface McpDocument {
  [key: string]: unknown;
  servers?: Record<string, unknown>;
}

function parseMcp(content: string): McpDocument {
  const parsed = JSON.parse(stripJsonc(content)) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('設定內容必須是物件');
  }
  const document = parsed as McpDocument;
  if (document.servers !== undefined
    && (document.servers === null || typeof document.servers !== 'object'
      || Array.isArray(document.servers))) {
    throw new Error('servers 必須是物件');
  }
  return document;
}

function mcpEntry(cliPath: string): Record<string, unknown> {
  return {
    type: 'stdio',
    command: process.execPath,
    args: [resolve(cliPath), 'mcp', '--repo', '${workspaceFolder}'],
  };
}

function installMcp(path: string, cliPath: string, io: CliIo): void {
  const current = read(path);
  let document: McpDocument;
  try {
    document = current === null ? {} : parseMcp(current);
  } catch {
    io.err(`無法解析 ${path}，不會覆寫；請手動加入：${JSON.stringify({ servers: { inloop: mcpEntry(cliPath) } })}`);
    return;
  }
  document.servers ??= {};
  document.servers.inloop = mcpEntry(cliPath);
  if (current !== null) {
    const backup = `${path}.inloop-bak`;
    if (!existsSync(backup)) {
      copyFileSync(path, backup);
      io.out(`已備份 MCP 設定：${backup}`);
    }
  }
  write(path, `${JSON.stringify(document, null, 2)}\n`);
  io.out(`已更新 MCP 設定：${path}`);
}

function uninstallMcp(path: string, io: CliIo): void {
  const current = read(path);
  if (current === null) return;
  let document: McpDocument;
  try {
    document = parseMcp(current);
  } catch {
    io.err(`無法解析 ${path}，未移除 InLoop 設定。`);
    return;
  }
  if (document.servers?.inloop === undefined) return;
  delete document.servers.inloop;
  write(path, `${JSON.stringify(document, null, 2)}\n`);
  io.out(`已移除 MCP 設定：${path}`);
}

function installPrompt(path: string, io: CliIo): void {
  const current = read(path);
  if (current !== null && current !== PROMPT_CONTENT) {
    io.err(`${path} 已存在，不會覆寫；請手動加入 InLoop instructions。`);
    return;
  }
  if (current === PROMPT_CONTENT) return;
  write(path, PROMPT_CONTENT);
  io.out(`已寫入 instructions：${path}`);
}

function installInstructionBlock(path: string, io: CliIo): void {
  const changed = appendBlock(
    path,
    INSTRUCTION_START,
    INSTRUCTION_END,
    INSTRUCTIONS,
    (eof) => `<!-- inloop-eof: ${eof} -->`,
  );
  if (changed) io.out(`已更新 instructions：${path}`);
}

function uninstallInstructions(git: Git, userDir: string, copilotHome: string, io: CliIo): void {
  const promptPath = join(userDir, 'prompts', 'inloop.instructions.md');
  if (read(promptPath) === PROMPT_CONTENT) {
    rmSync(promptPath, { force: true });
    io.out(`已移除 instructions：${promptPath}`);
  }
  for (const path of [
    join(copilotHome, 'copilot-instructions.md'),
    join(git.root, '.github', 'copilot-instructions.md'),
  ]) {
    if (removeBlock(path, INSTRUCTION_START, INSTRUCTION_END, '<!-- inloop-eof: none -->')) {
      if ((read(path) ?? '') === '') rmSync(path, { force: true });
      io.out(`已移除 instructions：${path}`);
    }
  }
}

function userPaths(opts: Pick<InitOptions, 'paths'>): { userDir: string; copilotHome: string } {
  return {
    userDir: opts.paths?.vscodeUserDir ?? vscodeUserDir(),
    copilotHome: opts.paths?.copilotHome ?? join(homedir(), '.copilot'),
  };
}

export function init(git: Git, cliPath: string, opts: InitOptions, io: CliIo): void {
  const paths = userPaths(opts);
  if (opts.hooks) installHooks(git, cliPath, io);
  if (opts.mcp === 'user') installMcp(join(paths.userDir, 'mcp.json'), cliPath, io);
  else if (opts.mcp === 'workspace') installMcp(join(git.root, '.vscode', 'mcp.json'), cliPath, io);

  if (opts.instructions === 'user') {
    installPrompt(join(paths.userDir, 'prompts', 'inloop.instructions.md'), io);
    installInstructionBlock(join(paths.copilotHome, 'copilot-instructions.md'), io);
  } else if (opts.instructions === 'repo') {
    installInstructionBlock(join(git.root, '.github', 'copilot-instructions.md'), io);
  }
}

export function uninstall(
  git: Git,
  opts: Pick<InitOptions, 'paths'>,
  io: CliIo,
): void {
  const paths = userPaths(opts);
  uninstallHooks(git, io);
  uninstallMcp(join(paths.userDir, 'mcp.json'), io);
  uninstallMcp(join(git.root, '.vscode', 'mcp.json'), io);
  uninstallInstructions(git, paths.userDir, paths.copilotHome, io);
}
