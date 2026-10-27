import { SCHEMA_VERSION } from "../adapters/store/schema.js";
import { GraphStore } from "../adapters/store/store.js";
import type { IGraphStore } from "../core/contracts/graph-store.js";

export const GRAPH_SCHEMA_VERSION = SCHEMA_VERSION;

export type OpenGraphStoreOptions = {
  /** Wait for another writer to release the store instead of failing at once. */
  retryLock?: boolean;
};

// The only place that knows which storage engine backs the graph.
export function openGraphStore(storePath: string, options: OpenGraphStoreOptions = {}): Promise<IGraphStore> {
  return GraphStore.open(storePath, { retryLock: options.retryLock ?? true });
}
