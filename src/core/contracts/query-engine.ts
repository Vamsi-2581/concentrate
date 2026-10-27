export type GraphStatsRow = { table: string; count: unknown };

/** Values for `$name` placeholders in a query. */
export type QueryParameters = Readonly<Record<string, unknown>>;

export type GraphStatsOptions = {
  packageName?: string;
};

/** Read-only access to a persisted code graph. */
export interface IQueryEngine {
  query(cypher: string, params?: QueryParameters): Promise<unknown[]>;
  stats(options?: GraphStatsOptions): Promise<GraphStatsRow[]>;
  schemaVersion(): Promise<number | null>;
  close(): Promise<void>;
}
