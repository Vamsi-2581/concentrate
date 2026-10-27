import path from "node:path";
import { openGraphStore } from "../../composition/graph-store.js";

export type StatsAdapterOptions = {
  database: string;
  package?: string;
};

export async function runStatsAdapter(options: StatsAdapterOptions): Promise<void> {
  const writer = await openGraphStore(path.resolve(options.database));
  let version: number | null;
  let stats: Array<{ table: string; count: unknown }>;
  try {
    version = await writer.schemaVersion();
    stats = await writer.stats({ packageName: options.package });
  } finally {
    await writer.close();
  }

  console.log(`Schema version: ${version ?? "unknown"}`);
  if (options.package) {
    console.log(`Package filter: ${options.package}`);
  }
  console.table(stats);
}
