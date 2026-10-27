import type {
  BinaryOperator,
  Clause,
  Direction,
  Expression,
  MatchClause,
  NodePattern,
  OrderItem,
  PatternPart,
  ProjectionClause,
  ProjectionItem,
  Query,
  RelationshipPattern,
} from "./ast.js";
import { CypherError, unsupported } from "./errors.js";
import { describePosition, tokenize, type Token } from "./lexer.js";

/** Kuzu's default upper bound for `*` and `*min..`. */
export const DEFAULT_MAX_HOPS = 30;

const UNSUPPORTED_CLAUSES = new Set([
  "CREATE", "MERGE", "DELETE", "DETACH", "SET", "REMOVE", "UNWIND", "CALL", "FOREACH",
  "LOAD", "COPY", "DROP", "ALTER", "INSTALL", "EXPLAIN", "PROFILE", "USE", "BEGIN", "COMMIT", "ROLLBACK",
]);

/** Keywords that cannot name a variable. Clause keywords such as CALL only matter where a clause starts (`MATCH (call:Call)` is fine). */
const RESERVED = new Set([
  "MATCH", "OPTIONAL", "WHERE", "WITH", "RETURN", "ORDER", "BY", "SKIP", "LIMIT", "AS", "DISTINCT",
  "AND", "OR", "XOR", "NOT", "IN", "IS", "NULL", "TRUE", "FALSE", "STARTS", "ENDS", "CONTAINS",
  "CASE", "WHEN", "THEN", "ELSE", "END", "ASC", "ASCENDING", "DESC", "DESCENDING", "UNION",
]);

export function parseCypher(source: string): Query {
  return new Parser(source).parseQuery();
}

class Parser {
  private readonly tokens: Token[];
  private position = 0;

  constructor(private readonly source: string) {
    this.tokens = tokenize(source);
  }

  parseQuery(): Query {
    const clauses: Clause[] = [];
    while (!this.atEnd()) {
      const keyword = this.keyword();
      if (keyword && UNSUPPORTED_CLAUSES.has(keyword)) throw unsupported(keyword === "DETACH" ? "DETACH DELETE" : keyword);
      if (keyword === "UNION") throw unsupported("UNION");
      if (keyword === "MATCH" || keyword === "OPTIONAL") clauses.push(this.parseMatch());
      else if (keyword === "WITH") clauses.push(this.parseProjection("with"));
      else if (keyword === "RETURN") {
        clauses.push(this.parseProjection("return"));
        if (this.isKeyword("UNION")) throw unsupported("UNION");
        this.acceptSymbol(";");
        if (!this.atEnd()) this.fail("expected end of query after RETURN");
      } else this.fail("expected MATCH, OPTIONAL MATCH, WITH or RETURN");
    }
    if (clauses.length === 0) this.fail("empty query");
    if (clauses.at(-1)!.kind !== "return") {
      throw new CypherError("parser", "a query must end with RETURN (the query surface is read-only)");
    }
    return { clauses };
  }

  // --- Clauses -------------------------------------------------------------

  private parseMatch(): MatchClause {
    const optional = this.acceptKeyword("OPTIONAL");
    this.expectKeyword("MATCH");
    const patterns = [this.parsePattern()];
    while (this.acceptSymbol(",")) patterns.push(this.parsePattern());
    const where = this.acceptKeyword("WHERE") ? this.parseExpression() : undefined;
    return { kind: "match", optional, patterns, ...(where ? { where } : {}) };
  }

  private parseProjection(kind: "with" | "return"): ProjectionClause {
    this.expectKeyword(kind.toUpperCase());
    const distinct = this.acceptKeyword("DISTINCT");
    if (this.isSymbol("*")) throw unsupported(`${kind.toUpperCase()} *`);
    const items: ProjectionItem[] = [this.parseProjectionItem()];
    while (this.acceptSymbol(",")) items.push(this.parseProjectionItem());

    const orderBy: OrderItem[] = [];
    if (this.acceptKeyword("ORDER")) {
      this.expectKeyword("BY");
      do {
        const expression = this.parseExpression();
        let descending = false;
        if (this.acceptKeyword("DESC") || this.acceptKeyword("DESCENDING")) descending = true;
        else if (!this.acceptKeyword("ASC")) this.acceptKeyword("ASCENDING");
        orderBy.push({ expression, descending });
      } while (this.acceptSymbol(","));
    }
    const skip = this.acceptKeyword("SKIP") ? this.parseExpression() : undefined;
    const limit = this.acceptKeyword("LIMIT") ? this.parseExpression() : undefined;
    const where = kind === "with" && this.acceptKeyword("WHERE") ? this.parseExpression() : undefined;
    return {
      kind,
      distinct,
      items,
      orderBy,
      ...(skip ? { skip } : {}),
      ...(limit ? { limit } : {}),
      ...(where ? { where } : {}),
    };
  }

