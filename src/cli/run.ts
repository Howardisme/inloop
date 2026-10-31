import { parseArgs } from 'node:util';

import { openRepo, resolveRepoPath, type RepoContext } from '../repo.js';
import { confirmCommand } from './commands/confirm.js';
import { deleteCommand } from './commands/delete.js';
import { exportCommand } from './commands/export.js';
import { listCommand } from './commands/list.js';
import { mcpCommand } from './commands/mcp.js';
import { prCommand } from './commands/pr.js';
import { showCommand } from './commands/show.js';
import { syncCommand } from './commands/sync.js';
import { unrecordedCommand } from './commands/unrecorded.js';
import { whyCommand } from './commands/why.js';

export interface CliIo {
  out(s: string): void;
  err(s: string): void;
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin(): Promise<string>;
}

const USAGE = [
  '用法：inloop [--repo <路徑>] <指令>',
  '指令：list、show、why、confirm、export、pr、sync、unrecorded、delete、mcp',
].join('\n');

class UsageError extends Error {}

type PreparedCommand =
  | { kind: 'repo'; run(context: RepoContext): void | Promise<void> }
  | { kind: 'mcp'; repoPath: string };

function positiveId(value: string | undefined): number {
  const id = Number(value);
  if (value === undefined || !Number.isInteger(id) || id <= 0) {
    throw new UsageError('紀錄編號必須是正整數。');
  }
  return id;
}

function expectPositionals(positionals: string[], count: number): void {
  if (positionals.length !== count) {
    throw new UsageError('指令參數數量不正確。');
  }
}

function stripRepo(argv: string[]): { args: string[]; repoPath: string | undefined } {
  const args: string[] = [];
  let repoPath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index] as string;
    if (value !== '--repo') {
      args.push(value);
      continue;
    }
    const next = argv[index + 1];
    if (repoPath !== undefined || next === undefined || next.startsWith('--')) {
      throw new UsageError('--repo 需要一個路徑，且只能指定一次。');
    }
    repoPath = next;
    index += 1;
  }
  return { args, repoPath };
}

function prepare(argv: string[], io: CliIo): PreparedCommand {
  const stripped = stripRepo(argv);
  const [command, ...args] = stripped.args;
  if (command === undefined) throw new UsageError('缺少指令。');

  switch (command) {
    case 'list': {
      const parsed = parseArgs({
        args,
        options: { scope: { type: 'string' } },
        allowPositionals: true,
      });
      expectPositionals(parsed.positionals, 0);
      return { kind: 'repo', run: (context) => listCommand(context, parsed.values.scope, io.out) };
    }
    case 'show': {
      const parsed = parseArgs({ args, options: {}, allowPositionals: true });
      expectPositionals(parsed.positionals, 1);
      const id = positiveId(parsed.positionals[0]);
      return { kind: 'repo', run: (context) => showCommand(context, id, io.out) };
    }
    case 'why': {
      const parsed = parseArgs({ args, options: {}, allowPositionals: true });
      expectPositionals(parsed.positionals, 1);
      return { kind: 'repo', run: (context) => whyCommand(context, parsed.positionals[0] as string, io.out) };
    }
    case 'confirm': {
      const parsed = parseArgs({
        args,
        options: {
          note: { type: 'string' },
          verdict: { type: 'string', default: 'confirmed' },
        },
        allowPositionals: true,
      });
      if (parsed.positionals.length === 0) throw new UsageError('confirm 至少需要一個紀錄編號。');
      const verdict = parsed.values.verdict;
      if (verdict !== 'confirmed' && verdict !== 'incorrect' && verdict !== 'unimportant') {
        throw new UsageError('--verdict 必須是 confirmed、incorrect 或 unimportant。');
      }
      const ids = parsed.positionals.map(positiveId);
      return {
        kind: 'repo',
        run: (context) => confirmCommand(context, ids, verdict, parsed.values.note, io.out),
      };
    }
    case 'export': {
      const parsed = parseArgs({
        args,
        options: {
          format: { type: 'string', default: 'md' },
          out: { type: 'string' },
        },
        allowPositionals: true,
      });
      expectPositionals(parsed.positionals, 0);
      if (parsed.values.format !== 'md' && parsed.values.format !== 'json') {
        throw new UsageError('--format 必須是 md 或 json。');
      }
      const format = parsed.values.format;
      return {
        kind: 'repo',
        run: (context) => exportCommand(
          context,
          format,
          parsed.values.out,
          io.cwd,
          io.out,
        ),
      };
    }
    case 'pr': {
      const parsed = parseArgs({
        args,
        options: { base: { type: 'string' } },
        allowPositionals: true,
      });
      expectPositionals(parsed.positionals, 0);
      return { kind: 'repo', run: (context) => prCommand(context, parsed.values.base, io.out) };
    }
    case 'sync': {
      const parsed = parseArgs({ args, options: {}, allowPositionals: true });
      expectPositionals(parsed.positionals, 0);
      return { kind: 'repo', run: (context) => syncCommand(context, io.out) };
    }
    case 'unrecorded': {
      const parsed = parseArgs({
        args,
        options: { 'mark-manual': { type: 'boolean', default: false } },
        allowPositionals: true,
      });
      expectPositionals(parsed.positionals, 0);
      return {
        kind: 'repo',
        run: (context) => unrecordedCommand(context, parsed.values['mark-manual'], io.out),
      };
    }
    case 'delete': {
      const parsed = parseArgs({
        args,
        options: { yes: { type: 'boolean', default: false } },
        allowPositionals: true,
      });
      expectPositionals(parsed.positionals, 1);
      const id = positiveId(parsed.positionals[0]);
      return { kind: 'repo', run: (context) => deleteCommand(context, id, parsed.values.yes, io.out) };
    }
    case 'mcp': {
      const parsed = parseArgs({ args, options: {}, allowPositionals: true });
      expectPositionals(parsed.positionals, 0);
      return { kind: 'mcp', repoPath: stripped.repoPath ?? '' };
    }
    default:
      throw new UsageError(`未知指令：${command}`);
  }
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  let command: PreparedCommand;
  try {
    command = prepare(argv, io);
  } catch (error) {
    if (error instanceof UsageError || error instanceof TypeError) {
      const detail = error instanceof UsageError ? `${error.message}\n` : '';
      io.err(`${detail}${USAGE}`);
      return 2;
    }
    throw error;
  }

  if (command.kind === 'mcp') {
    try {
      await mcpCommand(command.repoPath, io.cwd);
      return 0;
    } catch (error) {
      io.err(`執行失敗：${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  }

  let context: RepoContext | undefined;
  try {
    context = openRepo(resolveRepoPath(argv, io.env, io.cwd));
    await command.run(context);
    return 0;
  } catch (error) {
    io.err(`執行失敗：${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    context?.store.close();
  }
}