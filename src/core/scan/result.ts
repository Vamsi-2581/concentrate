import type { GraphNode, GraphRelationship } from "../graph/model.js";
import type { ScanReport } from "./report.js";
import type { ScanManifest } from "./manifest.js";

export type BuildCodeGraphOptions = {
  continueOnError: boolean;
  concurrency?: number;
  maxFiles?: number;
  include?: string[];
  exclude?: string[];
  // Reuse per-file parse results stored here (see parse-cache.ts); unset parses every file.
  cacheDirectory?: string;
  onProgress?: (current: number, total: number, relativePath: string) => void;
};

export type BuildCodeGraphResult = {
  rootPath: string;
  nodes: GraphNode[];
  relationships: GraphRelationship[];
  report: ScanReport;
  manifest: ScanManifest;
};
