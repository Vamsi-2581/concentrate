# Architecture

A scan runs in five stages, each with one owner:

1. **Discovery** (`core/scan`): finds files, applying include/exclude rules,
   the workspace manifest and package boundaries.
2. **Parsing** (`integrations/languages/syntax`): parses each file with
   tree-sitter on WebAssembly. This happens on worker threads for large scans,
   and results are cached per file.
3. **Extraction** (`integrations/languages`, `integrations/frameworks`):
   - language integrations turn syntax trees into graph nodes;
   - framework contributors add routes, dependency injection, environment and
     data-access facts on top.
4. **Resolution** (`core/scan/resolution`): links imports, calls and
   inheritance across files over the whole graph.
5. **Storage and querying** (`adapters/store`):
   - the graph is written as an atomic snapshot under a writer lock;
   - it is read through a read-only Cypher subset;
   - it is served by the CLI and the MCP adapter.

The core does not know about languages or frameworks. They plug in through
contracts in `core/contracts`, and `composition/` wires the default set. The
design and the rules each layer follows are in
[layered-core-architecture.md](layered-core-architecture.md).

## Source layout

```
src/
  index.ts          — CLI binary entry point
  program.ts        — Command, argument and flag definitions
  adapters/
    cli/            — Command adapters (scan, stats, query, export, smoke, mcp) and the parseArgs router
    store/          — Graph store: in-memory graph, snapshots, writer lock, schema
      cypher/       — Read-only Cypher subset: lexer, parser, binder, planner, executor
    mcp/            — MCP server adapter
  commands/         — CLI command entry points
  composition/      — Default registry + orchestrator wiring (core ← integrations)
  core/
    contracts/      — Language-agnostic interfaces
    graph/          — Graph model (GraphNode, GraphRelationship, GraphBuilder)
    integrations/   — Default parser + contributor registry
    scan/           — Orchestration, file discovery, manifest, report
      resolution/   — Language-agnostic call/inheritance/import resolution
  integrations/
    frameworks/js-ts/   — Express, Fastify, NestJS, env-config, data-access semantics
    languages/          — Go, Python, Rust, JS/TS parsers and resolution
      syntax/           — tree-sitter on WebAssembly (the only web-tree-sitter importer)
vendor/grammars/    — Prebuilt tree-sitter grammars (.wasm) and their manifest
```

## Dependencies

Concentrate has a single runtime dependency, `web-tree-sitter` (plain JS and
WebAssembly, no install scripts), so `npm install` never compiles native code.
The graph store, the Cypher engine, the CLI argument parser and file discovery
are built in. Grammars are vendored as `.wasm` files with a sha256 manifest.
[ROADMAP.md](ROADMAP.md) records how each dependency was replaced.
