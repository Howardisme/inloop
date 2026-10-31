#!/usr/bin/env node
import '../suppress-warnings.js';

import { runCli, type CliIo } from './run.js';

const realIo: CliIo = {
  out: (value) => process.stdout.write(`${value}\n`),
  err: (value) => process.stderr.write(`${value}\n`),
  cwd: process.cwd(),
  env: process.env,
  async stdin() {
    let input = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) input += chunk;
    return input;
  },
};

process.exitCode = await runCli(process.argv.slice(2), realIo);