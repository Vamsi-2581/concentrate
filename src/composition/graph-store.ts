import { KuzuGraphWriter } from "../adapters/kuzu/index.js";
import { defaultKuzuRetryOptions } from "../adapters/kuzu/kuzu-retry.js";
import { SCHEMA_VERSION } from "../adapters/kuzu/schema.js";
import type { IGraphStore } from "../core/contracts/graph-store.js";

export const GRAPH_SCHEMA_VERSION = SCHEMA_VERSION;

export type OpenGraphStoreOptions = {
  /** Retry while another process holds the database lock. */
  retryLock?: boolean;
};

// The only place that knows which storage engine backs the graph.
export function openGraphStore(databasePath: string, options: OpenGraphStoreOptions = {}): Promise<IGraphStore> {
  return KuzuGraphWriter.open(databasePath, {
    retry: options.retryLock ? defaultKuzuRetryOptions : false,
  });
}
