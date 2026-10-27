import type { SyntaxNode } from "../../languages/syntax/tree-sitter.js";
import type { GraphNode, GraphRelationship } from "../../../core/graph/model.js";
import { createBackendEntrypointGraph } from "./entrypoint-graph.js";

// Parse-time backend entrypoint semantic module.
// Detects non-HTTP backend entrypoints: EventEmitter listeners, Bull/BullMQ
// queue consumers, node-cron jobs, NestJS scheduler callbacks, and socket.io
// handlers from module-level call expressions.
export function applyBackendEntrypointParseSemantics(
  fileNodeId: string,
  programNode: SyntaxNode,
  nodes: GraphNode[],
  relationships: GraphRelationship[],
): void {
  const result = createBackendEntrypointGraph(fileNodeId, programNode, nodes, relationships);
  nodes.push(...result.nodes);
  relationships.push(...result.relationships);
}
