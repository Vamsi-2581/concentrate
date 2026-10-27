/** Syntax tree for the supported Cypher subset. */

export type Query = { clauses: Clause[] };

export type Clause = MatchClause | ProjectionClause;

export type MatchClause = {
  kind: "match";
  optional: boolean;
  patterns: PatternPart[];
  where?: Expression;
};

export type ProjectionClause = {
  kind: "with" | "return";
  distinct: boolean;
  items: ProjectionItem[];
  orderBy: OrderItem[];
  skip?: Expression;
  limit?: Expression;
  /** Only on WITH. */
  where?: Expression;
};

export type ProjectionItem = {
  expression: Expression;
  alias?: string;
  /** Source text, used as the column name when there is no alias. */
  text: string;
};

export type OrderItem = { expression: Expression; descending: boolean };

/** A chain `(n0)-[r0]-(n1)-[r1]-(n2)...`: `relationships[i]` connects `nodes[i]` and `nodes[i + 1]`. */
export type PatternPart = { nodes: NodePattern[]; relationships: RelationshipPattern[] };

export type NodePattern = {
  variable?: string;
  labels: string[];
  properties: Array<[string, Expression]>;
};

export type Direction = "out" | "in" | "both";

export type RelationshipPattern = {
  variable?: string;
  types: string[];
  direction: Direction;
  /** Present for variable-length relationships (`*min..max`). */
  hops?: { min: number; max: number };
  properties: Array<[string, Expression]>;
};

export type Expression =
  | { kind: "literal"; value: string | number | boolean | null; float?: boolean }
  | { kind: "parameter"; name: string }
  | { kind: "variable"; name: string }
  | { kind: "property"; object: Expression; name: string }
  | { kind: "list"; items: Expression[] }
  | { kind: "unary"; operator: "NOT" | "-" | "+"; operand: Expression }
  | { kind: "binary"; operator: BinaryOperator; left: Expression; right: Expression }
  | { kind: "isNull"; operand: Expression; negated: boolean }
  | { kind: "call"; name: string; args: Expression[]; distinct: boolean; star: boolean }
  | { kind: "case"; subject?: Expression; branches: Array<[Expression, Expression]>; otherwise?: Expression };

export type BinaryOperator =
  | "OR" | "XOR" | "AND"
  | "=" | "<>" | "<" | ">" | "<=" | ">="
  | "IN" | "STARTS WITH" | "ENDS WITH" | "CONTAINS"
  | "+" | "-" | "*" | "/" | "%";
