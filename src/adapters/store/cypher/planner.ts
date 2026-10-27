import { INDEXED_PROPERTIES, type MemoryGraph } from "../graph.js";
import type { Scope } from "./binder.js";
import type { Expression, MatchClause, NodePattern, PatternPart, RelationshipPattern } from "./ast.js";

/**
 * How one MATCH clause is evaluated. Each pattern part starts from its most
 * selective node (one already bound, one found through a value index, or the
 * smallest label set), then expands right and left along its chain. Every
 * WHERE conjunct runs at the first point where all of its variables are bound.
 */

export type NodeTarget = {
  name: string;
  pattern: NodePattern;
  labels: ReadonlySet<string>;
  /** Bound before this point in the plan, so the match must be the same node. */
  bound: boolean;
};

export type ExpandStep = {
  /** Variable of the node this step leaves from. */
  source: string;
  relationship: RelationshipPattern;
  relationshipName: string;
  /** Walking right-to-left, so the pattern's direction is flipped. */
  reversed: boolean;
  target: NodeTarget;
  /** Conjuncts that can run once this step has bound its variables. */
  filters: Expression[];
};

export type StartLookup = { property: string; value: Expression };

export type PartPlan = {
  start: NodeTarget;
  /** Use a value index for the start node instead of scanning its labels. */
  lookup?: StartLookup;
  startFilters: Expression[];
  steps: ExpandStep[];
};

export type MatchPlan = {
  /** Conjuncts over variables bound before the clause. */
  filters: Expression[];
  parts: PartPlan[];
  /** Variables the clause introduces; OPTIONAL MATCH sets them to null when nothing matches. */
  introduced: string[];
};

export function planMatch(
  clause: MatchClause,
  before: Scope,
  after: Scope,
  nameOf: (element: NodePattern | RelationshipPattern) => string,
  graph: MemoryGraph,
  estimate: (lookup: StartLookup, labels: readonly string[]) => number | undefined,
): MatchPlan {
  const bound = new Set(before.keys());
  const pending = (clause.where ? splitConjuncts(clause.where) : []).map((expression) => ({ expression, variables: variablesOf(expression) }));
  const take = (): Expression[] => {
    const ready = pending.filter((conjunct) => [...conjunct.variables].every((name) => bound.has(name)));
    for (const conjunct of ready) pending.splice(pending.indexOf(conjunct), 1);
    return ready.map((conjunct) => conjunct.expression);
  };

  const filters = take();
  const parts: PartPlan[] = [];
  const labelsOf = (name: string): string[] => {
    const info = after.get(name);
    return info?.kind === "node" ? [...info.labels] : [];
  };
  const target = (node: NodePattern): NodeTarget => {
    const name = nameOf(node);
    return { name, pattern: node, labels: new Set(labelsOf(name)), bound: bound.has(name) };
  };

  for (const part of clause.patterns) {
    const { index, lookup } = chooseStart(part, bound, nameOf, labelsOf, graph, estimate, pending.map((conjunct) => conjunct.expression));
    const start = target(part.nodes[index]!);
    bound.add(start.name);
    const startFilters = take();
    const steps: ExpandStep[] = [];
    let source = start.name;
    const addStep = (relationship: RelationshipPattern, node: NodePattern, reversed: boolean) => {
      const relationshipName = nameOf(relationship);
      const stepTarget = target(node);
      bound.add(relationshipName);
      bound.add(stepTarget.name);
      steps.push({ source, relationship, relationshipName, reversed, target: stepTarget, filters: take() });
      source = stepTarget.name;
    };
    for (let i = index; i < part.relationships.length; i += 1) addStep(part.relationships[i]!, part.nodes[i + 1]!, false);
    source = start.name;
    for (let i = index - 1; i >= 0; i -= 1) addStep(part.relationships[i]!, part.nodes[i]!, true);
    parts.push({ start, lookup, startFilters, steps });
  }

  const introduced = [...after.keys()].filter((name) => !before.has(name));
  return { filters, parts, introduced };
}

function chooseStart(
  part: PatternPart,
  bound: ReadonlySet<string>,
  nameOf: (element: NodePattern | RelationshipPattern) => string,
  labelsOf: (name: string) => string[],
  graph: MemoryGraph,
  estimate: (lookup: StartLookup, labels: readonly string[]) => number | undefined,
  conjuncts: readonly Expression[],
): { index: number; lookup?: StartLookup } {
  let best: { index: number; lookup?: StartLookup; cost: number } | undefined;
  part.nodes.forEach((node, index) => {
    const name = nameOf(node);
    const consider = (cost: number, lookup?: StartLookup) => {
      if (!best || cost < best.cost) best = { index, lookup, cost };
    };
    if (bound.has(name)) {
      consider(-1);
      return;
    }
    const labels = labelsOf(name);
    consider(labels.reduce((total, label) => total + graph.nodesWithLabel(label).size, 0));
    for (const lookup of indexedEqualities(name, node, conjuncts)) {
      const cost = estimate(lookup, labels);
      if (cost !== undefined) consider(cost, lookup);
    }
  });
  return best!;
}

/** `{name: 'x'}` and `WHERE v.name = 'x'` (or `$param`) on an indexed property. */
function indexedEqualities(name: string, node: NodePattern, conjuncts: readonly Expression[]): StartLookup[] {
  const indexed = (property: string) => (INDEXED_PROPERTIES as readonly string[]).includes(property);
  const constant = (expression: Expression) => expression.kind === "literal" || expression.kind === "parameter";
  const lookups: StartLookup[] = [];
  for (const [property, value] of node.properties) {
    if (indexed(property) && constant(value)) lookups.push({ property, value });
  }
  for (const conjunct of conjuncts) {
    if (conjunct.kind !== "binary" || conjunct.operator !== "=") continue;
    for (const [side, other] of [[conjunct.left, conjunct.right], [conjunct.right, conjunct.left]] as const) {
      if (side.kind === "property" && side.object.kind === "variable" && side.object.name === name && indexed(side.name) && constant(other)) {
        lookups.push({ property: side.name, value: other });
      }
    }
  }
  return lookups;
}

export function splitConjuncts(expression: Expression): Expression[] {
  if (expression.kind === "binary" && expression.operator === "AND") {
    return [...splitConjuncts(expression.left), ...splitConjuncts(expression.right)];
  }
  return [expression];
}

export function variablesOf(expression: Expression, into = new Set<string>()): Set<string> {
  switch (expression.kind) {
    case "variable":
      into.add(expression.name);
      break;
    case "property":
      variablesOf(expression.object, into);
      break;
    case "list":
      expression.items.forEach((item) => variablesOf(item, into));
      break;
    case "unary":
    case "isNull":
      variablesOf(expression.operand, into);
      break;
    case "binary":
      variablesOf(expression.left, into);
      variablesOf(expression.right, into);
      break;
    case "call":
      expression.args.forEach((argument) => variablesOf(argument, into));
      break;
    case "case":
      if (expression.subject) variablesOf(expression.subject, into);
      for (const [condition, result] of expression.branches) {
        variablesOf(condition, into);
        variablesOf(result, into);
      }
      if (expression.otherwise) variablesOf(expression.otherwise, into);
      break;
    default:
      break;
  }
  return into;
}
