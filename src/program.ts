import type { ProgramSpec } from "./adapters/cli/args.js";
import { scanCommand } from "./commands/scan.js";
import { statsCommand } from "./commands/stats.js";
import { queryCommand } from "./commands/query.js";
import { exportCommand } from "./commands/export.js";
import { smokeCommand } from "./commands/smoke.js";
import { mcpCommand } from "./commands/mcp.js";

/** Command-line surface of `concentrate`: every command, argument and flag. */
export const program: ProgramSpec = {
  name: "concentrate",
  description: "Scan codebases into a queryable code graph.",
  version: "0.1.0",
  commands: [
    {
      name: "scan",
      description: "Scan a project and write its graph into a Kuzu database.",
      args: [{ name: "path", description: "Project path to scan" }],
      options: [
        { flags: "-d, --database <path>", description: "Kuzu database path", default: ".concentrate/graph.kuzu" },
        { flags: "--continue-on-error", description: "Continue scanning when a supported file fails to parse", type: "boolean" },
        { flags: "--concurrency <n>", description: "Files to parse in parallel (default: CPU count)", type: "number" },
        { flags: "--max-files <n>", description: "Maximum number of files to parse", type: "number" },
        { flags: "--include <pattern>", description: "Include glob pattern, repeatable", multiple: true },
        { flags: "--exclude <pattern>", description: "Exclude glob pattern, repeatable", multiple: true },
        { flags: "--kuzu-write-mode <mode>", description: "Kuzu write mode: transaction or individual", default: "transaction" },
        { flags: "--manifest <path>", description: "Incremental scan manifest output path", default: ".concentrate/scan-manifest.json" },
        { flags: "--previous-manifest <path>", description: "Previous scan manifest used only for incremental eligibility reporting" },
        { flags: "--incremental <mode>", description: "Incremental mode: full or changed-files", default: "full" },
      ],
      action: scanCommand,
    },
    {
      name: "stats",
      description: "Show basic graph statistics.",
      options: [
        { flags: "-d, --database <path>", description: "Kuzu database path", default: ".concentrate/graph.kuzu" },
        { flags: "--package <name>", description: "Filter file-owned stats to one package name or relative path" },
        { flags: "--no-retry-lock", description: "Disable retry/backoff for transient Kuzu database lock errors" },
      ],
      action: statsCommand,
    },
    {
      name: "query",
      description: "Run a Cypher query against the graph.",
      args: [{ name: "cypher", description: "Cypher query to execute" }],
      options: [
        { flags: "-d, --database <path>", description: "Kuzu database path", default: ".concentrate/graph.kuzu" },
        { flags: "-f, --format <format>", description: "Output format: json, table, csv", default: "json" },
        { flags: "--no-retry-lock", description: "Disable retry/backoff for transient Kuzu database lock errors" },
      ],
      action: queryCommand,
    },
    {
      name: "export",
      description: "Scan a project and export its graph as JSONL files.",
      args: [{ name: "path", description: "Project path to scan" }],
      options: [
        { flags: "-o, --output <path>", description: "Output directory", default: ".concentrate/export" },
        { flags: "--continue-on-error", description: "Continue exporting when a supported file fails to parse", type: "boolean" },
        { flags: "--concurrency <n>", description: "Files to parse in parallel (default: CPU count)", type: "number" },
        { flags: "--max-files <n>", description: "Maximum number of files to parse", type: "number" },
        { flags: "--include <pattern>", description: "Include glob pattern, repeatable", multiple: true },
        { flags: "--exclude <pattern>", description: "Exclude glob pattern, repeatable", multiple: true },
        { flags: "--previous-manifest <path>", description: "Previous scan manifest used only for incremental eligibility reporting" },
        { flags: "--incremental <mode>", description: "Incremental mode: full or changed-files", default: "full" },
        { flags: "--normalized", description: "Also write graph.normalized.jsonl: machine-independent, deterministically ordered", type: "boolean" },
      ],
      action: exportCommand,
    },
    {
      name: "smoke",
      description: "Run sample repository smoke validation scans.",
      options: [
        { flags: "--suite <suite>", description: "Smoke suite: standing, internet, or all", default: "all" },
        { flags: "--report <path>", description: "Machine-readable smoke report path", default: ".concentrate/smoke-report.json" },
        { flags: "--semantic-samples <n>", description: "Semantic sample rows per category", type: "number", default: 10 },
        { flags: "--incremental-benchmark", description: "Run a no-change incremental benchmark after each smoke scan", type: "boolean" },
        { flags: "--allow-missing", description: "Skip missing sample repositories instead of failing", type: "boolean" },
      ],
      action: smokeCommand,
    },
    {
      name: "mcp",
      description: "Run a read-only MCP server over a Kuzu graph database.",
      options: [
        { flags: "-d, --database <path>", description: "Kuzu database path", default: ".concentrate/graph.kuzu" },
        { flags: "--no-retry-lock", description: "Disable retry/backoff for transient Kuzu database lock errors" },
      ],
      action: mcpCommand,
    },
  ],
};
