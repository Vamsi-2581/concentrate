export type GraphStatsRow = { table: string; count: unknown };

export type GraphStatsOptions = {
  packageName?: string;
};

/** Read-only access to a persisted code graph. */
export interface IQueryEngine {
  query(cypher: string): Promise<unknown[]>;
  stats(options?: GraphStatsOptions): Promise<GraphStatsRow[]>;
  schemaVersion(): Promise<number | null>;
  close(): Promise<void>;
}
