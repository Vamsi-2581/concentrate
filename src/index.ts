#!/usr/bin/env node

import { runCli } from "./adapters/cli/args.js";
import { program } from "./program.js";

try {
  const exitCode = await runCli(program, process.argv.slice(2));
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
} catch (error) {
  // Query, lock and store errors are messages for the user; the stack is for debugging.
  console.error(process.env.CONCENTRATE_DEBUG === "1" || !(error instanceof Error) ? error : `error: ${error.message}`);
  process.exitCode = 1;
}
