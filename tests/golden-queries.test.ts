import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { openGraphStore } from "../src/composition/graph-store.js";
import { GraphStore } from "../src/adapters/store/store.js";
import type { IGraphStore } from "../src/core/contracts/graph-store.js";
import { buildCodeGraph } from "../src/composition/orchestrator.js";
import { ROOT_PLACEHOLDER } from "../src/core/graph/normalize.js";
import { callMcpTool } from "../src/adapters/mcp/tools.js";
import { readSampleManifest, samplesDirectory } from "../src/adapters/cli/smoke.js";
import { assertGolden, goldenRoot, updateGolden } from "./helpers/golden.js";
import { cypherTemplate, RecordingQueryEngine } from "./helpers/recording-engine.js";

type QueryCase = { tool: string; args: Record<string, unknown> };
type QueryCases = { common: QueryCase[]; fixtures: Record<string, QueryCase[]> };

const fixturesRoot = path.join(import.meta.dirname, "../fixtures");
const cases = JSON.parse(await readFile(path.join(goldenRoot, "query-cases.json"), "utf8")) as QueryCases;
const workRoot = await mkdtemp(path.join(os.tmpdir(), "concentrate-golden-queries-"));
const templates = new Set<string>();
const standingSamples = (await readSampleManifest()).filter((sample) => sample.suite === "standing");

after(() => rm(workRoot, { recursive: true, force: true }));

type Engine = { name: string; open: (name: string) => Promise<IGraphStore>; replayOnly?: boolean };

// Kuzu recorded the goldens; the built-in store must replay them exactly.
const engines: Engine[] = [
  { name: "Kuzu", open: (name) => openGraphStore(path.join(workRoot, `${name}.kuzu`)) },
  { name: "built-in store", open: (name) => GraphStore.open(path.join(workRoot, `${name}.graph`)), replayOnly: true },
];

/** Scan a project into a fresh store and record every MCP case against it. */
async function recordCases(engine: Engine, name: string, projectPath: string, projectCases: QueryCase[]): Promise<string> {
  const graph = await buildCodeGraph(projectPath, { continueOnError: true, concurrency: 4 });
  const store = await engine.open(name);
  try {
    await store.reset();
    await store.write(graph.nodes, graph.relationships);
    const recorded = [];
    for (const testCase of projectCases) {
      const engine = new RecordingQueryEngine(store);
      const result = await callMcpTool(engine, testCase.tool, testCase.args);
      for (const call of engine.calls) {
        if (call.method === "query") templates.add(cypherTemplate(call.cypher));
      }
      recorded.push({ ...testCase, calls: engine.calls, output: JSON.parse(result.content[0]!.text) as unknown });
    }
    return `${JSON.stringify(recorded, null, 2).replaceAll(graph.rootPath, ROOT_PLACEHOLDER)}\n`;
  } finally {
    await store.close();
  }
}

for (const engine of engines) {
  const skipEngine = engine.replayOnly && updateGolden ? "goldens are recorded from Kuzu" : false;
  describe(`golden MCP query recordings (${engine.name})`, { skip: skipEngine }, () => {
    for (const [name, extra] of Object.entries(cases.fixtures)) {
      it(name, async () => {
        const actual = await recordCases(engine, name, path.join(fixturesRoot, name), [...cases.common, ...extra]);
        await assertGolden(path.join(goldenRoot, "queries", `${name}.json`), actual);
      });
    }

    for (const sample of standingSamples) {
      const projectPath = path.join(samplesDirectory(), sample.name);
      const skip = existsSync(projectPath) || process.env.REQUIRE_SAMPLES === "1"
        ? false
        : `sample missing at ${projectPath}; run \`npm run samples:fetch\``;
      it(`sample: ${sample.name}`, { skip }, async () => {
        const actual = await recordCases(engine, sample.name, projectPath, cases.common);
        await assertGolden(path.join(goldenRoot, "queries", "samples", `${sample.name}.json.gz`), actual);
      });
    }
  });
}

describe("golden MCP query shapes", () => {
  // Pins the set of distinct query shapes the MCP tools issue, so a new tool or
  // filter that is not covered by query-cases.json shows up as a golden diff.
  it("covers every MCP query shape", async () => {
    assert.ok(templates.size > 0);
    await assertGolden(path.join(goldenRoot, "queries", "templates.json"), `${JSON.stringify([...templates].sort(), null, 2)}\n`);
  });
});
