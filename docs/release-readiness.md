# Release Readiness Baseline

This checklist freezes the pre long-term baseline before architectural work
such as incremental scanning or an MCP server begins.

## Required Validation

Run the local validation sequence before merging parser, graph, CLI, or schema
changes:

```bash
npm run typecheck
npm test
npm run build
npm run smoke:samples -- --suite standing --report .concentrate/smoke-standing-report.json --semantic-samples 5
```

For the same local sequence as a single release-candidate command, run:

```bash
npm run verify:rc
```

Run the heavier real-repository validation when changes affect import
resolution, workspace/package modeling, backend semantics, data access,
graph store writes, or smoke report generation:

```bash
npm run smoke:samples -- --suite internet --report .concentrate/smoke-internet-report.json --semantic-samples 5
```

Use `npm run verify:rc` for ordinary local release-candidate checks. Add the
internet smoke command when a change touches architecture, resolver behavior, or
large-repository performance.

Run the incremental benchmark after changes to the parse cache, the scan
pipeline, or large-repository performance. Each sample is rescanned with a cold
and then a warm parse cache; the warm scan must parse nothing (except files that
fail to parse) and produce exactly the full scan's graph:

```bash
npm run benchmark:incremental
```

For a smaller standing-only pass:

```bash
npm run smoke:samples -- --suite standing --incremental-benchmark --report .concentrate/incremental-standing-benchmark-report.json --semantic-samples 5
```

## Current Baseline

- Schema version: 36.
- Node runtime: Node.js 22 or newer.
- Standing smoke report: `.concentrate/smoke-standing-report.json`.
- Internet smoke report: `.concentrate/smoke-internet-report.json`.
- Incremental benchmark report: `.concentrate/incremental-benchmark-report.json`.
- Standing sample graph stores:
  - `.concentrate/express.graph`
  - `.concentrate/fastify.graph`
  - `.concentrate/nestjs-starter.graph`
  - `.concentrate/ky.graph`
- Internet sample graph stores:
  - `.concentrate/internet-node-express-firebase-mongodb.graph`
  - `.concentrate/internet-node-express-realworld.graph`
  - `.concentrate/internet-nest.graph`

## Validation Artifacts

The `.concentrate/*.graph` stores, `.concentrate/*report.json` files, and
`.concentrate/*manifest*.json` files are generated validation artifacts. They
are useful for manual inspection and regression triage, but they are not source
files and should not be committed.

`scan` and `export` reuse per-file parse results from `.concentrate/cache/`
(`--cache-dir <path>`, `--no-cache` to parse everything). An entry is keyed by
the parser fingerprint (a hash of Concentrate's own code, the vendored grammars
and the schema version), the file path and its content hash, so changed files
and any code change miss automatically; nothing has to be invalidated by hand.
Cross-file passes (import, call and inheritance resolution, route paths,
NestJS modules, env/config) run over the whole graph on every scan, and the
store is always rewritten as a whole, so a cached scan writes exactly the graph
a full scan would. Entries the scan did not use are pruned. The cache directory
is safe to delete at any time.

## Expected Green Baseline

- `npm run typecheck`: passes.
- `npm test`: passes all unit and integration tests.
- `npm run build`: passes TypeScript build.
- Standing smoke suite: passes Express, Fastify, NestJS starter, and Ky.
- Internet smoke suite: passes Node Express Firebase MongoDB, Node Express
  RealWorld, and the large Nest repository. The Nest sample is expected to be a
  partial scan with two known failed decorator spec files.
