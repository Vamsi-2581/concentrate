/**
 * Graph store benchmark: write time and MCP tool latency on the standing samples.
 *
 *   npx tsx scripts/bench-store.ts [--runs 20] [--json out.json]
 *
 * Scanning (parsing) is done once per sample and not measured; only the store
 * is. Results go into docs/benchmarks.md, so a new engine can be compared with
 * the baseline recorded before it.
 */
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { readSampleManifest, samplesDirectory } from "../src/adapters/cli/smoke.js";
import { callMcpTool } from "../src/adapters/mcp/tools.js";
import { openGraphStore } from "../src/composition/graph-store.js";
import { buildCodeGraph } from "../src/composition/orchestrator.js";

const { values } = parseArgs({ options: { runs: { type: "string", default: "20" }, json: { type: "string" } } });
const runs = Number.parseInt(values.runs!, 10);
const cases = (JSON.parse(await readFile(new URL("../tests/golden/query-cases.json", import.meta.url), "utf8")) as {
  common: Array<{ tool: string; args: Record<string, unknown> }>;
}).common;

type Timing = { p50: number; p95: number };
type SampleResult = { sample: string; nodes: number; relationships: number; write: Timing; tools: Record<string, Timing> };

function timing(samples: number[]): Timing {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return { p50: round(at(0.5)), p95: round(at(0.95)) };
}

function round(ms: number): number {
  return Math.round(ms * 100) / 100;
}

async function measure(action: () => Promise<unknown>): Promise<number> {
  const start = process.hrtime.bigint();
  await action();
  return Number(process.hrtime.bigint() - start) / 1e6;
}

const workRoot = await mkdtemp(path.join(os.tmpdir(), "concentrate-bench-"));
const results: SampleResult[] = [];
try {
  for (const sample of (await readSampleManifest()).filter((item) => item.suite === "standing")) {
    const projectPath = path.join(samplesDirectory(), sample.name);
    if (!existsSync(projectPath)) {
      console.error(`skip ${sample.name}: missing at ${projectPath} (npm run samples:fetch)`);
      continue;
    }
    const graph = await buildCodeGraph(projectPath, { continueOnError: true, concurrency: 4 });
    const databasePath = path.join(workRoot, sample.name);

    const writeTimes: number[] = [];
    for (let run = 0; run < Math.max(3, Math.ceil(runs / 4)); run += 1) {
      const store = await openGraphStore(databasePath);
      try {
        writeTimes.push(await measure(async () => {
          await store.reset();
          await store.write(graph.nodes, graph.relationships);
        }));
      } finally {
        await store.close();
      }
    }

    const tools: Record<string, Timing> = {};
    const store = await openGraphStore(databasePath);
    try {
      for (const testCase of cases) {
        await callMcpTool(store, testCase.tool, testCase.args); // warm-up
        const times: number[] = [];
        for (let run = 0; run < runs; run += 1) {
          times.push(await measure(() => callMcpTool(store, testCase.tool, testCase.args)));
        }
        tools[testCase.tool] = timing(times);
      }
    } finally {
      await store.close();
    }

    results.push({
      sample: sample.name,
      nodes: graph.nodes.length,
      relationships: graph.relationships.length,
      write: timing(writeTimes),
      tools,
    });
    console.error(`done ${sample.name}`);
  }
} finally {
  await rm(workRoot, { recursive: true, force: true });
}

if (values.json) {
  await writeFile(values.json, `${JSON.stringify({ node: process.version, platform: `${process.platform}-${process.arch}`, runs, results }, null, 2)}\n`);
}

const toolNames = cases.map((testCase) => testCase.tool);
console.log(`| Sample | Nodes | Rels | Write p50 / p95 (ms) | ${toolNames.join(" | ")} |`);
console.log(`| --- | ---: | ---: | ---: | ${toolNames.map(() => "---:").join(" | ")} |`);
for (const result of results) {
  const cells = toolNames.map((name) => `${result.tools[name]!.p50} / ${result.tools[name]!.p95}`);
  console.log(`| ${result.sample} | ${result.nodes} | ${result.relationships} | ${result.write.p50} / ${result.write.p95} | ${cells.join(" | ")} |`);
}