  private parseProjectionItem(): ProjectionItem {
    const startToken = this.peek();
    const expression = this.parseExpression();
    const text = this.source.slice(startToken.start, this.tokens[this.position - 1]!.end).replace(/\s+/g, " ").trim();
    if (this.acceptKeyword("AS")) {
      return { expression, alias: this.expectName("an alias after AS", true), text };
    }
    return { expression, text };
  }

  // --- Patterns ------------------------------------------------------------

  private parsePattern(): PatternPart {
    if (this.peek().kind === "identifier" && this.peekAt(1).kind === "symbol" && this.peekAt(1).value === "=") {
      throw unsupported("named paths (p = ...)");
    }
    const nodes = [this.parseNodePattern()];
    const relationships: RelationshipPattern[] = [];
    while (this.isSymbol("-") || this.isSymbol("<")) {
      relationships.push(this.parseRelationshipPattern());
      nodes.push(this.parseNodePattern());
    }
    return { nodes, relationships };
  }

  private parseNodePattern(): NodePattern {
    this.expectSymbol("(");
    const variable = this.peek().kind === "identifier" ? this.expectName("a variable") : undefined;
    const labels: string[] = [];
    if (this.acceptSymbol(":")) {
      labels.push(this.expectName("a label", true));
      while (this.acceptSymbol(":") || this.acceptSymbol("|")) labels.push(this.expectName("a label", true));
    }
    const properties = this.isSymbol("{") ? this.parsePropertyMap() : [];
    this.expectSymbol(")");
    return { ...(variable ? { variable } : {}), labels, properties };
  }

  private parseRelationshipPattern(): RelationshipPattern {
    const leftArrow = this.acceptSymbol("<");
    this.expectSymbol("-");

    let variable: string | undefined;
    const types: string[] = [];
    let hops: RelationshipPattern["hops"];
    let properties: Array<[string, Expression]> = [];
    if (this.acceptSymbol("[")) {
      if (this.peek().kind === "identifier") variable = this.expectName("a variable");
      if (this.acceptSymbol(":")) {
        types.push(this.expectName("a relationship type", true));
        while (this.acceptSymbol("|")) {
          this.acceptSymbol(":");
          types.push(this.expectName("a relationship type", true));
        }
      }
      if (this.acceptSymbol("*")) hops = this.parseHops();
      if (this.isSymbol("{")) properties = this.parsePropertyMap();
      this.expectSymbol("]");
    }

    this.expectSymbol("-");
    const rightArrow = this.acceptSymbol(">");
    if (leftArrow && rightArrow) this.fail("a relationship cannot point both ways");
    const direction: Direction = leftArrow ? "in" : rightArrow ? "out" : "both";
    return { ...(variable ? { variable } : {}), types, direction, ...(hops ? { hops } : {}), properties };
  }

  private parseHops(): { min: number; max: number } {
    const first = this.peek().kind === "integer" ? Number(this.next().value) : undefined;
    if (this.acceptSymbol("..")) {
      const second = this.peek().kind === "integer" ? Number(this.next().value) : undefined;
      return { min: first ?? 1, max: second ?? DEFAULT_MAX_HOPS };
    }
    return first === undefined ? { min: 1, max: DEFAULT_MAX_HOPS } : { min: first, max: first };
  }

  private parsePropertyMap(): Array<[string, Expression]> {
    this.expectSymbol("{");
    const entries: Array<[string, Expression]> = [];
    if (!this.isSymbol("}")) {
      do {
        const key = this.expectName("a property name", true);
        this.expectSymbol(":");
        entries.push([key, this.parseExpression()]);
      } while (this.acceptSymbol(","));
    }
    this.expectSymbol("}");
    return entries;
  }

