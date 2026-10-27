import { nodeTables, relationshipTables, type PropertyType } from "../store/schema.js";

export { nodeLabels, relationshipTypes, SCHEMA_VERSION } from "../store/schema.js";

export const schemaVersionTableStatement =
  "CREATE NODE TABLE IF NOT EXISTS _SchemaVersion(version INT64 PRIMARY KEY, writtenAt STRING)";

function columns(properties: Readonly<Record<string, PropertyType>>): string[] {
  return Object.entries(properties).map(([name, type]) => `${name} ${type}`);
}

// Kuzu DDL derived from the store schema, which is the single source of truth.
export const schemaStatements = [
  ...nodeTables.map((table) => (
    `CREATE NODE TABLE IF NOT EXISTS ${table.label}(${["id STRING PRIMARY KEY", ...columns(table.properties)].join(", ")})`
  )),
  ...relationshipTables.map((table) => (
    `CREATE REL TABLE IF NOT EXISTS ${table.type}(${[`FROM ${table.from} TO ${table.to}`, ...columns(table.properties)].join(", ")})`
  )),
];
