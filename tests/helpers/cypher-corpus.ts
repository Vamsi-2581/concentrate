import { readFile } from "node:fs/promises";
import path from "node:path";
import { goldenRoot } from "./golden.js";

/**
 * The Cypher conformance corpus (tests/golden/cypher/): hand-written queries
 * whose results were recorded from Kuzu, so our own engine can be checked
 * against Kuzu's semantics after Kuzu is gone.
 */

export type CorpusCase = {
  id: string;
  cypher: string;
  params?: Record<string, unknown>;
  /** Compare rows in order; otherwise rows are compared as a sorted multiset. */
  ordered?: boolean;
  /** Not run against Kuzu: our engine must reject it with this error class. */
  expectError?: CypherErrorClass;
  /** Why the expectation deviates from Kuzu, when it does. */
  note?: string;
};

export type Corpus = { fixtures: string[]; cases: CorpusCase[] };

/** `parser` (syntax), `binder` (unknown names, types), `runtime`, or `unsupported` (outside our subset). */
export type CypherErrorClass = "parser" | "binder" | "runtime" | "unsupported";

export type CorpusResult = { rows: unknown[] } | { error: CypherErrorClass };

export type CypherRunner = (cypher: string, params: Record<string, unknown>) => Promise<unknown[]>;

export async function readCorpus(): Promise<Corpus> {
  return JSON.parse(await readFile(path.join(goldenRoot, "cypher", "cases.json"), "utf8")) as Corpus;
}

export function corpusGoldenPath(fixture: string): string {
  return path.join(goldenRoot, "cypher", `${fixture}.json`);
}

export async function runCorpus(
  cases: CorpusCase[],
  run: CypherRunner,
  classify: (error: unknown) => CypherErrorClass,
  options: { skipExpectedErrors?: boolean } = {},
): Promise<Record<string, CorpusResult>> {
  const results: Record<string, CorpusResult> = {};
  for (const testCase of cases) {
    if (testCase.expectError && options.skipExpectedErrors) {
      results[testCase.id] = { error: testCase.expectError };
      continue;
    }
    try {
      const rows = await run(testCase.cypher, testCase.params ?? {});
      results[testCase.id] = { rows: testCase.ordered ? rows : sortRows(rows) };
    } catch (error) {
      results[testCase.id] = { error: classify(error) };
    }
  }
  return results;
}

export function formatCorpusResults(results: Record<string, CorpusResult>): string {
  return `${JSON.stringify(results, null, 2)}\n`;
}

function sortRows(rows: unknown[]): unknown[] {
  return rows
    .map((row) => [JSON.stringify(row), row] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, row]) => row);
}
