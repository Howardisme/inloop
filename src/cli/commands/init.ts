import { fileURLToPath } from 'node:url';

import type { CliIo } from '../run.js';
import type { Git } from '../../git/git.js';
import { init, type InitOptions } from '../../init/install.js';

const cliPath = fileURLToPath(new URL('../main.js', import.meta.url));

export function initCommand(git: Git, opts: InitOptions, io: CliIo): void {
  init(git, cliPath, opts, io);
}
