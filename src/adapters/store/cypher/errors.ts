/** Error classes mirror Kuzu's ("Parser exception: ...") so messages look familiar. */
export type CypherErrorKind = "parser" | "binder" | "runtime" | "unsupported";

const prefixes: Record<CypherErrorKind, string> = {
  parser: "Parser exception",
  binder: "Binder exception",
  runtime: "Runtime exception",
  unsupported: "Unsupported Cypher feature",
};

export class CypherError extends Error {
  constructor(readonly kind: CypherErrorKind, detail: string) {
    super(`${prefixes[kind]}: ${detail}`);
    this.name = "CypherError";
  }
}

export function unsupported(feature: string): CypherError {
  return new CypherError("unsupported", `${feature} (the query surface is read-only and supports a Cypher subset; see docs/cypher.md)`);
}
