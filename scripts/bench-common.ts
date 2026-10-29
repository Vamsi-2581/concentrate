/**
 * Helpers shared by the benchmark scripts: timing statistics, the sample list
 * and baseline comparison.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { readSampleManifest, samplesDirectory } from "../src/adapters/cli/smoke.js";

export type Timing = { p50: number; p95: number };

export function round(ms: number): number {
  return Math.round(ms * 100) / 100;
}

export function timing(samples: number[]): Timing {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return { p50: round(at(0.5)), p95: round(at(0.95)) };
}

export async function measure(action: () => Promise<unknown>): Promise<number> {
  const start = process.hrtime.bigint();
  await action();
  return Number(process.hrtime.bigint() - start) / 1e6;
}

// Median of `runs` runs after one warm-up (grammar loading, JIT, file cache), in whole ms.
export async function median(action: () => Promise<unknown>, runs: number): Promise<number> {
  await action();
  const times: number[] = [];
  for (let run = 0; run < runs; run += 1) times.push(await measure(action));
  times.sort((a, b) => a - b);
  return Math.round(times[Math.floor(times.length / 2)]!);
}

export type SuiteName = "standing" | "internet" | "all";

export function parseSuite(value: string | undefined): SuiteName {
  if (value !== "standing" && value !== "internet" && value !== "all") throw new Error(`Unknown suite: ${value}`);
  return value;
}

// Manifest samples of a suite that are fetched, with their paths; missing ones
// are reported on stderr and skipped.
export async function availableSamples(suite: SuiteName) {
  const samples = [];
  for (const sample of await readSampleManifest()) {
    if (suite !== "all" && sample.suite !== suite) continue;
    const projectPath = path.join(samplesDirectory(), sample.name);
    if (!existsSync(projectPath)) {
      console.error(`skip ${sample.name}: missing at ${projectPath} (npm run samples:fetch)`);
      continue;
    }
    samples.push({ ...sample, projectPath });
  }
  return samples;
}

// One metric against its baseline value: printed, and true when it is more
// than `tolerance` times the baseline and at least `minDelta` worse (so a
// 5 → 6 ms wobble on a small sample is not a regression).
export function checkRegression(
  label: string,
  before: number,
  after: number,
  { tolerance, minDelta, unit }: { tolerance: number; minDelta: number; unit: string },
): boolean {
  const ratio = after / Math.max(before, 1);
  const regressed = ratio > tolerance && after - before >= minDelta;
  console.log(`${(regressed ? "REGRESSION" : "ok").padEnd(10)} ${label}: ${before} → ${after} ${unit} (${ratio.toFixed(2)}×)`);
  return regressed;
}
