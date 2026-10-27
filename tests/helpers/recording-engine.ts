import type { GraphStatsOptions, GraphStatsRow, IQueryEngine } from "../../src/core/contracts/query-engine.js";

export type RecordedCall =
  | { method: "query"; cypher: string; rows: unknown[] }
  | { method: "stats"; options: GraphStatsOptions; rows: GraphStatsRow[] }
  | { method: "schemaVersion"; result: number | null };

/**
 * Wraps a query engine and records every call with its result, so a future
 * engine can replay the same calls and be checked against the recording.
 */
export class RecordingQueryEngine implements IQueryEngine {
  readonly calls: RecordedCall[] = [];

  constructor(private readonly inner: IQueryEngine) {}

  async query(cypher: string): Promise<unknown[]> {
    // Reserve the slot synchronously so concurrent queries keep issue order.
    const call: RecordedCall = { method: "query", cypher: normalizeCypher(cypher), rows: [] };
    this.calls.push(call);
    call.rows = await this.inner.query(cypher);
    return call.rows;
  }

  async stats(options: GraphStatsOptions = {}): Promise<GraphStatsRow[]> {
    const call: RecordedCall = { method: "stats", options, rows: [] };
    this.calls.push(call);
    call.rows = await this.inner.stats(options);
    return call.rows;
  }

  async schemaVersion(): Promise<number | null> {
    const call: RecordedCall = { method: "schemaVersion", result: null };
    this.calls.push(call);
    call.result = await this.inner.schemaVersion();
    return call.result;
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}

/** Collapse whitespace so recordings do not depend on template indentation. */
export function normalizeCypher(cypher: string): string {
  return cypher.replace(/\s+/g, " ").trim();
}

/** Cypher with string and number literals replaced, used to count distinct query shapes. */
export function cypherTemplate(cypher: string): string {
  return normalizeCypher(cypher)
    .replace(/"(?:[^"\\]|\\.)*"/g, "$str")
    .replace(/'(?:[^'\\]|\\.)*'/g, "$str")
    .replace(/\b\d+\b/g, "$num");
}