  // --- Expressions (lowest precedence first) ---------------------------------

  private parseExpression(): Expression {
    return this.parseOr();
  }

  private parseOr(): Expression {
    let left = this.parseXor();
    while (this.acceptKeyword("OR")) left = binary("OR", left, this.parseXor());
    return left;
  }

  private parseXor(): Expression {
    let left = this.parseAnd();
    while (this.acceptKeyword("XOR")) left = binary("XOR", left, this.parseAnd());
    return left;
  }

  private parseAnd(): Expression {
    let left = this.parseNot();
    while (this.acceptKeyword("AND")) left = binary("AND", left, this.parseNot());
    return left;
  }

  private parseNot(): Expression {
    if (this.acceptKeyword("NOT")) return { kind: "unary", operator: "NOT", operand: this.parseNot() };
    return this.parseComparison();
  }

  private parseComparison(): Expression {
    let left = this.parseAdditive();
    for (;;) {
      const symbol = this.peek();
      if (symbol.kind === "symbol" && ["=", "<>", "!=", "<", ">", "<=", ">="].includes(symbol.value)) {
        this.next();
        const operator = (symbol.value === "!=" ? "<>" : symbol.value) as BinaryOperator;
        left = binary(operator, left, this.parseAdditive());
      } else if (this.acceptKeyword("IS")) {
        const negated = this.acceptKeyword("NOT");
        this.expectKeyword("NULL");
        left = { kind: "isNull", operand: left, negated };
      } else if (this.acceptKeyword("IN")) {
        left = binary("IN", left, this.parseAdditive());
      } else if (this.acceptKeyword("STARTS")) {
        this.expectKeyword("WITH");
        left = binary("STARTS WITH", left, this.parseAdditive());
      } else if (this.acceptKeyword("ENDS")) {
        this.expectKeyword("WITH");
        left = binary("ENDS WITH", left, this.parseAdditive());
      } else if (this.acceptKeyword("CONTAINS")) {
        left = binary("CONTAINS", left, this.parseAdditive());
      } else {
        return left;
      }
    }
  }

  private parseAdditive(): Expression {
    let left = this.parseMultiplicative();
    for (;;) {
      if (this.acceptSymbol("+")) left = binary("+", left, this.parseMultiplicative());
      else if (this.acceptSymbol("-")) left = binary("-", left, this.parseMultiplicative());
      else return left;
    }
  }

  private parseMultiplicative(): Expression {
    let left = this.parseUnary();
    for (;;) {
      if (this.acceptSymbol("*")) left = binary("*", left, this.parseUnary());
      else if (this.acceptSymbol("/")) left = binary("/", left, this.parseUnary());
      else if (this.acceptSymbol("%")) left = binary("%", left, this.parseUnary());
      else return left;
    }
  }

  private parseUnary(): Expression {
    if (this.acceptSymbol("-")) {
      const operand = this.parseUnary();
      if (operand.kind === "literal" && typeof operand.value === "number") {
        return { ...operand, value: -operand.value };
      }
      return { kind: "unary", operator: "-", operand };
    }
    if (this.acceptSymbol("+")) return { kind: "unary", operator: "+", operand: this.parseUnary() };
    return this.parsePostfix();
  }

  private parsePostfix(): Expression {
    let expression = this.parseAtom();
    while (this.acceptSymbol(".")) {
      expression = { kind: "property", object: expression, name: this.expectName("a property name", true) };
    }
    if (this.isSymbol("[")) throw unsupported("list indexing and slicing");
    return expression;
  }

