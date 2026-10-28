import type { IQueryEngine } from "../../../core/contracts/query-engine.js";
import { objectSchema } from "../args.js";
import { fitToBudget, OUTPUT_BUDGET_CHARS } from "./budget.js";
import { detectChanges, impactOf } from "./impact.js";
import { routeDetails } from "./route.js";
import { getFileOutline, getSymbolSource } from "./source.js";

// Tools that answer an agent's question in one call ("what breaks if I change
// this?", "what does this endpoint do?") instead of a chain of lookups. Their
// results are capped at OUTPUT_BUDGET_CHARS.

const budgetNote = `Results over ${OUTPUT_BUDGET_CHARS} characters are shortened; \`truncated\` then lists how many items each list lost.`;

const maxDepth = { type: "number", description: "How many call levels to follow upward. Defaults to 5." };
const limit = (fallback: number) => ({ type: "number", description: `Maximum items per list. Defaults to ${fallback}.` });

export const agentToolDefinitions = [
  {
    name: "impact_of",
    description: `What is affected if a function, method, class or file changes: transitive callers with their call depth, module-level callers, the routes and entrypoints that run any of them, and the data models, env vars and config the changed code uses. For a route, use route_details instead. ${budgetNote}`,
    inputSchema: objectSchema({
      symbol: { type: "string", description: "Function, method or class name (a class covers all its methods)." },
      file: { type: "string", description: "Scan-relative file path or path suffix. Alone, covers every function in the file; with symbol, narrows it." },
      maxDepth,
      limit: limit(50),
    }),
  },
  {
    name: "detect_changes",
    description: `Map the git working tree's changes (against base, including untracked files) onto the graph: changed files, the declarations their changed lines touch, and the impact of the changed functions as in impact_of. Changed files missing from the graph are listed under unscannedFiles. ${budgetNote}`,
    inputSchema: objectSchema({
      base: { type: "string", description: "Revision to diff against, such as HEAD, main or HEAD~3. Defaults to HEAD." },
      maxDepth,
      limit: limit(50),
    }),
  },
  {
    name: "route_details",
    description: `Everything that runs for an HTTP route: handlers, middleware and lifecycle steps in order, the downstream call chain (up to 4 levels), and the data access, env vars and config of the route and that chain. ${budgetNote}`,
    inputSchema: objectSchema({
      method: { type: "string", description: "HTTP method, case-insensitive (GET, post, ...)." },
      path: { type: "string", description: "Route path, matched against the resolved full path or the path as declared." },
      limit: limit(5),
    }, ["method", "path"]),
  },
  {
    name: "get_symbol_source",
    description: `Source code of a declaration, read from disk with the line span from the last scan (at most 400 lines each). ${budgetNote}`,
    inputSchema: objectSchema({
      name: { type: "string", description: "Exact declaration name; Class.method selects one class's method." },
      file: { type: "string", description: "Optional scan-relative file path or path suffix." },
      kind: { type: "string", description: "Optional kind: function, method, class, interface, type, enum or variable." },
      limit: limit(5),
    }, ["name"]),
  },
  {
    name: "get_file_outline",
    description: `Declarations of one file from the graph in line order: imports, functions, classes with their methods and fields, interfaces, types, enums, variables, routes and entrypoints. ${budgetNote}`,
    inputSchema: objectSchema({
      file: { type: "string", description: "Scan-relative file path or a unique path suffix." },
    }, ["file"]),
  },
];

const handlers: Record<string, (engine: IQueryEngine, args: Record<string, unknown>) => Promise<Record<string, unknown>>> = {
  impact_of: impactOf,
  detect_changes: detectChanges,
  route_details: routeDetails,
  get_symbol_source: getSymbolSource,
  get_file_outline: getFileOutline,
};

// Runs an agent tool, or returns undefined when `name` is not one.
export async function callAgentTool(
  engine: IQueryEngine,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const handler = Object.hasOwn(handlers, name) ? handlers[name] : undefined;
  return handler && fitToBudget(await handler(engine, args));
}
