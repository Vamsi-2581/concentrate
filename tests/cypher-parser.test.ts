import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MatchClause, ProjectionClause } from "../src/adapters/store/cypher/ast.js";
import { tokenize } from "../src/adapters/store/cypher/lexer.js";
import { DEFAULT_MAX_HOPS, parseCypher } from "../src/adapters/store/cypher/parser.js";

const firstMatch = (source: string) => parseCypher(source).clauses[0] as MatchClause;
const lastProjection = (source: string) => parseCypher(source).clauses.at(-1) as ProjectionClause;

describe("Cypher lexer", () => {
  it("reads strings, numbers, parameters, quoted identifiers and comments", () => {
    const tokens = tokenize("MATCH (`a b`) // c\n/* d */ RETURN 'it\\'s', 1.5, 2, 1..3, $p");
    assert.deepEqual(
      tokens.map((token) => `${token.kind}:${token.value}`),
      [
        "identifier:MATCH", "symbol:(", "identifier:a b", "symbol:)", "identifier:RETURN", "string:it's", "symbol:,",
        "float:1.5", "symbol:,", "integer:2", "symbol:,", "integer:1", "symbol:..", "integer:3", "symbol:,", "parameter:p", "eof:",
      ],
    );
  });

  it("treats a backslash as escaping the next character, like Kuzu", () => {
    assert.equal(tokenize("'a\\tb'")[0]!.value, "atb");
  });
});

describe("Cypher parser", () => {
  it("parses node and relationship patterns", () => {
    const match = firstMatch("MATCH (f:File {isTest: false})-[r:IMPORTS|RESOLVES_TO]->(:Import)<-[:X]-(y) RETURN f");
    const [part] = match.patterns;
    assert.equal(part!.nodes.length, 3);
    assert.deepEqual(part!.nodes[0]!.labels, ["File"]);
    assert.deepEqual(part!.nodes[0]!.properties.map(([name]) => name), ["isTest"]);
    assert.deepEqual(part!.relationships.map((relationship) => [relationship.variable, relationship.types, relationship.direction]), [
      ["r", ["IMPORTS", "RESOLVES_TO"], "out"],
      [undefined, ["X"], "in"],
    ]);
    assert.equal(part!.nodes[1]!.variable, undefined);
  });

  it("applies Kuzu's defaults for variable-length bounds", () => {
    const hops = (pattern: string) => firstMatch(`MATCH (a)-[${pattern}]-(b) RETURN a`).patterns[0]!.relationships[0]!.hops;
    assert.deepEqual(hops("*"), { min: 1, max: DEFAULT_MAX_HOPS });
    assert.deepEqual(hops("*2"), { min: 2, max: 2 });
    assert.deepEqual(hops("*..3"), { min: 1, max: 3 });
    assert.deepEqual(hops("*0..2"), { min: 0, max: 2 });
    assert.deepEqual(hops(":A*1.."), { min: 1, max: DEFAULT_MAX_HOPS });
    assert.equal(hops(":A"), undefined);
  });

  it("allows keywords as labels, types, properties, aliases and variables", () => {
    const projection = lastProjection("MATCH (call:Call)-[:CALLS]-(x) RETURN call.line AS call, x.end AS end");
    assert.deepEqual(projection.items.map((item) => item.alias), ["call", "end"]);
  });

  it("keeps the source text of unaliased items as their column name", () => {
    assert.deepEqual(lastProjection("MATCH (r:Route) RETURN r.path, count( * )").items.map((item) => item.text), ["r.path", "count( * )"]);
  });

  it("gives AND precedence over OR and XOR", () => {
    const where = firstMatch("MATCH (n) WHERE a OR b AND c RETURN n").where!;
    assert.equal(where.kind === "binary" && where.operator, "OR");
  });

  it("parses projections with DISTINCT, ORDER BY, SKIP and LIMIT", () => {
    const projection = lastProjection("MATCH (n:Function) RETURN DISTINCT n.name AS name ORDER BY name DESC, n.line SKIP 1 LIMIT $n");
    assert.equal(projection.distinct, true);
    assert.deepEqual(projection.orderBy.map((item) => item.descending), [true, false]);
    assert.deepEqual(projection.skip, { kind: "literal", value: 1 });
    assert.deepEqual(projection.limit, { kind: "parameter", name: "n" });
  });

  it("reports the position of a syntax error", () => {
    assert.throws(() => parseCypher("MATCH (f:File RETURN f"), /Parser exception: .* at line 1, column 15/);
    assert.throws(() => parseCypher("MATCH (f:File)"), /must end with RETURN/);
    assert.throws(() => parseCypher("RETURN 'open"), /unterminated string/);
  });
});
