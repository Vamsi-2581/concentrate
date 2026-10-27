import { mkdir } from "node:fs/promises";
import type { GraphNode, GraphRelationship } from "../../core/graph/model.js";
import type { GraphPatchOptions, GraphPatchSummary, IGraphStore } from "../../core/contracts/graph-store.js";
import type { GraphStatsOptions, GraphStatsRow } from "../../core/contracts/query-engine.js";
import { executeCypher, type QueryParameters } from "./cypher/executor.js";
import { MemoryGraph } from "./graph.js";
import { acquireWriteLock } from "./lock.js";
import { commitSnapshot, loadSnapshot, readHead, type Head } from "./persistence.js";
import { nodeLabels, SCHEMA_VERSION } from "./schema.js";

export type GraphStoreOpenOptions = {
  /** Wait for another writer to finish instead of failing at once. */
  retryLock?: boolean;
};

/**
 * The graph store: an in-memory graph loaded from a snapshot directory,
 * queried with our Cypher subset. Writers take the directory lock and commit
 * a new snapshot generation; readers pick up a newer generation on their
 * next call, so a running MCP server sees a finished scan.
 */
export class GraphStore implements IGraphStore {
  private pendingReset = false;

  private constructor(
    private readonly directory: string,
    private graph: MemoryGraph,
    private head: Head | null,
    private readonly retryLock: boolean,
  ) {}

  static async open(directory: string, options: GraphStoreOpenOptions = {}): Promise<GraphStore> {
    await mkdir(directory, { recursive: true });
    const { head, graph } = await loadSnapshot(directory);
    return new GraphStore(directory, graph, head, options.retryLock ?? false);
  }

  /** Start from an empty graph. Committed by the next write, patch or close. */
  async reset(): Promise<void> {
    this.graph = new MemoryGraph();
    this.pendingReset = true;
  }

  async write(nodes: GraphNode[], relationships: GraphRelationship[]): Promise<void> {
    await this.mutate((graph) => graph.write(nodes, relationships));
  }

  async patch(nodes: GraphNode[], relationships: GraphRelationship[], options: GraphPatchOptions): Promise<GraphPatchSummary> {
    return this.mutate((graph) => graph.patch(nodes, relationships, options.affectedFiles));
  }

  async query(cypher: string, params: QueryParameters = {}): Promise<unknown[]> {
    await this.refresh();
    return executeCypher(this.graph, cypher, params);
  }

  async stats(options: GraphStatsOptions = {}): Promise<GraphStatsRow[]> {
    await this.refresh();
    const count = (cypher: string, params: QueryParameters = {}) => executeCypher(this.graph, cypher, params)[0]?.count ?? 0;

    if (!options.packageName) {
      return nodeLabels.map((label) => ({ table: label, count: count(`MATCH (n:${label}) RETURN count(n) AS count`) }));
    }

    const packagePredicate = "p.name = $package OR p.relativePath = $package";
    const params = { package: options.packageName };
    const owned = (relationship: string, label: string, table: string) => ({
      table,
      count: count(`MATCH (p:Package)-[:PACKAGE_CONTAINS_FILE]->(f:File)-[:${relationship}]->(n:${label}) WHERE ${packagePredicate} RETURN count(n) AS count`, params),
    });
    return [
      { table: "Package", count: count(`MATCH (p:Package) WHERE ${packagePredicate} RETURN count(p) AS count`, params) },
      { table: "File", count: count(`MATCH (p:Package)-[:PACKAGE_CONTAINS_FILE]->(f:File) WHERE ${packagePredicate} RETURN count(f) AS count`, params) },
      owned("IMPORTS", "Import", "Import"),
      owned("DEFINES_FUNCTION", "Function", "Function"),
      owned("DEFINES_CLASS", "Class", "Class"),
      owned("DECLARES_ROUTE", "Route", "Route"),
    ];
  }

  async schemaVersion(): Promise<number | null> {
    await this.refresh();
    if (this.pendingReset) return SCHEMA_VERSION;
    return this.head?.schemaVersion ?? null;
  }

  async close(): Promise<void> {
    if (this.pendingReset) await this.mutate(() => undefined);
  }

  /** Apply a change under the writer lock and commit it as the next generation. */
  private async mutate<T>(change: (graph: MemoryGraph) => T): Promise<T> {
    const release = await acquireWriteLock(this.directory, { wait: this.retryLock });
    try {
      const latest = await readHead(this.directory);
      if (!this.pendingReset && latest?.generation !== this.head?.generation) {
        ({ head: this.head, graph: this.graph } = await loadSnapshot(this.directory));
      }
      let result: T;
      try {
        result = change(this.graph);
      } catch (error) {
        // Like a rolled-back transaction: drop the half-applied change.
        this.graph = this.pendingReset ? new MemoryGraph() : (await loadSnapshot(this.directory)).graph;
        throw error;
      }
      this.head = await commitSnapshot(this.directory, this.graph, { schemaVersion: SCHEMA_VERSION, previous: latest });
      this.pendingReset = false;
      return result;
    } finally {
      await release();
    }
  }

  /** Readers follow the latest committed generation unless a local reset is pending. */
  private async refresh(): Promise<void> {
    if (this.pendingReset) return;
    const latest = await readHead(this.directory);
    if (latest?.generation === this.head?.generation) return;
    ({ head: this.head, graph: this.graph } = await loadSnapshot(this.directory));
  }
}
