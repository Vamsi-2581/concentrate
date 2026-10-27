# Concentrate Roadmap: Zero Runtime Dependencies

> Progress is tracked both here and in the linked GitHub issues. When a PR completes a task, tick it
> in this file **and** in the issue. The tracking epic is [#1](https://github.com/fatihserhatturan/concentrate/issues/1).

## Context

Concentrate scans a codebase, builds a structural code graph and serves it to AI agents over MCP.
It currently has 10 runtime dependencies: commander, fast-glob, ignore, kuzu, tree-sitter and five
grammar packages. KuzuDB was archived in October 2025 (last release 0.11.3), and tree-sitter needs
native builds, which makes installation fragile.

### Decisions

- **Zero runtime dependencies.** `dependencies` in `package.json` must be empty. Dev dependencies
  (typescript, @types/node, and tree-sitter temporarily as a parity oracle) are allowed.
- **Own parsers.** Hand-written, error-tolerant parsers that emit a tree-sitter-compatible CST subset,
  so most extractor code survives unchanged.
- **Own graph engine.** In-memory graph, segmented on-disk snapshots and a Cypher subset. No
  `node:sqlite` (still experimental).
- **Stable `node:` APIs only.**
- **Enforced by tests.** `tests/guardrails.test.ts` fails if `src/` imports a package outside
  `RUNTIME_DEPENDENCY_ALLOWLIST` or if an allow-listed package is no longer used. The list may only
  shrink and must be empty at the end of M4.
- **Focus.** The Node.js/TypeScript backend niche first; Python, Go and Rust stay at least at today's level.

### Dependency replacement map

| Dependency | Used in | Replacement | Phase |
| --- | --- | --- | --- |
| commander | `src/index.ts` | `node:util` `parseArgs` router | 1 |
| fast-glob | `core/scan/discover-files.ts`, `workspace-packages.ts`, `js-ts/resolution/package-json.ts` | Own glob + `fs.readdir` walker | 1 |
| ignore | `core/scan/discover-files.ts` | Own gitignore matcher (nested `.gitignore`) | 1 |
| kuzu | `adapters/kuzu/*` | Own graph store + Cypher subset | 2 |
| tree-sitter + 5 grammars | 22 files | Own lexers/parsers | 3 |

## Milestones

| Milestone | Phases | Done when |
| --- | --- | --- |
| M1 – Safety net & easy deps | 0, 1 | Golden tests green; commander, fast-glob and ignore removed. |
| M2 – Own graph engine | 2 | All golden Cypher queries match; kuzu removed. |
| M3 – JS/TS parser | 3a, 3b, 4 | JS/TS parser parity reached; route semantics moved into the framework layer. |
| M4 – Zero runtime dependencies | 3c, 3d, 3e | Python/Go/Rust parity reached; tree-sitter removed; `dependencies: {}`. |
| M5 – Incremental & agent tools | 5, 6a | Real incremental scan, watch mode, and the first agent-facing MCP tools. |
| M6 – Release | 8, 9 | Published to npm with a benchmarked README and CI. |
| M7 – Niche depth | 6b, 7 | Deeper Node.js/TS backend semantics and the remaining MCP tools. |

Risks: parser workmanship (mitigated by differential parity tests and JS/TS first), Cypher subset
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

KuzuDB was archived in October 2025 (last release 0.11.3). The Kuzu adapter is ~1.5k lines under `src/adapters/kuzu/`, and the distinct query shapes the MCP tools issue are pinned in `tests/golden/queries/templates.json`. Graph sizes (tens of thousands of nodes) fit comfortably in memory.

### In-memory model (`src/adapters/store/`)

- [ ] Node map by id, label index, and property indexes for `name`, `relativePath` and `method+path`
- [ ] Outgoing/incoming adjacency lists keyed by relationship type
- [ ] Validate labels and properties against `schema.ts`; keep the schema version

### Persistence

- [ ] Versioned on-disk format under `.concentrate/graph/` with a header
- [ ] Segment data by owning source file, plus one global segment for cross-file resolution edges
- [ ] Compress segments with `node:zlib`
- [ ] Atomic writes (write to temp file, then rename)
- [ ] Patch rewrites only changed file segments and the global segment

### Concurrency

- [ ] Writer lock file with pid and stale-lock detection
- [ ] Lock-free readers via atomic snapshots
- [ ] Delete `kuzu-retry.ts` and its tests once the new store is in place

### Cypher subset (`src/adapters/store/cypher/`)

- [ ] Lexer and parser producing an AST
- [ ] `MATCH` / `OPTIONAL MATCH` chains, anonymous nodes, relationship variables and `[:A|B]`
- [ ] Variable-length paths `*min..max`
- [ ] `WHERE`: comparisons, `AND`/`OR`/`NOT`, `CONTAINS`, `STARTS WITH`, `ENDS WITH`, `IN`, `IS NULL`, `lower`/`toLower`
- [ ] `contains()` and `lower()` function calls (used by MCP name and model filters)
- [ ] `WITH ... AS` projection (used by the data-access queries)
- [ ] `RETURN ... AS`, `DISTINCT`, `count` / `collect` / `min` / `max`
- [ ] `ORDER BY`, `SKIP`, `LIMIT` and `$param` parameters
- [ ] Planner that starts from the most selective index
- [ ] Read-only query surface; writes go through `IGraphStore` only
- [ ] Clear error messages for unsupported Cypher features

### Migration

- [ ] Replay every recording in `tests/golden/queries/` against the new engine and match rows and tool output exactly
- [ ] Port `scan`, `stats`, `query`, `export`, `smoke` and `mcp` to the new store
- [ ] Delete `src/adapters/kuzu/` and remove `kuzu` from dependencies and the allow-list
- [ ] Benchmark scan-write time and query latency against the Kuzu baseline

### Acceptance criteria

- [ ] All golden query recordings (every shape in `templates.json`, fixtures and standing samples) match exactly
- [ ] `kuzu` is gone from `package.json` and `src/`
- [ ] Concurrent `mcp` reader and `scan` writer work without lock errors
- [ ] Query latency for MCP tools is equal to or better than the Kuzu baseline

## Phase 3a: Shared syntax core (tree-sitter-compatible CST) ([#5](https://github.com/fatihserhatturan/concentrate/issues/5))

**Milestone:** M3 – JS/TS parser  
**Depends on:** Phase 0

**Goal:** Provide the CST types and utilities every hand-written parser will build on.

Extractors use only a narrow tree-sitter API: `type`, `text`, `startPosition`, `endPosition`, `namedChildren`, `children`, `childForFieldName`, `parent`, `hasError` and `rootNode`. Producing the same node types and field names lets most of the ~5k lines of extractor code survive unchanged.

### CST (`src/integrations/languages/syntax/`)

- [ ] `SyntaxNode` with `type`, lazy `text`, `startIndex`/`endIndex`, `startPosition`/`endPosition`, `children`, `namedChildren`, `parent`, `childForFieldName`, `hasError`, `isNamed`
- [ ] `Tree` type exposing `rootNode`
- [ ] Replace `import type Parser from "tree-sitter"` in extractors and `tree-sitter-utils.ts` with the new types

### Shared utilities

- [ ] Character stream and line/column table
- [ ] Error-recovery helpers: skip to a sync point and emit an `ERROR` node
- [ ] CST debug printer (S-expression output) for tests and troubleshooting

### Tests

- [ ] Unit tests for positions, field lookup, parent links and error nodes

### Acceptance criteria

- [ ] Extractors compile against the new CST types without tree-sitter type imports
- [ ] Syntax core has its own unit tests

## Phase 3b: Hand-written JS/TS parser (JSX/TSX included) ([#6](https://github.com/fatihserhatturan/concentrate/issues/6))

**Milestone:** M3 – JS/TS parser  
**Depends on:** Phase 3a

**Goal:** Replace tree-sitter-javascript and tree-sitter-typescript with our own tolerant parser.

JS/TS extractors and framework semantics use about 75 node types and 16 fields (`alias`, `arguments`, `body`, `constructor`, `function`, `key`, `left`, `name`, `object`, `parameters`, `pattern`, `property`, `return_type`, `right`, `type`, `value`). Today a file with any syntax error is rejected entirely.

### Lexer

- [ ] Regex vs. division disambiguation
- [ ] Nested template literals
- [ ] JSX text mode
- [ ] Numeric separators, BigInt, hashbang and Unicode identifiers

### Parser

- [ ] Recursive-descent statements and a Pratt expression parser
- [ ] Arrow function detection with bounded backtracking
- [ ] Generic `<T>` vs. less-than disambiguation following TS/TSX rules
- [ ] Decorators on classes, members and parameters
- [ ] Class members: accessibility, `readonly`, `abstract`, `static`, `get`/`set` and parameter properties
- [ ] `enum`, `interface`, `type`, `namespace` and `declare`
- [ ] Import/export forms including `import type`, re-exports, CommonJS `require` / `module.exports`
- [ ] JSX elements, with embedded expressions walked so calls are captured

### Types

- [ ] Emit `type_identifier`, `generic_type` and `nested_type_identifier` precisely
- [ ] Skip remaining type syntax as a single balanced node

### Error tolerance (behavior improvement)

- [ ] Produce a partial tree plus a scan warning instead of rejecting the file
- [ ] Document the resulting golden diffs

### Integration

- [ ] Add `endLine` to JS/TS `Variable` and `Route` nodes (functions, classes, interfaces, enums and type aliases already have it)
- [ ] Wire the new parser into the JS/TS language integration

### Acceptance criteria

- [ ] JS/TS CST parity with tree-sitter on all fixtures and sample repos (see Phase 3d)
- [ ] Golden graph diff is empty apart from documented error-tolerance improvements
- [ ] No runtime import of `tree-sitter-javascript` or `tree-sitter-typescript`

## Phase 3c: Hand-written Python, Go and Rust parsers ([#7](https://github.com/fatihserhatturan/concentrate/issues/7))

**Milestone:** M4 – Zero runtime dependencies  
**Depends on:** Phase 3a

**Goal:** Replace tree-sitter-python, tree-sitter-go and tree-sitter-rust while keeping current coverage.

Each language uses about 13 node types. Python: `aliased_import`, `argument_list`, `attribute`, `block`, `call`, `class_definition`, `dotted_name`, `function_definition`, `import_from_statement`, `import_statement`, `relative_import`. Go: `call_expression`, `function_declaration`, `method_declaration`, `import_spec`, `type_spec`, `struct_type`, … Rust: `function_item`, `impl_item`, `mod_item`, `struct_item`, `use_declaration`, `macro_invocation`, …

### Python

- [ ] Indentation-aware tokenizer (INDENT/DEDENT), strings including f-strings and triple quotes
- [ ] Imports, relative imports, aliased imports
- [ ] `def` / `async def`, `class`, decorated definitions, calls and attributes

### Go

- [ ] Package, imports (single and grouped, interpreted and raw strings)
- [ ] Functions, methods with receivers, structs and type specs
- [ ] Call expressions

### Rust

- [ ] `use`, `mod`, `fn` (with modifiers and visibility), `struct`, `impl`
- [ ] Call expressions and macro invocations

### Acceptance criteria

- [ ] CST parity with tree-sitter on all Python, Go and Rust fixtures (see Phase 3d)
- [ ] Existing Python, Go and Rust tests pass unchanged

## Phase 3d: Differential parser parity tests and tree-sitter removal ([#8](https://github.com/fatihserhatturan/concentrate/issues/8))

**Milestone:** M4 – Zero runtime dependencies  
**Depends on:** Phase 3b, Phase 3c

**Goal:** Prove our parsers match tree-sitter where it matters, then drop tree-sitter entirely.

Runtime dependencies must be zero, but dev dependencies are allowed. tree-sitter can therefore serve as a temporary dev-only oracle during migration.

### Parity harness

- [ ] Move tree-sitter and the grammar packages to `devDependencies`
- [ ] Add `tests/parser-parity.test.ts` projecting both CSTs onto the used node types and fields
- [ ] Compare type, field, text and position for every fixture and sample repository file
- [ ] Produce a readable mismatch report (file, path in tree, expected vs. actual)

### Removal

- [ ] Reach zero parity mismatches (or documented, intentional ones)
- [ ] Remove tree-sitter and all grammar packages from `devDependencies`
- [ ] Delete the `src/types/tree-sitter-*.d.ts` ambient declarations
- [ ] Empty the guardrail allow-list and assert `dependencies` is `{}`

### Acceptance criteria

- [ ] `npm ls --omit=dev` is empty
- [ ] No `tree-sitter` string remains in `package.json` or `src/`
- [ ] Golden graph and query tests pass

## Phase 3e: Parser performance targets ([#9](https://github.com/fatihserhatturan/concentrate/issues/9))

**Milestone:** M4 – Zero runtime dependencies  
**Depends on:** Phase 3b, Phase 3c

**Goal:** Keep scan time competitive after leaving native tree-sitter.

Target: scan time on the standing samples is at most 1.5× the tree-sitter baseline.

### Measurement

- [ ] Record the tree-sitter scan-time and memory baseline on each standing sample
- [ ] Add a repeatable parser benchmark script

### Optimization

- [ ] Profile and optimize lexer and parser hot paths
- [ ] Add an optional `node:worker_threads` pool for per-file parsing if needed

### Acceptance criteria

- [ ] Scan time ≤ 1.5× the recorded baseline on every standing sample
- [ ] Benchmark results are documented

## Phase 4: Move framework route knowledge out of the language layer ([#10](https://github.com/fatihserhatturan/concentrate/issues/10))

**Milestone:** M3 – JS/TS parser  
**Depends on:** Phase 3b

**Goal:** Keep the language layer framework-agnostic and use a single parser per language.

`src/integrations/languages/js-ts/routes.ts` (830 lines) mentions express/koa/fastify/nest 72 times and `entrypoints.ts` 13 times. `src/composition/default-registry.ts` registers two parser sets per language (scan vs. integration); `getLanguageIntegration` is used only in tests.

### Route and entrypoint semantics

- [ ] Move Express/Koa/Fastify/NestJS route detection from `languages/js-ts/routes.ts` into `frameworks/js-ts/`
- [ ] Move framework-specific entrypoint detection from `languages/js-ts/entrypoints.ts` into `frameworks/js-ts/`
- [ ] Keep only generic call/argument structures in the language layer

### Plugin model

- [ ] Introduce `IFrameworkPlugin.onFile(tree, parsed)` running on the shared CST
- [ ] Remove the dual scan/integration parser registration from `default-registry.ts`
- [ ] Remove `getLanguageIntegration` once unused

### Guardrails

- [ ] Add a guardrail that fails if framework names appear in `integrations/languages/`

### Acceptance criteria

- [ ] One parser per language in the registry
- [ ] No framework-specific code in `integrations/languages/`
- [ ] Golden tests pass unchanged

## Phase 5: Real incremental scanning and watch mode ([#11](https://github.com/fatihserhatturan/concentrate/issues/11))

**Milestone:** M5 – Incremental & agent tools  
**Depends on:** Phase 2

**Goal:** Re-parse only what changed and keep the graph fresh automatically.

`createParsePlan` in `src/core/scan/parse-plan.ts` always returns `effectiveMode: "full"` ("Changed-file-only parsing is not implemented yet"). Manifest diffing and graph patching already exist.

### Changed-file parsing

- [ ] Add a per-file parse cache at `.concentrate/cache/<content-hash>.json`
- [ ] Implement `changed-files` mode in `createParsePlan`: parse added/changed files, reuse cached results for unchanged files
- [ ] Re-run global resolution passes over the merged graph
- [ ] Invalidate the cache on parser or schema version changes
- [ ] Test: incremental result equals a full scan for add, change, delete and rename scenarios

### Watch mode

- [ ] Add `concentrate watch` using `fs.watch({ recursive: true })` with debouncing
- [ ] Patch the graph store on changes
- [ ] Let a running MCP server reload when the store changes

### Acceptance criteria

- [ ] Incremental scan output equals a full scan in all tested scenarios
- [ ] A no-change incremental scan is substantially faster than a full scan on the standing samples
- [ ] `watch` keeps the graph current while files are edited

## Phase 6a: Agent-facing MCP tools (impact, changes, routes, source) ([#12](https://github.com/fatihserhatturan/concentrate/issues/12))

**Milestone:** M5 – Incremental & agent tools  
**Depends on:** Phase 2

**Goal:** Answer the questions agents actually ask with a single tool call.

MCP currently exposes 9 tools: graph_stats, find_definitions, find_callers, list_exports, trace_import_chain, list_routes, list_entrypoints, list_env_config and list_data_access.

### New tools

- [ ] `impact_of(symbol | file | route)`: transitive callers plus affected routes, entrypoints, tables and env vars
- [ ] `detect_changes`: `git diff` via `node:child_process` → changed line ranges → symbols → impact report
- [ ] `route_details(method, path)`: handler → middleware → call chain → data access → env/config
- [ ] `get_symbol_source` and `get_file_outline` using `startLine`/`endLine`

### Tests

- [ ] Unit tests for each tool against fixtures
- [ ] End-to-end JSON-RPC test over stdio for each new tool

### Acceptance criteria

- [ ] All four tools are listed by `tools/list` and covered by tests
- [ ] Tool output stays within a documented size budget

## Phase 6b: Analysis tools and MCP protocol quality ([#13](https://github.com/fatihserhatturan/concentrate/issues/13))

**Milestone:** M7 – Niche depth  
**Depends on:** Phase 6a

**Goal:** Round out the MCP surface and align with the current protocol spec.

The MCP server is a hand-written JSON-RPC layer in `src/adapters/mcp/server.ts`.

### Search and navigation

- [ ] `search_symbols`: fuzzy name search with ranking
- [ ] `find_references`

### Analysis

- [ ] Import cycle detection
- [ ] Unused exports / dead code
- [ ] Architecture overview at package and directory level

### Protocol quality

- [ ] Output token budget and pagination for every tool
- [ ] Structured output (`structuredContent`)
- [ ] Expose a graph summary as an MCP resource
- [ ] Align the JSON-RPC layer with the current MCP specification version

### Acceptance criteria

- [ ] New tools are covered by unit and stdio end-to-end tests
- [ ] Every tool supports pagination and respects the output budget

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

- [ ] Parse `schema.prisma` (models → tables, relations)
- [ ] Drizzle ORM
- [ ] Table nodes for TypeORM entities and Mongoose schemas
- [ ] Unified `Table` node with `READS` / `WRITES` edges

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

- [ ] Hand-label routes, calls and data-access edges on the standing samples
- [ ] Report precision and recall per relationship type

### Performance

- [ ] Report scan time, peak memory and query latency per release

### Agent benchmark

- [ ] Define a fixed question set across the sample repositories
- [ ] Measure tokens, tool calls and answer accuracy with and without Concentrate
- [ ] Publish results in the README and `docs/`

### Acceptance criteria

- [ ] Accuracy, performance and agent benchmark reports are reproducible from scripts
- [ ] README shows the headline numbers

## Phase 9: Distribution (npm, init command, CI) ([#16](https://github.com/fatihserhatturan/concentrate/issues/16))

**Milestone:** M6 – Release  
**Depends on:** Phase 3d

**Goal:** Make `npx concentrate` work everywhere with no native build.

Requires zero runtime dependencies (M4). Only stable `node:` APIs may be used; no `node:sqlite`.

### Package

- [ ] Set `dependencies: {}`, `files`, `bin` and `engines: node >=22`; drop `private: true`
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
