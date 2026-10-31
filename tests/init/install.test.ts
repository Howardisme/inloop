import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import type { CliIo } from '../../src/cli/run.js';
import { openGit } from '../../src/git/git.js';
import { init, uninstall } from '../../src/init/install.js';
import { INSTRUCTIONS } from '../../src/init/instructions.js';
import { makeRepo, type TestRepo } from '../helpers/repo.js';

const repos: TestRepo[] = [];

afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
});

function setup(): { repo: TestRepo; paths: { vscodeUserDir: string; copilotHome: string } } {
  const repo = makeRepo({ dirName: 'inloop init 中文 測試' });
  repos.push(repo);
  return {
    repo,
    paths: {
      vscodeUserDir: join(repo.dir, 'fake user', 'Code User'),
      copilotHome: join(repo.dir, 'fake user', '.copilot'),
    },
  };
}

function capture(cwd: string): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { out: (s) => out.push(s), err: (s) => err.push(s), cwd, env: {}, stdin: async () => '' },
  };
}

describe('init and uninstall', () => {
  test('keeps existing hook and uninstall restores it byte-for-byte', () => {
    const { repo, paths } = setup();
    const git = openGit(repo.dir);
    const hooksDir = git.run(['rev-parse', '--git-path', 'hooks']);
    const hookPath = join(repo.dir, hooksDir, 'pre-commit');
    const original = '#!/bin/sh\n. "$(dirname "$0")/_/husky.sh"\necho 中文';
    writeFileSync(hookPath, original, 'utf8');
    const io = capture(repo.dir);

    init(git, 'C:\\Program Files\\InLoop 中文\\dist\\cli\\main.js', {
      mcp: 'none', instructions: 'none', hooks: true, paths,
    }, io.io);

    const installed = readFileSync(hookPath, 'utf8');
    expect(installed.startsWith(`${original}\n`)).toBe(true);
    expect(installed).toContain('# >>> inloop >>>');
    expect(installed).toContain(`"${process.execPath.replaceAll('\\', '/')}" "C:/Program Files/InLoop 中文/dist/cli/main.js" hook pre-commit "$@"`);
    expect(installed).not.toContain('\r\n');
    if (process.platform !== 'win32') expect(statSync(hookPath).mode & 0o777).toBe(0o755);

    uninstall(git, { paths }, io.io);
    expect(readFileSync(hookPath, 'utf8')).toBe(original);
    expect(io.out.join('\n')).toContain('pre-commit');
  });

  test('warns when an existing hook exits before the appended block', () => {
    const { repo, paths } = setup();
    const git = openGit(repo.dir);
    const hooksDir = git.run(['rev-parse', '--git-path', 'hooks']);
    const hookPath = join(repo.dir, hooksDir, 'pre-commit');
    writeFileSync(hookPath, '#!/bin/sh\nexec other-hook\n', 'utf8');
    const captured = capture(repo.dir);
    const cliPath = 'C:\\Program Files\\InLoop 中文\\dist\\cli\\main.js';

    init(git, cliPath, {
      mcp: 'none', instructions: 'none', hooks: true, paths,
    }, captured.io);

    const hookLine = `"${process.execPath.replaceAll('\\', '/')}" "C:/Program Files/InLoop 中文/dist/cli/main.js" hook pre-commit "$@"`;
    expect(captured.out).toContain(
      `注意：${hookPath} 在 InLoop 區塊前有 exec/exit，InLoop hook 可能不會執行；請手動把下面這行移到前面：${hookLine}`,
    );
  });

  test('merges into commented mcp.json without corrupting URL strings', () => {
    const { repo, paths } = setup();
    const git = openGit(repo.dir);
    const mcpPath = join(paths.vscodeUserDir, 'mcp.json');
    repo.write('fake user/Code User/mcp.json', `{
  // keep this server
  "homepage": "https://example.test/path//still-string",
  "servers": {
    "other": { "type": "stdio", "command": "other", },
  },
}\n`);
    const original = readFileSync(mcpPath, 'utf8');

    const captured = capture(repo.dir);
    init(git, 'D:\\inloop\\dist\\cli\\main.js', {
      mcp: 'user', instructions: 'none', hooks: false, paths,
    }, captured.io);

    expect(captured.out).toContain(
      '注意：' + mcpPath + ' 原本的註解已移除，原檔備份在 ' + mcpPath + '.inloop-bak。',
    );
    const parsed = JSON.parse(readFileSync(mcpPath, 'utf8')) as Record<string, unknown> & {
      servers: Record<string, unknown>;
    };
    expect(parsed.homepage).toBe('https://example.test/path//still-string');
    expect(parsed.servers.other).toEqual({ type: 'stdio', command: 'other' });
    expect(parsed.servers.inloop).toEqual({
      type: 'stdio',
      command: process.execPath,
      args: ['D:\\inloop\\dist\\cli\\main.js', 'mcp', '--repo', '${workspaceFolder}'],
    });
    expect(readFileSync(`${mcpPath}.inloop-bak`, 'utf8')).toBe(original);

    uninstall(git, { paths }, capture(repo.dir).io);
    const after = JSON.parse(readFileSync(mcpPath, 'utf8')) as { servers: Record<string, unknown> };
    expect(after.servers.other).toEqual({ type: 'stdio', command: 'other' });
    expect(after.servers.inloop).toBeUndefined();
  });

  test('does not clobber unparsable mcp.json', () => {
    const { repo, paths } = setup();
    const git = openGit(repo.dir);
    const mcpPath = join(paths.vscodeUserDir, 'mcp.json');
    repo.write('fake user/Code User/mcp.json', '{ definitely broken');
    const original = readFileSync(mcpPath, 'utf8');
    const captured = capture(repo.dir);

    init(git, 'D:\\inloop\\dist\\cli\\main.js', {
      mcp: 'user', instructions: 'none', hooks: false, paths,
    }, captured.io);

    expect(readFileSync(mcpPath, 'utf8')).toBe(original);
    expect(existsSync(`${mcpPath}.inloop-bak`)).toBe(false);
    expect(captured.err.join('\n')).toContain('手動');
    expect(captured.err.join('\n')).toContain('"servers"');
    expect(captured.err.join('\n')).toContain('"inloop"');
  });

  test('writes user instructions to both locations and uninstall removes only its content', () => {
    const { repo, paths } = setup();
    const git = openGit(repo.dir);
    const copilotPath = join(paths.copilotHome, 'copilot-instructions.md');
    repo.write('fake user/.copilot/copilot-instructions.md', '# Existing instructions');
    const io = capture(repo.dir);

    init(git, 'D:\\inloop\\dist\\cli\\main.js', {
      mcp: 'none', instructions: 'user', hooks: false, paths,
    }, io.io);

    const promptPath = join(paths.vscodeUserDir, 'prompts', 'inloop.instructions.md');
    expect(readFileSync(promptPath, 'utf8')).toBe(
      `---\napplyTo: '**'\n---\n# InLoop\n\n${INSTRUCTIONS}\n`,
    );
    expect(readFileSync(copilotPath, 'utf8')).toContain('<!-- >>> inloop >>> -->');
    expect(readFileSync(copilotPath, 'utf8')).toContain(INSTRUCTIONS);

    uninstall(git, { paths }, io.io);
    expect(existsSync(promptPath)).toBe(false);
    expect(readFileSync(copilotPath, 'utf8')).toBe('# Existing instructions');
    expect(io.out.join('\n')).toContain('inloop.instructions.md');
  });

  test('does not overwrite an unmanaged instructions file', () => {
    const { repo, paths } = setup();
    const git = openGit(repo.dir);
    const promptPath = join(paths.vscodeUserDir, 'prompts', 'inloop.instructions.md');
    repo.write('fake user/Code User/prompts/inloop.instructions.md', 'personal content\n');
    const captured = capture(repo.dir);

    init(git, 'D:\\inloop\\dist\\cli\\main.js', {
      mcp: 'none', instructions: 'user', hooks: false, paths,
    }, captured.io);

    expect(readFileSync(promptPath, 'utf8')).toBe('personal content\n');
    expect(captured.err.join('\n')).toContain('不會覆寫');
  });
});
