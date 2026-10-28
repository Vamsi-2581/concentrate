import type { GraphNode, GraphRelationship } from "../graph/model.js";
import type { IQueryEngine } from "./query-engine.js";

/** A persisted code graph, rewritten as a whole by each scan. */
export interface IGraphStore extends IQueryEngine {
  reset(): Promise<void>;
  write(nodes: GraphNode[], relationships: GraphRelationship[]): Promise<void>;
}
