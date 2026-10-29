# Concentrate Roadmap: Minimal Runtime Dependencies

> Progress is tracked both here and in the linked GitHub issues. When a PR completes a task, tick it
> in this file **and** in the issue. The tracking epic is [#1](https://github.com/fatihserhatturan/concentrate/issues/1).

## Context

Concentrate scans a codebase, builds a structural code graph and serves it to AI agents over MCP.
It started with 10 runtime dependencies: commander, fast-glob, ignore, kuzu, tree-sitter and five
grammar packages. KuzuDB was archived in October 2025 (last release 0.11.3), and the native
tree-sitter binding needs prebuilt or locally compiled addons, which makes installation fragile.
Phase 3a replaced the native binding with web-tree-sitter (WebAssembly) and vendored grammars, so
the only runtime dependency left is `web-tree-sitter`.

### Decisions

- **Minimal runtime dependencies.** `dependencies` in `package.json` holds only `web-tree-sitter`,
  pinned to an exact version: plain JS and WebAssembly, no dependencies of its own and no install
  scripts. Nothing else is added. Dev dependencies (typescript, @types/node, tsx, tree-sitter-cli)
  are allowed.
- **tree-sitter on WebAssembly, not own parsers.** Grammars are built to `.wasm` from pinned versions
  (`npm run grammars:build`) and committed under `vendor/grammars/`. Writing our own JS/TS, Python,
  Go and Rust parsers was the original plan (Phases 3b–3d); it was dropped on 2026-10-27 because the
  install problem was the native binding, not tree-sitter, and hand-written parsers would need
  permanent upkeep for every TypeScript release. See [benchmarks.md](benchmarks.md#parser-native-vs-wasm).
- **Own graph engine.** In-memory graph, segmented on-disk snapshots and a Cypher subset. No
  `node:sqlite` (still experimental).
- **Stable `node:` APIs only.**
- **Enforced by tests.** `tests/guardrails.test.ts` fails if `src/` imports a package outside
  `RUNTIME_DEPENDENCY_ALLOWLIST`, if an allow-listed package is no longer used, if a runtime
  dependency is not pinned or has install scripts or dependencies, or if anything but
  `src/integrations/languages/syntax/tree-sitter.ts` imports web-tree-sitter.
  `tests/grammars.test.ts` checks the vendored grammars against their manifest.
- **Focus.** The Node.js/TypeScript backend niche first; Python, Go and Rust stay at least at today's level.

### Dependency replacement map

| Dependency | Used in | Replacement | Phase |
| --- | --- | --- | --- |
| commander | `src/index.ts` | `node:util` `parseArgs` router | 1 |
| fast-glob | `core/scan/discover-files.ts`, `workspace-packages.ts`, `js-ts/resolution/package-json.ts` | Own glob + `fs.readdir` walker | 1 |
| ignore | `core/scan/discover-files.ts` | Own gitignore matcher (nested `.gitignore`) | 1 |
| kuzu | `adapters/kuzu/*` | Own graph store + Cypher subset | 2 |
| tree-sitter + 5 grammars | 22 files | web-tree-sitter (pinned) + vendored `.wasm` grammars | 3a |

## Milestones

| Milestone | Phases | Done when |
| --- | --- | --- |
| M1 – Safety net & easy deps | 0, 1 | Golden tests green; commander, fast-glob and ignore removed. |
| M2 – Own graph engine | 2 | All golden Cypher queries match; kuzu removed. |
| M3 – Portable parser | 3a, 4 | tree-sitter runs on WebAssembly with no native install step; route semantics moved into the framework layer. |
| M4 – Current grammars | 3b, 3e | Grammars upgraded with reviewed golden diffs, TSX and partial-tree error tolerance; parser performance documented. |
| M5 – Incremental & agent tools | 5, 6a | Real incremental scan, watch mode, and the first agent-facing MCP tools. |
| M6 – Release | 8, 9 | Published to npm with a benchmarked README and CI. |
| M7 – Niche depth | 6b, 7 | Deeper Node.js/TS backend semantics and the remaining MCP tools. |

Risks: grammar upgrades changing trees (bounded by golden graph and query tests), Cypher subset
breadth (bounded by golden queries), and performance (worker pool if needed).

## Phase 0: Safety net (golden tests, samples, dependency guardrail, store contracts) ([#2](https://github.com/fatihserhatturan/concentrate/issues/2))

**Milestone:** M1 – Safety net & easy deps  
**Depends on:** none

**Goal:** Make every later change measurable before any dependency is replaced.

The parser and storage rewrites in later phases are only safe if graph output can be diffed automatically. Today the standing smoke suite cannot run because the sample repositories are missing from disk, and nothing prevents new runtime dependencies from being added.

### Golden graph tests

- [x] Add a normalized JSONL graph export (stable ordering, absolute paths stripped) usable from tests
- [x] Record golden graphs for every fixture under `tests/golden/fixtures/`
- [x] Record golden graphs for every standing sample repository under `tests/golden/samples/`
- [x] Add `tests/golden.test.ts` that diffs current output against the golden files with a readable diff
- [x] Add an `--update-golden` (or `UPDATE_GOLDEN=1`) flow and document when it is acceptable to use

### Sample repositories

- [x] Add `scripts/fetch-samples.mjs` that clones express, fastify, nestjs and ky using only `git`
- [x] Pin each sample to a commit SHA and record it in `docs/sample-repositories.md`
- [x] Make sample paths configurable (env var or `.concentrate/samples/`) instead of hard-coded Desktop paths
- [x] Verify `npm run smoke:samples -- --suite standing` passes end to end

### Golden query results (reference for the new engine)

- [x] Record every Cypher statement the MCP tools issue and pin the distinct query shapes in `tests/golden/queries/templates.json`
- [x] Run them against Kuzu on every standing sample and store normalized results under `tests/golden/queries/`

### Dependency guardrail

- [x] Add a guardrail test: every bare import in `src/` must start with `node:` or be in a shrinking allow-list
- [x] Add a guardrail test: `package.json` `dependencies` must be a subset of the same allow-list
- [x] Document that the allow-list must only shrink and must be empty at the end of M4

### Store contracts

- [x] Add `IGraphStore` (open, write, patch, stats, close) to `src/core/contracts/`
- [x] Add `IQueryEngine` (`query(cypher)`, `stats`, `schemaVersion`, `close`) to `src/core/contracts/`; `$param` support lands with Phase 2
- [x] Make the existing Kuzu adapter implement both contracts and route CLI/MCP through them

### Acceptance criteria

- [x] Golden fixture, sample and query tests run in `npm test` and pass
- [x] Standing smoke suite runs from a fresh clone via the fetch script
- [x] Guardrail fails if a new runtime dependency is imported
- [x] CLI and MCP depend only on `IGraphStore` / `IQueryEngine`, not on Kuzu types

## Phase 1: Replace commander, fast-glob and ignore with built-ins ([#3](https://github.com/fatihserhatturan/concentrate/issues/3))

**Milestone:** M1 – Safety net & easy deps  
**Depends on:** Phase 0

**Goal:** Remove the three easiest runtime dependencies using stable `node:` APIs.

commander is used only in `src/index.ts`; fast-glob in `core/scan/discover-files.ts`, `core/scan/workspace-packages.ts` and `integrations/languages/js-ts/resolution/package-json.ts`; ignore only in `core/scan/discover-files.ts`, which currently reads just the root `.gitignore`.

### CLI argument parsing (commander → `node:util` parseArgs)

- [x] Add `src/adapters/cli/args.ts`: sub-command router on top of `parseArgs`
- [x] Support repeatable flags (`--include a --include b`), number validation and defaults
- [x] Generate `--help` output for the root command and every sub-command
- [x] Port every command in `src/commands/*` to the new router without changing flags
- [x] Add CLI parsing tests (unknown flag, missing value, repeatable flags, help)

### Glob matching (fast-glob → own walker)

- [x] Add `src/core/scan/glob.ts` supporting `**`, `*`, `?`, `{a,b}`, `[...]` and `!` negation with cached RegExps
- [x] Walk directories with `fs.readdir` and prune ignored directories early
- [x] Port `discover-files.ts`, `workspace-packages.ts` and `package-json.ts` to the new glob
- [x] Add a spec-table test suite for glob semantics

### Ignore rules (ignore → own gitignore matcher)

- [x] Add `src/core/scan/gitignore.ts` implementing anchors, `dir/`, `**`, negation and escapes
- [x] Respect nested `.gitignore` files (behavior improvement over today)
- [x] Add a spec-table test suite inspired by git's own ignore test cases

### Cleanup

- [x] Remove commander, fast-glob and ignore from `package.json` and the guardrail allow-list
- [x] Confirm golden graph diff is empty (or document intentional changes from nested `.gitignore`)

### Acceptance criteria

- [x] `commander`, `fast-glob` and `ignore` no longer appear in `package.json` or `src/`
- [x] All CLI commands behave as before (help, flags, exit codes)
- [x] Golden tests pass; any diff is explained in the PR

## Phase 2: Own in-memory graph engine and Cypher subset (remove kuzu) ([#4](https://github.com/fatihserhatturan/concentrate/issues/4))

**Milestone:** M2 – Own graph engine  
**Depends on:** Phase 0

**Goal:** Replace the archived KuzuDB with a zero-dependency graph store and query engine.

KuzuDB was archived in October 2025 (last release 0.11.3). The Kuzu adapter was ~1.5k lines under `src/adapters/kuzu/`, and the distinct query shapes the MCP tools issue are pinned in `tests/golden/queries/templates.json`. Graph sizes (tens of thousands of nodes) fit comfortably in memory.

### In-memory model (`src/adapters/store/`)

- [x] Node map by id, label index, and property indexes for `name`, `relativePath`, `method` and `path`
- [x] Outgoing/incoming adjacency lists (filtered by relationship type while expanding)
- [x] Validate labels and properties against `schema.ts`; schema version 35 for the new format

### Persistence

- [x] Versioned on-disk format under `.concentrate/graph/` with a header
- [x] Segment data by owning source file, plus one global segment for cross-file resolution edges
- [x] Compress segments with `node:zlib`
- [x] Atomic writes (write to temp file, then rename)
- [x] Patch rewrites only changed file segments and the global segment

### Concurrency

- [x] Writer lock file with pid and stale-lock detection
- [x] Lock-free readers via atomic snapshots
- [x] Delete `kuzu-retry.ts` and its tests once the new store is in place

### Cypher subset (`src/adapters/store/cypher/`)

- [x] Lexer and parser producing an AST
- [x] `MATCH` / `OPTIONAL MATCH` chains, anonymous nodes, relationship variables and `[:A|B]`
- [x] Variable-length paths `*min..max`
- [x] `WHERE`: comparisons, `AND`/`OR`/`NOT`, `CONTAINS`, `STARTS WITH`, `ENDS WITH`, `IN`, `IS NULL`, `lower`/`toLower`
- [x] `contains()` and `lower()` function calls (used by MCP name and model filters)
- [x] `WITH ... AS` projection (used by the data-access queries)
- [x] `RETURN ... AS`, `DISTINCT`, `count` / `collect` / `min` / `max`
- [x] `ORDER BY`, `SKIP`, `LIMIT` and `$param` parameters
- [x] Planner that starts from the most selective index
- [x] Read-only query surface; writes go through `IGraphStore` only
- [x] Clear error messages for unsupported Cypher features

### Migration

- [x] Replay every recording in `tests/golden/queries/` against the new engine and match rows and tool output exactly
- [x] Port `scan`, `stats`, `query`, `export`, `smoke` and `mcp` to the new store
- [x] Delete `src/adapters/kuzu/` and remove `kuzu` from dependencies and the allow-list
- [x] Benchmark scan-write time and query latency against the Kuzu baseline

### Acceptance criteria

Done in [#20](https://github.com/fatihserhatturan/concentrate/pull/20), [#21](https://github.com/fatihserhatturan/concentrate/pull/21) and the store switch PR; numbers in [benchmarks.md](benchmarks.md), the supported subset in [cypher.md](cypher.md).


- [x] All golden query recordings (every shape in `templates.json`, fixtures and standing samples) match exactly
- [x] `kuzu` is gone from `package.json` and `src/`
- [x] Concurrent `mcp` reader and `scan` writer work without lock errors
- [x] Query latency for MCP tools is equal to or better than the Kuzu baseline

## Phase 3a: tree-sitter on WebAssembly ([#5](https://github.com/fatihserhatturan/concentrate/issues/5))

**Milestone:** M3 – Portable parser  
**Depends on:** Phase 0

**Goal:** Keep tree-sitter but drop the native binding, so installing Concentrate never compiles or downloads native code.

Extractors use only a narrow tree-sitter API: `type`, `id`, `text`, `startPosition`, `endPosition`, `namedChildren`, `children`, `childForFieldName`, `parent`, `hasError` and `rootNode`. web-tree-sitter exposes the same API.

### Syntax module (`src/integrations/languages/syntax/tree-sitter.ts`)

- [x] `SyntaxNode` / `SyntaxTree` types; extractors no longer import `tree-sitter` types
- [x] Lazy `Parser.init()` and grammar loading; `parseSyntaxTree` / `withSyntaxTree` free trees with `delete()` (WebAssembly memory is not garbage collected)
- [x] Node comparisons by `id` (`indexOfNode`), since node objects are wrappers created on access
- [x] Whole-string input; the 32 KB chunked-input workaround for the native binding is gone

### Grammars (`vendor/grammars/`)

- [x] `scripts/build-grammars.mjs` downloads each grammar with `npm pack` (no install scripts) and builds it with the pinned `tree-sitter-cli`; builds are reproducible
- [x] Same grammar versions as the native setup: javascript 0.23.1, typescript 0.23.2, python 0.21.0, go 0.21.2, rust 0.21.0
- [x] `manifest.json` with version and sha256 per grammar, checked by `tests/grammars.test.ts`

### Acceptance criteria

- [x] Golden graph, golden query and sample tests pass unchanged
- [x] `npm ci --omit=dev --ignore-scripts` installs only `web-tree-sitter` (4.5 MB, was 67 MB) and `scan` works
- [x] Scan time ≤ 1.5× native on every standing sample (it is 0.4–0.9×, see [benchmarks.md](benchmarks.md#parser-native-vs-wasm))
- [x] Repeated scans in one process do not grow memory

## Phase 3b: Grammar upgrades, TSX and error tolerance

**Milestone:** M4 – Current grammars  
**Depends on:** Phase 3a

**Goal:** Move to current grammar releases and stop rejecting whole files on a syntax error.

### Grammars

- [ ] Upgrade javascript (0.25), python (0.25), go (0.25), rust (0.24) and typescript to current releases; review and document each golden diff
- [ ] Parse `.tsx` with the TSX grammar (today `.tsx` uses the TypeScript grammar)

### Error tolerance (behavior improvement)

- [ ] Produce a partial graph plus a scan warning instead of rejecting a file whose tree has `ERROR` nodes
- [ ] Document the resulting golden diffs

### Integration

- [ ] Add `endLine` to JS/TS `Variable` and `Route` nodes (functions, classes, interfaces, enums and type aliases already have it)

### Acceptance criteria

- [ ] Golden diffs are reviewed and explained in the PR
- [ ] `internet-nest` files that fail today on syntax errors produce partial graphs

## Phase 3e: Parser performance ([#9](https://github.com/fatihserhatturan/concentrate/issues/9))

**Milestone:** M4 – Current grammars  
**Depends on:** Phase 3a

**Goal:** Keep scan time competitive as repositories grow.

### Measurement

- [x] Record native and WASM scan time and peak memory on each standing sample
- [x] Add a repeatable parser benchmark script to `scripts/` (`npm run bench:parser`, `scripts/bench-parser.ts`)

### Optimization

- [x] Add an optional `node:worker_threads` pool for per-file parsing if profiles show parsing dominates (parse plus extraction is 80–90% of a scan; automatic from 100 files to parse, `--workers`; see [benchmarks.md](benchmarks.md#parser-benchmark-and-parse-workers))

### Acceptance criteria

- [x] Benchmark results are documented
- [x] Scan time on `internet-nest` does not regress across grammar upgrades (`npm run bench:parser -- --baseline`, see [benchmarks.md](benchmarks.md#grammar-upgrades))

## Phase 4: Move framework route knowledge out of the language layer ([#10](https://github.com/fatihserhatturan/concentrate/issues/10))

**Milestone:** M3 – Portable parser  
**Depends on:** Phase 3a

**Goal:** Keep the language layer framework-agnostic and use a single parser per language.

Before this phase, `src/integrations/languages/js-ts/routes.ts` (830 lines) and `entrypoints.ts` held the Express/Koa/Fastify/NestJS and queue/cron/socket.io knowledge, `calls.ts` held Fastify's hook names, and the registry kept two parser sets per language (scan vs. integration).

### Route and entrypoint semantics

- [x] Move Express/Koa/Fastify/NestJS route detection into `frameworks/js-ts/route-graph.ts`
- [x] Move framework-specific entrypoint detection into `frameworks/js-ts/entrypoint-graph.ts`; shared file lookups live in `frameworks/js-ts/file-index.ts`
- [x] Keep only generic call/argument structures in the language layer; callback object keys such as Fastify's `handler` and hooks are declared by the framework plugin (`callbackPropertyNames`)

### Plugin model

- [x] `JsTsFrameworkPlugin.onFile({ fileNodeId, rootNode, parsed, state })` runs on the shared tree; `createJsTsParser(language, plugins)` builds the one JS/TS parser, and `frameworks/js-ts/scanner.ts` lists the plugins in order
- [x] Remove the dual scan/integration parser registration from `default-registry.ts`
- [x] Remove `getLanguageIntegration`

### Guardrails

- [x] `tests/guardrails.test.ts` fails if framework or library names appear in `integrations/languages/`

### Acceptance criteria

- [x] One parser per language in the registry
- [x] No framework-specific code in `integrations/languages/`
- [x] Golden tests pass unchanged

## Phase 5: Real incremental scanning and watch mode ([#11](https://github.com/fatihserhatturan/concentrate/issues/11))

**Milestone:** M5 – Incremental & agent tools  
**Depends on:** Phase 2

**Goal:** Re-parse only what changed and keep the graph fresh automatically.

Before this phase, `createParsePlan` always returned `effectiveMode: "full"`, and `scan --incremental changed-files` parsed every file and then patched the store per file, which left cross-file results (resolved calls, route paths from imported constants) stale in unchanged files.

### Changed-file parsing

- [x] Per-file parse cache at `.concentrate/cache/<project>/<key>.json` (`src/core/scan/parse-cache.ts`); on by default, `--cache-dir`, `--no-cache`
- [x] Unchanged files reuse cached results, added/changed files are parsed; unused entries are pruned
- [x] Global resolution passes and contributors re-run over the merged graph on every scan, and the store is rewritten as a whole
- [x] Invalidation by key: the parser fingerprint hashes Concentrate's code, the vendored grammars and the schema version (`src/composition/parser-fingerprint.ts`)
- [x] `tests/parse-cache.test.ts`: cached scan equals a full scan for add, change, delete and rename, including a route whose path comes from another file, and on every fixture
- [x] Removed the manifest diff, parse plan, `--previous-manifest`, `--incremental` and the store's per-file `patch`

### Watch mode

- [x] Add `concentrate watch` using `fs.watch({ recursive: true })` with debouncing (`--debounce`, default 200 ms); changes under `.git`, `node_modules`, `.concentrate` and its own outputs are ignored
- [x] Rescan with the parse cache on changes and rewrite the store; a scan that fails fast keeps the last graph
- [x] Let a running MCP server reload when the store changes (readers check the store HEAD on every call since Phase 2)

### Acceptance criteria

- [x] Incremental scan output equals a full scan in all tested scenarios (and on every sample, `npm run benchmark:incremental`)
- [x] A no-change incremental scan is substantially faster than a full scan on the standing samples (3.5–6×, see [benchmarks.md](benchmarks.md#parse-cache))
- [x] `watch` keeps the graph current while files are edited (`tests/watch.test.ts`)

## Phase 6a: Agent-facing MCP tools (impact, changes, routes, source) ([#12](https://github.com/fatihserhatturan/concentrate/issues/12))

**Milestone:** M5 – Incremental & agent tools  
**Depends on:** Phase 2

**Goal:** Answer the questions agents actually ask with a single tool call.

MCP exposed 9 tools before this phase: graph_stats, find_definitions, find_callers, list_exports, trace_import_chain, list_routes, list_entrypoints, list_env_config and list_data_access. This phase adds 5 more (see [mcp-server.md](mcp-server.md#agent-tools)).

### New tools

- [x] `impact_of(symbol | file)`: transitive callers plus affected routes, entrypoints, tables and env vars (for a route, `route_details` gives its downstream)
- [x] `detect_changes`: `git diff` via `node:child_process` → changed line ranges → symbols → impact report
- [x] `route_details(method, path)`: handler → middleware → call chain → data access → env/config
- [x] `get_symbol_source` and `get_file_outline` using `line`/`endLine`

### Tests

- [x] Unit tests for each tool against fixtures (`tests/mcp-agent-tools.test.ts`, golden recordings in `tests/golden/queries/`)
- [x] End-to-end JSON-RPC test over stdio for each new tool

### Acceptance criteria

- [x] All new tools are listed by `tools/list` and covered by tests
- [x] Tool output stays within a documented size budget (24,000 characters, see [mcp-server.md](mcp-server.md#output-budget))

## Phase 6b: Analysis tools and MCP protocol quality ([#13](https://github.com/fatihserhatturan/concentrate/issues/13))

**Milestone:** M7 – Niche depth  
**Depends on:** Phase 6a

**Goal:** Round out the MCP surface and align with the current protocol spec.

The MCP server is a hand-written JSON-RPC layer in `src/adapters/mcp/server.ts`. It speaks MCP 2026-07-28 (`server/discover`, per-request `_meta` version) and the legacy `initialize` versions back to 2024-11-05; list tools page with cursors and stay under a 24,000-character budget.

### Search and navigation

- [x] `search_symbols`: fuzzy name search with ranking
- [x] `find_references`

### Analysis

- [x] Import cycle detection
- [x] Unused exports / dead code
- [x] Architecture overview at package and directory level

### Protocol quality

- [x] Output token budget and pagination for every tool
- [x] Structured output (`structuredContent`)
- [x] Expose a graph summary as an MCP resource
- [x] Align the JSON-RPC layer with the current MCP specification version

### Acceptance criteria

- [x] New tools are covered by unit and stdio end-to-end tests
- [x] Every tool supports pagination and respects the output budget

## Phase 7: Niche depth – Node.js/TS backend semantics ([#14](https://github.com/fatihserhatturan/concentrate/issues/14))

**Milestone:** M7 – Niche depth  
**Depends on:** Phase 4

**Goal:** Own the question "which tables and env vars does this endpoint touch, and what breaks if it changes?"

Concentrate already models Express/Koa/Fastify/NestJS routes, NestJS DI, env usage and Prisma/TypeORM/Sequelize/Knex/Mongoose access. This phase deepens that niche.

### Frameworks

- [ ] Hono routes
- [ ] Next.js app router `route.ts` handlers and server actions
- [ ] tRPC procedures
- [ ] GraphQL resolvers (Apollo, NestJS)
- [ ] NestJS guards, interceptors and pipes
- [ ] Ordered middleware chains

### Data layer

- [x] Parse `schema.prisma` (models → tables, relations)
- [x] Drizzle ORM
- [x] Table nodes for TypeORM entities and Mongoose schemas
- [x] Unified `Table` node with `READS` / `WRITES` edges

### Cross-service

- [ ] Match outbound HTTP calls (fetch, axios) to routes inside a monorepo
- [ ] BullMQ producer/consumer matching
- [ ] EventEmitter emit/on matching

### Environment

- [ ] Parse `.env*` files
- [ ] Minimal own YAML reader for `docker-compose.yml` environment sections

### Call resolution quality

- [ ] Lightweight TS type inference from annotations, `new`, DI and return types
- [ ] Add a `confidence` property to `CALL_RESOLVES_TO`

### Acceptance criteria

- [ ] Each new framework/data source has fixtures and golden coverage
- [ ] Accuracy report (Phase 8) shows no regression and improved recall

## Phase 8: Quality measurement and benchmarks ([#15](https://github.com/fatihserhatturan/concentrate/issues/15))

**Milestone:** M6 – Release  
**Depends on:** Phase 0

**Goal:** Quantify accuracy, performance and agent value so the README can lead with numbers.

Builds on the existing `--semantic-samples` infrastructure in the smoke command.

### Accuracy

- [x] Hand-label routes, calls and data-access edges on the standing samples ([accuracy.md](accuracy.md))
- [x] Report precision and recall per relationship type (`npm run bench:accuracy`)

### Performance

- [x] Report scan time, peak memory and query latency per release (`npm run bench:release`)

### Agent benchmark

- [ ] Define a fixed question set across the sample repositories
- [ ] Measure tokens, tool calls and answer accuracy with and without Concentrate
- [ ] Publish results in the README and `docs/`

### Acceptance criteria

- [ ] Accuracy, performance and agent benchmark reports are reproducible from scripts
- [ ] README shows the headline numbers

## Phase 9: Distribution (npm, init command, CI) ([#16](https://github.com/fatihserhatturan/concentrate/issues/16))

**Milestone:** M6 – Release  
**Depends on:** Phase 3a

**Goal:** Make `npx concentrate` work everywhere with no native build.

Requires the portable parser (M3): the only runtime dependency is `web-tree-sitter`. Only stable `node:` APIs may be used; no `node:sqlite`.

### Package

- [ ] Set `bin` and `engines: node >=22`; drop `private: true` (`files` and the single pinned dependency are done)
- [ ] Choose a license and add `LICENSE`
- [ ] Verify `npm pack` then `npx ./concentrate-*.tgz scan` in a clean directory without native builds

### Onboarding

- [ ] Add `concentrate init` writing MCP config for Claude Code, Cursor and Codex
- [ ] Rewrite the README around install, MCP setup and benchmark results

### CI

- [ ] GitHub Actions matrix: Node 22/24 × macOS/Linux/Windows
- [ ] Run typecheck, tests (golden, parity, guardrails) and build on every PR
- [ ] Release workflow publishing to npm on tags

### Optional

- [ ] Single-file executable via Node SEA

### Acceptance criteria

- [ ] Package is published to npm
- [ ] CI is green on all matrix targets
- [ ] `concentrate init` produces a working MCP setup

## Verification (every milestone)

- `npm run typecheck`, `npm test` (golden, parity and guardrail tests) and `npm run build`
- `node scripts/fetch-samples.mjs`, then `npm run smoke:samples -- --suite standing`
- MCP end to end: send `tools/list` and one call per tool over stdio to `npm run dev -- mcp`
- `npm ls --omit=dev` is empty; `npm pack` + `npx ./concentrate-*.tgz scan` works without native builds
