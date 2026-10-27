import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { CypherError } from "../src/adapters/store/cypher/errors.js";
import { GraphStore } from "../src/adapters/store/store.js";
import { buildCodeGraph } from "../src/composition/orchestrator.js";
import { assertGolden } from "./helpers/golden.js";
import { corpusGoldenPath, formatCorpusResults, readCorpus, runCorpus } from "./helpers/cypher-corpus.js";

const fixturesRoot = path.join(import.meta.dirname, "../fixtures");
const corpus = await readCorpus();
const workRoot = await mkdtemp(path.join(os.tmpdir(), "concentrate-golden-cypher-"));

after(() => rm(workRoot, { recursive: true, force: true }));

// The recordings were made with Kuzu 0.11.3 before it was removed, and are the
// reference for the built-in engine: they are never regenerated from it.
describe("Cypher conformance corpus", () => {
  for (const fixture of corpus.fixtures) {
    it(fixture, async () => {
      const graph = await buildCodeGraph(path.join(fixturesRoot, fixture), { continueOnError: true, concurrency: 4 });
      const store = await GraphStore.open(path.join(workRoot, `${fixture}.graph`));
      await store.reset();
      await store.write(graph.nodes, graph.relationships);
      const results = await runCorpus(corpus.cases, (cypher, params) => store.query(cypher, params), classifyCypherError);
      await assertGolden(corpusGoldenPath(fixture), formatCorpusResults(results), { readOnly: true });
    });
  }
});

function classifyCypherError(error: unknown) {
  if (error instanceof CypherError) return error.kind;
  throw error;
}

