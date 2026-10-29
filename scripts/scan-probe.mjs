// Preloaded with `node --import ./scripts/scan-probe.mjs dist/index.js ...` by
// scripts/bench-release.ts: on exit, writes the process's peak resident set
// size to the file named by CONCENTRATE_PROBE_OUT, so the benchmark can read a
// child CLI's memory without an outside tool.
import { writeFileSync } from "node:fs";

const output = process.env.CONCENTRATE_PROBE_OUT;
if (output) {
  process.on("exit", () => {
    // maxRSS is in kilobytes.
    writeFileSync(output, JSON.stringify({ maxRssKb: process.resourceUsage().maxRSS }));
  });
}