  private parseAtom(): Expression {
    const token = this.peek();
    switch (token.kind) {
      case "string":
        this.next();
        return { kind: "literal", value: token.value };
      case "integer":
        this.next();
        return { kind: "literal", value: Number(token.value) };
      case "float":
        this.next();
        return { kind: "literal", value: Number(token.value), float: true };
      case "parameter":
        this.next();
        return { kind: "parameter", name: token.value };
      case "symbol":
        if (this.acceptSymbol("(")) {
          const inner = this.parseExpression();
          this.expectSymbol(")");
          return inner;
        }
        if (this.acceptSymbol("[")) {
          const items: Expression[] = [];
          if (!this.isSymbol("]")) {
            do items.push(this.parseExpression()); while (this.acceptSymbol(","));
          }
          this.expectSymbol("]");
          return { kind: "list", items };
        }
        if (token.value === "{") throw unsupported("map literals");
        break;
      case "identifier": {
        const keyword = this.keyword();
        if (keyword === "TRUE" || keyword === "FALSE") {
          this.next();
          return { kind: "literal", value: keyword === "TRUE" };
        }
        if (keyword === "NULL") {
          this.next();
          return { kind: "literal", value: null };
        }
        if (keyword === "CASE") return this.parseCase();
        if (keyword === "EXISTS") throw unsupported("EXISTS");
        if (this.peekAt(1).kind === "symbol" && this.peekAt(1).value === "(") return this.parseCall();
        if (keyword && RESERVED.has(keyword)) break;
        this.next();
        return { kind: "variable", name: token.value };
      }
      default:
        break;
    }
    return this.fail("expected an expression");
  }

  private parseCall(): Expression {
    const name = this.next().value;
    this.expectSymbol("(");
    if (this.acceptSymbol("*")) {
      this.expectSymbol(")");
      return { kind: "call", name, args: [], distinct: false, star: true };
    }
    const distinct = this.acceptKeyword("DISTINCT");
    const args: Expression[] = [];
    if (!this.isSymbol(")")) {
      do args.push(this.parseExpression()); while (this.acceptSymbol(","));
    }
    this.expectSymbol(")");
    return { kind: "call", name, args, distinct, star: false };
  }

  private parseCase(): Expression {
    this.expectKeyword("CASE");
    const subject = this.isKeyword("WHEN") ? undefined : this.parseExpression();
    const branches: Array<[Expression, Expression]> = [];
    while (this.acceptKeyword("WHEN")) {
      const condition = this.parseExpression();
      this.expectKeyword("THEN");
      branches.push([condition, this.parseExpression()]);
    }
    if (branches.length === 0) this.fail("expected WHEN in CASE");
    const otherwise = this.acceptKeyword("ELSE") ? this.parseExpression() : undefined;
    this.expectKeyword("END");
    return { kind: "case", ...(subject ? { subject } : {}), branches, ...(otherwise ? { otherwise } : {}) };
  }

  // --- Tokens --------------------------------------------------------------

  private peek(): Token {
    return this.tokens[this.position]!;
  }

  private peekAt(offset: number): Token {
    return this.tokens[Math.min(this.position + offset, this.tokens.length - 1)]!;
  }

  private next(): Token {
    const token = this.tokens[this.position]!;
    if (token.kind !== "eof") this.position += 1;
    return token;
  }

  private atEnd(): boolean {
    return this.peek().kind === "eof";
  }

  private keyword(): string | undefined {
    const token = this.peek();
    return token.kind === "identifier" && !token.quoted ? token.value.toUpperCase() : undefined;
  }

  private isKeyword(keyword: string): boolean {
    return this.keyword() === keyword;
  }

  private acceptKeyword(keyword: string): boolean {
    if (!this.isKeyword(keyword)) return false;
    this.next();
    return true;
  }

  private expectKeyword(keyword: string): void {
    if (!this.acceptKeyword(keyword)) this.fail(`expected ${keyword}`);
  }

  private isSymbol(symbol: string): boolean {
    const token = this.peek();
    return token.kind === "symbol" && token.value === symbol;
  }

  private acceptSymbol(symbol: string): boolean {
    if (!this.isSymbol(symbol)) return false;
    this.next();
    return true;
  }

  private expectSymbol(symbol: string): void {
    if (!this.acceptSymbol(symbol)) this.fail(`expected "${symbol}"`);
  }

  /** Labels, types and property names may be keywords (`:Call`); variables and aliases may not unless quoted. */
  private expectName(what: string, keywordAllowed = false): string {
    const token = this.peek();
    if (token.kind !== "identifier" || (!keywordAllowed && !token.quoted && RESERVED.has(token.value.toUpperCase()))) {
      this.fail(`expected ${what}`);
    }
    return this.next().value;
  }

  private fail(message: string): never {
    throw new CypherError("parser", `${message} ${describePosition(this.source, this.peek().start)}`);
  }
}

function binary(operator: BinaryOperator, left: Expression, right: Expression): Expression {
  return { kind: "binary", operator, left, right };
}
