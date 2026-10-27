import path from "node:path";
import { openGraphStore } from "../../composition/graph-store.js";

export type OutputFormat = "json" | "table" | "csv";

export type QueryAdapterOptions = {
  database: string;
  format: OutputFormat;
  param?: string[];
};

export async function runQueryAdapter(cypher: string, options: QueryAdapterOptions): Promise<void> {
  const params = parseParams(options.param ?? []);
  const writer = await openGraphStore(path.resolve(options.database));
  let rows: unknown[];
  try {
    rows = await writer.query(cypher, params);
  } finally {
    await writer.close();
  }

  printRows(rows, options.format);
}

/** `name=value` pairs; a value that parses as JSON (`3`, `true`, `["a"]`) keeps its type, anything else is a string. */
export function parseParams(pairs: string[]): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const pair of pairs) {
    const separator = pair.indexOf("=");
    if (separator <= 0) throw new Error(`Invalid --param ${JSON.stringify(pair)}: expected name=value`);
    const raw = pair.slice(separator + 1);
    let value: unknown = raw;
    try {
      value = JSON.parse(raw);
    } catch {
      // Not JSON: keep the text.
    }
    params[pair.slice(0, separator)] = value;
  }
  return params;
}

function printRows(rows: unknown[], format: OutputFormat): void {
  if (format === "table") {
    console.table(rows);
    return;
  }

  if (format === "csv") {
    if (rows.length === 0) return;
    const headers = Object.keys(rows[0] as Record<string, unknown>);
    console.log(headers.map(csvEscape).join(","));
    for (const row of rows) {
      console.log(headers.map((h) => csvEscape((row as Record<string, unknown>)[h])).join(","));
    }
    return;
  }

  console.log(JSON.stringify(rows, null, 2));
}

function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
