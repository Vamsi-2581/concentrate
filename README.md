# Concentrate

Scans a codebase, extracts a structural code graph, and stores it in a built-in graph store (`.concentrate/graph/`) that you can query with a read-only Cypher subset.

## Supported Languages

JavaScript / TypeScript · Python · Go · Rust

## What It Extracts

- **Structural nodes** — File, Function, Class, Import, Variable, Decorator, Entrypoint
- **HTTP routes** — Express, Koa, Fastify, NestJS (with full composed path resolution)
- **Dependency injection** — NestJS constructor injection chains
- **Environment usage** — `process.env.*` accesses linked to routes and functions
- **Data access** — Prisma, TypeORM, Sequelize, Knex, Mongoose ORM call detection
- **Import resolution** — relative, tsconfig path aliases, Go module paths, Rust crate paths

## Usage

```bash
npm install

# Scan a project into the graph store (.concentrate/graph)
npm run dev -- scan ./path/to/project

# Show graph statistics
npm run dev -- stats

# Run a Cypher query (subset: docs/cypher.md); $name placeholders come from --param
npm run dev -- query "MATCH (f:File)-[:DEFINES_FUNCTION]->(fn:Function) RETURN f.relativePath, fn.name LIMIT 10"
npm run dev -- query "MATCH (fn:Function) WHERE fn.name = \$name RETURN fn.line" --param name=main

# Keep the graph current: rescan on every file change (uses the parse cache)
npm run dev -- watch ./path/to/project

# Export graph as JSONL
npm run dev -- export ./path/to/project --output .concentrate/export

# Start MCP server (for AI tool integration)
npm run dev -- mcp
```

Repeated scans reuse per-file parse results from `.concentrate/cache/`, so only changed files are
parsed again; cross-file resolution always runs over the whole graph, so the result is the same as
a full scan. A code or grammar change invalidates the cache automatically; `--no-cache` skips it.

When 100 or more files need parsing, they are parsed on up to 4 worker threads (`--workers <n>` sets
the count, `--workers 0` keeps parsing on the main thread); the graph is the same either way.

Scans and the MCP server can run at the same time: a scan takes a writer lock and
commits a new snapshot atomically, readers never lock, and a running MCP server
picks up the new snapshot on its next tool call. A second scan waits for the
first (`--no-retry-lock` makes it fail instead).

## MCP Tools

`npm run dev -- mcp` starts a stdio MCP server exposing: `graph_stats`,
`find_definitions`, `find_callers`, `list_exports`, `trace_import_chain`,
`list_routes`, `list_entrypoints`, `list_env_config`, `list_data_access`, and
the agent tools `impact_of`, `detect_changes`, `route_details`,
`get_symbol_source`, `get_file_outline` that answer a whole question in one call,
the search and analysis tools `search_symbols`, `find_references`,
`find_import_cycles`, `find_unused_exports`, `architecture_overview`, plus a `concentrate://graph/summary` resource. It speaks MCP 2026-07-28 and the
legacy `initialize` versions; list results are paged with cursors and return
`structuredContent`. See [docs/mcp-server.md](docs/mcp-server.md).

## Architecture

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

## Roadmap

Concentrate has a single runtime dependency, `web-tree-sitter` (plain JS and WebAssembly, no
install scripts), so `npm install` never compiles native code. The graph store, Cypher engine,
CLI and file discovery are built in. See
[docs/ROADMAP.md](docs/ROADMAP.md) and the tracking issue [#1](https://github.com/fatihserhatturan/concentrate/issues/1).

## Development

```bash
npm test                  # unit tests
npm run typecheck         # TypeScript check
npm run build             # compile to dist/
npm run verify:rc         # typecheck + tests + build + standing smoke
npm run samples:fetch     # fetch pinned sample repos into .concentrate/samples
npm run test:samples      # golden graph + query tests on the samples (required, not skipped)
npm run golden:update     # rewrite golden files after an intended behavior change
npm run grammars:build    # rebuild vendor/grammars/*.wasm from the pinned grammar versions
```

Grammars are built from pinned npm versions with the pinned `tree-sitter-cli` and committed with
a sha256 manifest (`vendor/grammars/manifest.json`, checked by `tests/grammars.test.ts`). To
upgrade one, change its version in `scripts/build-grammars.mjs`, run `npm run grammars:build`, and
review the golden diffs.

Golden tests (`tests/golden*.test.ts`) pin graph output and MCP query results;
see [tests/golden/README.md](tests/golden/README.md).
