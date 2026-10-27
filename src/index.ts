#!/usr/bin/env node

import { runCli } from "./adapters/cli/args.js";
import { program } from "./program.js";

const exitCode = await runCli(program, process.argv.slice(2));
if (exitCode !== 0) {
  process.exitCode = exitCode;
}
