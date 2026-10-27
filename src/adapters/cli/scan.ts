import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { printScanReport } from "./report.js";
import { ProgressReporter } from "./progress.js";
import type { BuildCodeGraphResult, IncrementalEligibility, IncrementalMode } from "../../core/scan/index.js";
import { didFailFast, didPartiallySucceed } from "../../core/scan/index.js";
import { scanOrchestrator } from "../../composition/orchestrator.js";
import { GRAPH_SCHEMA_VERSION, openGraphStore } from "../../composition/graph-store.js";
import type { IGraphStore } from "../../core/contracts/graph-store.js";

export type ScanAdapterOptions = {
  database: string;
  continueOnError: boolean;
  concurrency?: number;
  maxFiles?: number;
  include: string[];
  exclude: string[];
  retryLock: boolean;
  manifest: string;
  previousManifest?: string;
  incremental: string;
};

export type CliAdapterResult = {
  exitCode: number;
};

export async function runScanAdapter(projectPath: string, options: ScanAdapterOptions): Promise<CliAdapterResult> {
  const databasePath = path.resolve(options.database);
  const manifestPath = path.resolve(options.manifest);
  const incrementalMode = parseIncrementalMode(options.incremental);
  const progress = new ProgressReporter();

  const result = await scanOrchestrator.buildGraph(projectPath, {
    continueOnError: options.continueOnError,
    concurrency: options.concurrency,
    maxFiles: options.maxFiles,
    include: options.include.length > 0 ? options.include : undefined,
    exclude: options.exclude.length > 0 ? options.exclude : undefined,
    previousManifestPath: options.previousManifest ? path.resolve(options.previousManifest) : undefined,
    incrementalMode,
    onProgress: (current, total, relativePath) => {
      progress.update(current, total, relativePath);
    },
  });

  progress.clear();

  if (didFailFast(result)) {
    await writeManifest(manifestPath, result.manifest);
    printScanReport(result.report, result.nodes.length, result.relationships.length, databasePath);
    console.log(`  Manifest:        ${manifestPath}`);
    return { exitCode: 1 };
  }

  const writer = await openGraphStore(databasePath, { retryLock: options.retryLock !== false });
  try {
    await writeGraph(writer, result, incrementalMode);
  } finally {
    await writer.close();
  }

  await writeManifest(manifestPath, result.manifest);
  printScanReport(result.report, result.nodes.length, result.relationships.length, databasePath);
  console.log(`  Manifest:        ${manifestPath}`);
  return { exitCode: didPartiallySucceed(result) ? 1 : 0 };
}

async function writeGraph(
  writer: IGraphStore,
  result: BuildCodeGraphResult,
  incrementalMode: IncrementalMode,
): Promise<void> {
  const requestedPatch = incrementalMode === "changed-files";
  result.report.graphPatch = {
    ...result.report.graphPatch,
    requested: requestedPatch,
  };

  if (!requestedPatch) {
    await resetAndWriteGraph(writer, result);
    return;
  }

  if (!result.report.incremental.compatible) {
    result.report.graphPatch = {
      ...result.report.graphPatch,
      effectiveMode: "reset",
      reason: result.report.incremental.reason ?? "Previous manifest is not compatible",
    };
    await resetAndWriteGraph(writer, result);
    return;
  }

  const schemaVersion = await writer.schemaVersion();
  if (schemaVersion !== GRAPH_SCHEMA_VERSION) {
    result.report.graphPatch = {
      ...result.report.graphPatch,
      effectiveMode: "reset",
      reason: schemaVersion === null
        ? "Previous graph schema is missing"
        : `Previous graph schema mismatch: previous ${schemaVersion}, current ${GRAPH_SCHEMA_VERSION}`,
    };
    await resetAndWriteGraph(writer, result);
    return;
  }

  const affectedFiles = affectedFilesFromManifestDiff(result.report.incremental);
  const patchSummary = await writer.patch(result.nodes, result.relationships, {
    affectedFiles,
  });
  result.report.graphPatch = {
    requested: true,
    effectiveMode: "patch",
    reason: null,
    affectedFiles: patchSummary.affectedFiles,
    nodesWritten: patchSummary.nodesWritten,
    relationshipsWritten: patchSummary.relationshipsWritten,
  };
}

async function resetAndWriteGraph(
  writer: IGraphStore,
  result: BuildCodeGraphResult,
): Promise<void> {
  await writer.reset();
  await writer.write(result.nodes, result.relationships);
  result.report.graphPatch = {
    ...result.report.graphPatch,
    nodesWritten: result.nodes.length,
    relationshipsWritten: result.relationships.length,
  };
}

function affectedFilesFromManifestDiff(incremental: IncrementalEligibility): string[] {
  const diff = incremental as IncrementalEligibility & {
    addedFiles?: string[];
    changedFiles?: string[];
    deletedFiles?: string[];
  };
  return [
    ...(diff.addedFiles ?? []),
    ...(diff.changedFiles ?? []),
    ...(diff.deletedFiles ?? []),
  ];
}

async function writeManifest(manifestPath: string, manifest: unknown): Promise<void> {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function parseIncrementalMode(value: string): IncrementalMode {
  if (value === "full" || value === "changed-files") {
    return value;
  }

  throw new Error(`Unsupported incremental mode: ${value}`);
}
