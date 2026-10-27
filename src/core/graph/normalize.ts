import type { GraphNode, GraphProperties, GraphRelationship } from "./model.js";

export const ROOT_PLACEHOLDER = "<root>";

export type NormalizedGraphRecord =
  | ({ kind: "node" } & GraphNode)
  | ({ kind: "rel" } & GraphRelationship);

export type NormalizeGraphInput = {
  rootPath: string;
  nodes: readonly GraphNode[];
  relationships: readonly GraphRelationship[];
};

/**
 * Produce a machine-independent, deterministically ordered view of a graph:
 * the scan root is replaced with `<root>` everywhere, nodes are sorted by id,
 * relationships by from/type/to/properties, and property keys are sorted.
 */
export function normalizeGraph(input: NormalizeGraphInput): NormalizedGraphRecord[] {
  const replaceRoot = createRootReplacer(input.rootPath);
  const nodes = input.nodes
    .map((node): NormalizedGraphRecord => ({
      kind: "node",
      id: replaceRoot(node.id),
      label: node.label,
      properties: normalizeProperties(node.properties, replaceRoot),
    }))
    .sort((a, b) => compare(recordKey(a), recordKey(b)));
  const relationships = input.relationships
    .map((relationship): NormalizedGraphRecord => ({
      kind: "rel",
      from: replaceRoot(relationship.from),
      type: relationship.type,
      to: replaceRoot(relationship.to),
      properties: normalizeProperties(relationship.properties, replaceRoot),
    }))
    .sort((a, b) => compare(recordKey(a), recordKey(b)));
  return [...nodes, ...relationships];
}

export function formatNormalizedGraph(records: readonly NormalizedGraphRecord[]): string {
  return records.map((record) => `${JSON.stringify(record)}\n`).join("");
}

function createRootReplacer(rootPath: string): (value: string) => string {
  const variants = [...new Set([rootPath, rootPath.replaceAll("\\", "/")])]
    .filter((variant) => variant.length > 0)
    .sort((a, b) => b.length - a.length);
  return (value) => {
    let result = value;
    for (const variant of variants) {
      result = result.replaceAll(variant, ROOT_PLACEHOLDER);
    }
    return result.includes(ROOT_PLACEHOLDER) ? result.replaceAll("\\", "/") : result;
  };
}

function normalizeProperties(properties: GraphProperties, replaceRoot: (value: string) => string): GraphProperties {
  const normalized: GraphProperties = {};
  for (const key of Object.keys(properties).sort()) {
    const value = properties[key];
    normalized[key] = typeof value === "string" ? replaceRoot(value) : value;
  }
  return normalized;
}

function recordKey(record: NormalizedGraphRecord): string {
  if (record.kind === "node") {
    return record.id;
  }
  return `${record.from}\u0000${record.type}\u0000${record.to}\u0000${JSON.stringify(record.properties)}`;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
