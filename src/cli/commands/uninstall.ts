import type { CliIo } from '../run.js';
import type { Git } from '../../git/git.js';
import { uninstall } from '../../init/install.js';

export function uninstallCommand(git: Git, io: CliIo): void {
  uninstall(git, {}, io);
}
