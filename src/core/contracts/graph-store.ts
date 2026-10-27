import type { GraphNode, GraphRelationship } from "../graph/model.js";
import type { IQueryEngine } from "./query-engine.js";

export type GraphWriteMode = "transaction" | "individual";

export type GraphWriteOptions = {
  mode?: GraphWriteMode;
};

export type GraphPatchOptions = GraphWriteOptions & {
  affectedFiles: string[];
};

export type GraphPatchSummary = {
  affectedFiles: number;
  nodesWritten: number;
  relationshipsWritten: number;
};

/** A persisted code graph that can be rewritten or patched per file. */
export interface IGraphStore extends IQueryEngine {
  reset(): Promise<void>;
  write(nodes: GraphNode[], relationships: GraphRelationship[], options?: GraphWriteOptions): Promise<void>;
  patch(nodes: GraphNode[], relationships: GraphRelationship[], options: GraphPatchOptions): Promise<GraphPatchSummary>;
}
