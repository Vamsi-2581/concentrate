import type { SyntaxNode } from "../../languages/syntax/tree-sitter.js";
import type { GraphNode, GraphRelationship } from "../../../core/graph/model.js";

// Lookups over one file's language-level graph and syntax tree, shared by the
// route and entrypoint detectors.

export function stripStringQuotes(value: string): string {
  return value.replace(/^["'`]|["'`]$/g, "");
}

export function moduleLevelCallExpressions(programNode: SyntaxNode): SyntaxNode[] {
  const calls: SyntaxNode[] = [];
  for (const stmt of programNode.namedChildren) {
    if (stmt.type !== "expression_statement") continue;

    let expr = stmt.namedChildren[0];
    if (!expr) continue;
    if (expr.type === "await_expression") {
      expr = expr.namedChildren[0];
    }
    if (expr?.type === "call_expression") {
      calls.push(expr);
    }
  }
  return calls;
}

export function indexFileFunctions(
  fileNodeId: string,
  nodes: GraphNode[],
  relationships: GraphRelationship[],
): Map<string, string> {
  const fileFunctionIds = new Set(
    relationships
      .filter((rel) => rel.from === fileNodeId && rel.type === "DEFINES_FUNCTION")
      .map((rel) => rel.to),
  );

  const functions = new Map<string, string>();
  for (const node of nodes) {
    if (!fileFunctionIds.has(node.id) || node.label !== "Function") continue;
    const name = node.properties.name;
    if (typeof name === "string" && !functions.has(name)) {
      functions.set(name, node.id);
    }
  }
  return functions;
}

export function indexPassedToHandlers(relationships: GraphRelationship[]): Map<string, string> {
  const handlers = new Map<string, string>();
  for (const rel of relationships) {
    if (rel.type === "PASSED_TO" && !handlers.has(rel.to)) {
      handlers.set(rel.to, rel.from);
    }
  }
  return handlers;
}

export function firstDecoratorArg(decoratorNode: GraphNode): string | null {
  const args = decoratorNode.properties.args;
  if (typeof args !== "string") return null;

  try {
    const parsed = JSON.parse(args) as unknown;
    return Array.isArray(parsed) && typeof parsed[0] === "string" ? parsed[0] : null;
  } catch {
    return null;
  }
}
