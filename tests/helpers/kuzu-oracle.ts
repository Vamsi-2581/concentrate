import kuzu from "kuzu";
import type { Connection, Database } from "kuzu";
import type { CypherErrorClass, CypherRunner } from "./cypher-corpus.js";

/**
 * Direct Kuzu access for recording the Cypher conformance corpus. Lives in
 * tests/ only and goes away with Kuzu in Phase 2; the recorded goldens stay.
 */
export async function openKuzuOracle(databasePath: string): Promise<{ run: CypherRunner; close: () => Promise<void> }> {
  const database = new kuzu.Database(databasePath) as Database;
  const connection = new kuzu.Connection(database) as Connection;

  const run: CypherRunner = async (cypher, params) => {
    const statement = await connection.prepare(cypher);
    if (!statement.isSuccess()) {
      throw new Error(statement.getErrorMessage());
    }
    const result = await connection.execute(statement, params as Record<string, kuzu.KuzuValue>);
    const first = Array.isArray(result) ? result[0]! : result;
    try {
      return toPlainNumbers(await first.getAll()) as unknown[];
    } finally {
      for (const item of Array.isArray(result) ? result : [result]) item.close();
    }
  };

  return {
    run,
    close: async () => {
      await connection.close();
      await database.close();
    },
  };
}

/** Kuzu prefixes errors with their class, e.g. "Binder exception: ...". */
export function classifyKuzuError(error: unknown): CypherErrorClass {
  const message = error instanceof Error ? error.message : String(error);
  if (/^Parser exception/i.test(message)) return "parser";
  if (/^Binder exception|^Catalog exception/i.test(message)) return "binder";
  return "runtime";
}

/** Kuzu returns INT128 results such as sum() as BigInt; our engine returns plain numbers. */
function toPlainNumbers(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) return value.map(toPlainNumbers);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toPlainNumbers(item)]));
  }
  return value;
}
