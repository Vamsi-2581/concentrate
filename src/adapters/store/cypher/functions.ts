import { NodeRecord, RelationshipRecord } from "../graph.js";
import type { StaticType } from "./binder.js";
import { CypherError } from "./errors.js";
import { compareForSort, valueKey, type Value } from "./values.js";

export type ScalarFunction = {
  minArgs: number;
  maxArgs: number;
  resultType(args: StaticType[]): StaticType;
  call(args: Value[]): Value;
};

export type Accumulator = {
  add(value: Value): void;
  result(): Value;
};

export type AggregateFunction = {
  resultType(argument: StaticType): StaticType;
  create(distinct: boolean): Accumulator;
};

const stringFunction = (transform: (value: string) => Value, result: StaticType = "STRING"): ScalarFunction => ({
  minArgs: 1,
  maxArgs: 1,
  resultType: () => result,
  call: ([value]) => {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") throw new CypherError("runtime", `expected a string, got ${describe(value)}`);
    return transform(value);
  },
});

const stringPredicate = (test: (value: string, search: string) => boolean): ScalarFunction => ({
  minArgs: 2,
  maxArgs: 2,
  resultType: () => "BOOL",
  call: ([value, search]) => {
    if (value === null || search === null || value === undefined || search === undefined) return null;
    if (typeof value !== "string" || typeof search !== "string") {
      throw new CypherError("runtime", `expected strings, got ${describe(value)} and ${describe(search)}`);
    }
    return test(value, search);
  },
});

const lower = stringFunction((value) => value.toLowerCase());
const upper = stringFunction((value) => value.toUpperCase());

const label: ScalarFunction = {
  minArgs: 1,
  maxArgs: 1,
  resultType: () => "STRING",
  call: ([value]) => {
    if (value instanceof NodeRecord) return value.label;
    if (value instanceof RelationshipRecord) return value.type;
    if (value === null) return null;
    throw new CypherError("runtime", `label() expects a node or relationship, got ${describe(value)}`);
  },
};

export const SCALAR_FUNCTIONS: Readonly<Record<string, ScalarFunction>> = {
  lower,
  tolower: lower,
  upper,
  toupper: upper,
  contains: stringPredicate((value, search) => value.includes(search)),
  starts_with: stringPredicate((value, search) => value.startsWith(search)),
  ends_with: stringPredicate((value, search) => value.endsWith(search)),
  size: {
    minArgs: 1,
    maxArgs: 1,
    resultType: () => "INT",
    call: ([value]) => {
      if (value === null) return null;
      if (typeof value === "string") return [...value].length;
      if (Array.isArray(value)) return value.length;
      throw new CypherError("runtime", `size() expects a string or list, got ${describe(value!)}`);
    },
  },
  coalesce: {
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    resultType: (args) => {
      const types = new Set(args.filter((type) => type !== "NULL"));
      return types.size === 1 ? [...types][0]! : "ANY";
    },
    call: (args) => args.find((value) => value !== null) ?? null,
  },
  label,
  labels: {
    ...label,
    resultType: () => "LIST",
    call: (args) => {
      const result = label.call(args);
      return result === null ? null : [result];
    },
  },
  id: {
    minArgs: 1,
    maxArgs: 1,
    resultType: () => "STRING",
    call: ([value]) => {
      if (value instanceof NodeRecord) return value.id;
      if (value === null) return null;
      throw new CypherError("runtime", `id() expects a node, got ${describe(value!)}`);
    },
  },
};

/** Accumulates distinct non-null values when DISTINCT was given, every non-null value otherwise. */
function nonNull(distinct: boolean, onValue: (value: Value) => void): (value: Value) => void {
  const seen = new Set<string>();
  return (value) => {
    if (value === null) return;
    if (distinct) {
      const key = valueKey(value);
      if (seen.has(key)) return;
      seen.add(key);
    }
    onValue(value);
  };
}

function requireNumber(name: string, value: Value): number {
  if (typeof value !== "number") throw new CypherError("runtime", `${name}() expects numbers, got ${describe(value)}`);
  return value;
}

export const AGGREGATE_FUNCTIONS: Readonly<Record<string, AggregateFunction>> = {
  count: {
    resultType: () => "INT",
    create(distinct) {
      let count = 0;
      return { add: nonNull(distinct, () => { count += 1; }), result: () => count };
    },
  },
  // Like Kuzu, collect() skips nulls and returns NULL rather than [] when nothing was collected.
  collect: {
    resultType: () => "LIST",
    create(distinct) {
      const values: Value[] = [];
      return { add: nonNull(distinct, (value) => values.push(value)), result: () => (values.length > 0 ? values : null) };
    },
  },
  min: extreme((comparison) => comparison < 0),
  max: extreme((comparison) => comparison > 0),
  sum: {
    resultType: (argument) => (argument === "INT" ? "INT" : "FLOAT"),
    create(distinct) {
      let sum: number | null = null;
      return { add: nonNull(distinct, (value) => { sum = (sum ?? 0) + requireNumber("sum", value); }), result: () => sum };
    },
  },
  avg: {
    resultType: () => "FLOAT",
    create(distinct) {
      let sum = 0;
      let count = 0;
      return {
        add: nonNull(distinct, (value) => {
          sum += requireNumber("avg", value);
          count += 1;
        }),
        result: () => (count > 0 ? sum / count : null),
      };
    },
  },
};

function extreme(better: (comparison: number) => boolean): AggregateFunction {
  return {
    resultType: (argument) => argument,
    create(distinct) {
      let best: Value = null;
      return {
        add: nonNull(distinct, (value) => {
          if (best === null || better(compareForSort(value, best))) best = value;
        }),
        result: () => best,
      };
    },
  };
}

function describe(value: Value): string {
  if (value instanceof NodeRecord) return "a node";
  if (value instanceof RelationshipRecord) return "a relationship";
  if (Array.isArray(value)) return "a list";
  return JSON.stringify(value);
}
