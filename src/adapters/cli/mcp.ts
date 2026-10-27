import path from "node:path";
import { openGraphStore } from "../../composition/graph-store.js";
import { runMcpServer } from "../mcp/index.js";

export type McpAdapterOptions = {
  database: string;
};

export async function runMcpAdapter(options: McpAdapterOptions): Promise<void> {
  const databasePath = path.resolve(options.database);
  await runMcpServer(async () => openGraphStore(databasePath));
}
