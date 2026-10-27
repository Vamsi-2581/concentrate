# Golden data

Golden files pin Concentrate's observable output so that large rewrites (the
storage engine in Phase 2, the parsers in Phase 3) can be checked mechanically.

| Directory | Contents | Produced by |
| --- | --- | --- |
| `fixtures/` | One normalized graph per directory under `fixtures/` | `tests/golden.test.ts` |
| `samples/` | Normalized graphs of the pinned sample repositories (`.jsonl.gz`) | `tests/golden-samples.test.ts` |
| `queries/` | Cypher statements issued by the MCP tools and the rows they returned | `tests/golden-queries.test.ts` |

## Format

Graph goldens are JSONL. The first line is a `{"kind":"report"}` record with scan
status, file counts, failures and warnings. Every following line is a
`{"kind":"node"}` or `{"kind":"rel"}` record from `normalizeGraph()`
(`src/core/graph/normalize.ts`): the scan root is replaced with `<root>`, and
records and property keys are sorted, so the files are identical on every machine.

## Updating

```bash
npm run golden:update
```

Only update goldens for an intended behavior change, and explain the diff in the
PR description. A golden diff that nobody can explain is a regression.
