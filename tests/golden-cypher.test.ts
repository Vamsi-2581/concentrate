import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { openGraphStore } from "../src/composition/graph-store.js";
import { CypherError } from "../src/adapters/store/cypher/errors.js";
import { GraphStore } from "../src/adapters/store/store.js";
import { buildCodeGraph } from "../src/composition/orchestrator.js";
import { assertGolden, updateGolden } from "./helpers/golden.js";
import { corpusGoldenPath, formatCorpusResults, readCorpus, runCorpus } from "./helpers/cypher-corpus.js";
import { classifyKuzuError, openKuzuOracle } from "./helpers/kuzu-oracle.js";

const fixturesRoot = path.join(import.meta.dirname, "../fixtures");
const corpus = await readCorpus();
const workRoot = await mkdtemp(path.join(os.tmpdir(), "concentrate-golden-cypher-"));

after(() => rm(workRoot, { recursive: true, force: true }));

describe("Cypher conformance corpus (Kuzu)", () => {
  for (const fixture of corpus.fixtures) {
    it(fixture, async () => {
      const graph = await buildCodeGraph(path.join(fixturesRoot, fixture), { continueOnError: true, concurrency: 4 });
      const databasePath = path.join(workRoot, `${fixture}.kuzu`);
      const store = await openGraphStore(databasePath);
      try {
        await store.reset();
        await store.write(graph.nodes, graph.relationships);
      } finally {
        await store.close();
      }

      const oracle = await openKuzuOracle(databasePath);
      try {
        const results = await runCorpus(corpus.cases, oracle.run, classifyKuzuError, { skipExpectedErrors: true });
        await assertGolden(corpusGoldenPath(fixture), formatCorpusResults(results));
      } finally {
        await oracle.close();
      }
    });
  }
});

// Replays the Kuzu recordings on the built-in engine. Cases marked expectError
// are not run against Kuzu, but the built-in engine must reject them that way.
describe("Cypher conformance corpus (built-in engine)", { skip: updateGolden && "goldens are recorded from Kuzu" }, () => {
  for (const fixture of corpus.fixtures) {
    it(fixture, async () => {
      const graph = await buildCodeGraph(path.join(fixturesRoot, fixture), { continueOnError: true, concurrency: 4 });
      const store = await GraphStore.open(path.join(workRoot, `${fixture}.graph`));
      await store.reset();
      await store.write(graph.nodes, graph.relationships);
      const results = await runCorpus(corpus.cases, (cypher, params) => store.query(cypher, params), classifyCypherError);
      await assertGolden(corpusGoldenPath(fixture), formatCorpusResults(results));
    });
  }
});

function classifyCypherError(error: unknown) {
  if (error instanceof CypherError) return error.kind;
  throw error;
}
