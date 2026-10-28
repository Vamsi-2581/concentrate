import type { IQueryEngine } from "../../../core/contracts/query-engine.js";
import { optionalString } from "../args.js";
import type { PageWindow } from "../paging.js";
import { loadImports } from "./model.js";

type Row = Record<string, unknown>;

// Edge attributes per (from, to) pair; `runtime` is false when every import
// behind the edge is type-only.
type Edge = { runtime: boolean; types: Set<string> };
type Graph = Map<string, Map<string, Edge>>;

const MAX_LISTED_MEMBERS = 30;

// find_import_cycles: strongly connected components of the file import graph
// (or of the package dependency graph), largest first, each with one shortest
// cycle through its first member.
export async function findImportCycles(engine: IQueryEngine, args: Record<string, unknown>, window: PageWindow) {
  const scope = optionalString(args.scope) ?? "file";
  if (scope !== "file" && scope !== "package") throw new Error(`Unknown scope ${JSON.stringify(scope)}; expected file or package`);
  const graph = scope === "file" ? await fileGraph(engine) : await packageGraph(engine);

  const components = stronglyConnected(graph).map((members) => {
    const inside = new Set(members);
    const start = members[0]!;
    const runtimeCycle = shortestCycle(graph, start, inside, true);
    const cycle = runtimeCycle ?? shortestCycle(graph, start, inside, false)!;
    const types = new Set<string>();
    for (let index = 0; index + 1 < cycle.length; index++) {
      for (const type of graph.get(cycle[index]!)!.get(cycle[index + 1]!)!.types) types.add(type);
    }
    return {
      size: members.length,
      members: members.slice(0, MAX_LISTED_MEMBERS),
      ...(members.length > MAX_LISTED_MEMBERS ? { moreMembers: members.length - MAX_LISTED_MEMBERS } : {}),
      cycle,
      ...(scope === "file" ? { typeOnly: runtimeCycle === null } : { dependencyTypes: [...types].sort() }),
    };
  }).sort((a, b) => b.size - a.size || a.cycle[0]!.localeCompare(b.cycle[0]!));

  return {
    scope,
    total: components.length,
    ...(scope === "file" ? { runtimeCycles: components.filter((component) => "typeOnly" in component && !component.typeOnly).length } : {}),
    cycles: window.take(components),
    note: scope === "file"
      ? "Each entry is a group of files that import each other directly or indirectly; cycle is one shortest loop through the group. typeOnly: true means every loop goes through a type-only import, which usually disappears at runtime."
      : "Each entry is a group of workspace packages that depend on each other; dependencyTypes lists the dependency kinds on the example cycle (internalImport means a source import without a manifest entry).",
  };
}

async function fileGraph(engine: IQueryEngine): Promise<Graph> {
  const graph: Graph = new Map();
  for (const edge of await loadImports(engine)) {
    if (!edge.target || edge.target === edge.file) continue;
    const existing = link(graph, edge.file, edge.target);
    existing.runtime ||= !edge.isTypeOnly;
  }
  return graph;
}

async function packageGraph(engine: IQueryEngine): Promise<Graph> {
  const rows = await engine.query(`
    MATCH (from:Package)-[rel:PACKAGE_IMPORTS_PACKAGE]->(to:Package)
    RETURN coalesce(from.name, from.relativePath) AS source, coalesce(to.name, to.relativePath) AS target,
      rel.dependencyType AS dependencyType
  `) as Row[];
  const graph: Graph = new Map();
  for (const row of rows) {
    const source = String(row.source);
    const target = String(row.target);
    if (source === target) continue;
    const edge = link(graph, source, target);
    edge.runtime = true;
    if (typeof row.dependencyType === "string") edge.types.add(row.dependencyType);
  }
  return graph;
}

function link(graph: Graph, from: string, to: string): Edge {
  let targets = graph.get(from);
  if (!targets) graph.set(from, targets = new Map());
  if (!graph.has(to)) graph.set(to, new Map());
  let edge = targets.get(to);
  if (!edge) targets.set(to, edge = { runtime: false, types: new Set() });
  return edge;
}

// Tarjan's algorithm without recursion. Returns the components with more than
// one member, each sorted, in no particular order.
export function stronglyConnected(graph: Graph): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  for (const root of [...graph.keys()].sort()) {
    if (index.has(root)) continue;
    const work: Array<{ node: string; next: Iterator<string> }> = [];
    const open = (node: string) => {
      index.set(node, counter);
      low.set(node, counter);
      counter++;
      stack.push(node);
      onStack.add(node);
      work.push({ node, next: [...graph.get(node)!.keys()].sort()[Symbol.iterator]() });
    };
    open(root);
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const step = frame.next.next();
      if (!step.done) {
        const neighbour = step.value;
        if (!index.has(neighbour)) open(neighbour);
        else if (onStack.has(neighbour)) low.set(frame.node, Math.min(low.get(frame.node)!, index.get(neighbour)!));
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!));
      if (low.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.node);
        if (component.length > 1) components.push(component.sort());
      }
    }
  }
  return components;
}

// Shortest path from `start` back to itself inside one component, as a list
// of nodes ending with `start` again; runtime-only when asked.
function shortestCycle(graph: Graph, start: string, inside: Set<string>, runtimeOnly: boolean): string[] | null {
  const previous = new Map<string, string>();
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head]!;
    for (const [next, edge] of [...graph.get(node)!].sort(([a], [b]) => a.localeCompare(b))) {
      if (!inside.has(next) || (runtimeOnly && !edge.runtime)) continue;
      if (next === start) {
        const chain: string[] = [];
        for (let at = node; at !== start; at = previous.get(at)!) chain.push(at);
        return [start, ...chain.reverse(), start];
      }
      if (previous.has(next)) continue;
      previous.set(next, node);
      queue.push(next);
    }
  }
  return null;
}
