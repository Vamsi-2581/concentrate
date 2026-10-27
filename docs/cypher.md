# Cypher subset

`concentrate query` and the MCP tools read the graph with a read-only subset
of Cypher. The engine lives in `src/adapters/store/cypher/` and follows Kuzu's
semantics wherever the two overlap. The conformance corpus in
`tests/golden/cypher/` was recorded from Kuzu and pins that behavior.

## Clauses

| Clause | Notes |
| --- | --- |
| `MATCH`, `OPTIONAL MATCH` | Comma-separated patterns. Each clause has its own `WHERE`. |
| `WITH [DISTINCT] … [ORDER BY …] [SKIP n] [LIMIT n] [WHERE …]` | Every expression except a bare variable needs `AS`. `ORDER BY` needs `SKIP` or `LIMIT`, as in Kuzu. `WHERE` runs after `SKIP`/`LIMIT`. |
| `RETURN [DISTINCT] … [ORDER BY …] [SKIP n] [LIMIT n]` | Required as the last clause. An item without `AS` is named by its source text (`r.path`). |

`SKIP` and `LIMIT` take an integer literal or a `$parameter`.

The following clauses fail with `Unsupported Cypher feature`:

- writes: `CREATE`, `MERGE`, `SET`, `REMOVE`, `DELETE`, `DETACH DELETE`
- `UNWIND`, `UNION`, `CALL`, `FOREACH`, `LOAD`, `COPY`
- schema statements and transactions

The graph is written only by `concentrate scan`.

## Patterns

- Nodes: `(v)`, `(v:Label)`, `(:Label {property: value})`. `(v:A|B)` matches either label.
- Relationships:
  - `-[r:TYPE]->`, `<-[:TYPE]-`, `-[:TYPE]-` (either direction), `-->`
  - `[:A|B]` matches either type.
  - `[:TYPE {property: value}]` filters by relationship properties.
- Variable length: `[:TYPE*1..3]`, `*2` (exactly 2), `*..3` (1 to 3), `*0..2` (includes the start node). `*` alone means 1 to 30 hops.
  - Paths follow walk semantics: relationships and nodes may repeat.
  - A relationship variable on a variable-length pattern is bound to the list of relationships.
- An unlabeled node can only have the labels its relationships allow. In `(x)-[:CALLS]->()`, x is a `Function`.
  - If no table connects the given labels, the result is empty rather than an error (`(a:Function)-[:DEFINES_FUNCTION]->(b:File)`).
- Relationships in one pattern need not be distinct. `(a)-[r1]-(d)-[r2]-(b)` can use the same relationship for r1 and r2.
- Relationship types are the physical table names: `DEFINES_FUNCTION`, `ACCESSES_DATA_FUNCTION`, `RE_EXPORTS_CLASS`, and so on. See `src/adapters/store/schema.ts`.

`WHERE` after `OPTIONAL MATCH` filters only the optional part. Outer rows are never removed: when nothing passes, the optional variables are `null`.

## Expressions

- Literals:
  - `'single'` or `"double"` strings. A backslash makes the next character literal, so `'\t'` is `t`.
  - Integers, floats, `true`, `false`, `NULL`, lists `[1, 2]`.
- `$parameters`. A missing parameter is a binder error.
- Property access `v.name`. A property the node's table lacks is `null`.
- Boolean operators: `AND`, `OR`, `XOR`, `NOT`, using three-valued logic.
- Comparison: `=`, `<>`, `<`, `<=`, `>`, `>=`, `IN [...]`, `IS [NOT] NULL`.
- String predicates: `STARTS WITH`, `ENDS WITH`, `CONTAINS`.
- Arithmetic: `+`, `-`, `*`, `/`, `%`.
  - Integer `/` truncates: `7 / 2` is 3, while `7.0 / 2` is 3.5.
  - `+` also concatenates strings and treats `null` as `''`. A string plus a number is a binder error.
- `CASE WHEN … THEN … ELSE … END` and `CASE x WHEN v THEN … END`.

### Functions

| Function | |
| --- | --- |
| `lower`/`toLower`, `upper`/`toUpper` | string case |
| `contains(s, t)`, `starts_with(s, t)`, `ends_with(s, t)` | same as the operators |
| `size(x)` | length of a string or list |
| `coalesce(a, b, …)` | first non-null argument |
| `label(x)`, `labels(x)` | node label or relationship type (`labels` returns a one-element list) |
| `id(x)` | the node's `id` property |
| `count(x)`, `count(*)`, `count(DISTINCT x)` | |
| `collect(x)` | skips nulls. Returns `null` (not `[]`) when nothing was collected. |
| `min`, `max`, `sum`, `avg` | ignore nulls. Return `null` on empty input. |

Aggregates group by the non-aggregate items of their `WITH` or `RETURN`. With no grouping items, empty input still produces one row (`count` is 0). With grouping items, it produces none. Aggregates are not allowed in `WHERE` or nested inside each other.

## Ordering and comparison

- `null` sorts after every other value: last in `ASC`, first in `DESC`.
- Strings compare by code point, so `'B' < 'a'`. Equality is case-sensitive. `1 = 1.0` is true.
- Sorting is stable: rows with equal keys keep the order the match produced them in. Add keys when the order of ties matters, as the MCP tools do.

## Results

Rows are plain JSON objects keyed by column name:

- A node is returned as `{ _label, id, …every property of its table (null when unset) }`.
- A relationship is returned as `{ _label, _src, _dst, …its properties }`.

## Where we differ from Kuzu

- Kuzu 0.11 evaluates a bare boolean property in `CASE WHEN v.flag THEN …` incorrectly from the second row on. We evaluate it correctly.
- A missing `$parameter` and an aggregate in `WHERE` are binder errors here. The corpus records them as expected errors instead of running them against Kuzu.
