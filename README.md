# Concentrate

Scans a codebase, extracts a structural code graph, and stores it in an embedded [KuzuDB](https://kuzudb.com) graph database.

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

# Scan a project into a graph database
npm run dev -- scan ./path/to/project

# Show graph statistics
npm run dev -- stats

# Run a Cypher query
npm run dev -- query "MATCH (f:File)-[:DEFINES_FUNCTION]->(fn:Function) RETURN f.relativePath, fn.name LIMIT 10"

# Export graph as JSONL
npm run dev -- export ./path/to/project --output .concentrate/export

# Start MCP server (for AI tool integration)
npm run dev -- mcp
```

## MCP Tools

`npm run dev -- mcp` starts a stdio MCP server exposing: `graph_stats`,
`find_definitions`, `find_callers`, `list_exports`, `trace_import_chain`,
`list_routes`, `list_entrypoints`, `list_env_config`, `list_data_access`.
See [docs/mcp-server.md](docs/mcp-server.md).

## Architecture

```
src/
  index.ts          — CLI binary entry point
  program.ts        — Command, argument and flag definitions
  adapters/
    cli/            — Command adapters (scan, stats, query, export, smoke, mcp) and the parseArgs router
    kuzu/           — KuzuDB writer, schema, retry
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
  types/            — Ambient type declarations for tree-sitter bindings
```

## Roadmap

Concentrate is moving to zero runtime dependencies (own parsers and graph engine). See
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
```

Golden tests (`tests/golden*.test.ts`) pin graph output and MCP query results;
see [tests/golden/README.md](tests/golden/README.md).
