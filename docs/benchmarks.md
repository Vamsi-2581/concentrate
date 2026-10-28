# Graph store benchmarks

Measured with `npx tsx scripts/bench-store.ts --runs 20` on the four standing
samples (`npm run samples:fetch` first). Parsing runs once per sample and is not
measured, so only the store is timed:

- **Write**: `reset()` + `write()` of the whole graph, at least 5 runs.
- **Tools**: one MCP tool call each (the `common` cases in
  `tests/golden/query-cases.json`), 20 runs after one warm-up.

All numbers are milliseconds, given as p50 / p95.

## Baseline: Kuzu 0.11.3 (before Phase 2)

Apple M4, Node v24.13.0, macOS. Recorded 2026-10-27.

| Sample | Nodes | Rels | Write | graph_stats | find_definitions | list_exports | list_routes | list_entrypoints | list_env_config | list_data_access |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| express | 3281 | 4130 | 2955.6 / 3025.39 | 3.5 / 3.83 | 3.6 / 3.86 | 4.28 / 4.56 | 1.07 / 1.12 | 0.56 / 0.63 | 1.5 / 1.64 | 2.46 / 2.67 |
| fastify | 339 | 392 | 821.89 / 842.38 | 3.41 / 3.96 | 2.95 / 3.2 | 4.2 / 4.44 | 0.63 / 0.68 | 0.58 / 0.68 | 1.41 / 1.52 | 2.36 / 2.59 |
| nestjs-starter | 68 | 95 | 664.7 / 667.83 | 3.49 / 3.82 | 2.85 / 2.97 | 4.12 / 4.32 | 0.64 / 0.78 | 0.56 / 0.74 | 1.34 / 1.5 | 2.36 / 2.56 |
| ky | 5494 | 6926 | 4729.13 / 4978.06 | 3.42 / 3.87 | 3.52 / 3.7 | 4.53 / 4.73 | 0.59 / 0.64 | 0.57 / 0.63 | 1.54 / 1.62 | 2.46 / 2.7 |

Write time is dominated by one `CREATE` statement per node and relationship;
even the 68-node sample pays ~650 ms of schema creation. Phase 2's acceptance
criterion is MCP tool latency equal to or better than this table.

## Built-in store (Phase 2)

Same machine and samples, recorded 2026-10-27 with `--runs 100`. Write is
`reset()` + `write()` including the snapshot commit (gzip segments, atomic HEAD
rename). Tool calls include the per-call HEAD check that lets a running MCP
server pick up a new scan.

| Sample | Nodes | Rels | Write | graph_stats | find_definitions | list_exports | list_routes | list_entrypoints | list_env_config | list_data_access |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| express | 3281 | 4130 | 12.02 / 17.33 | 1.1 / 1.58 | 1.66 / 2.52 | 1.61 / 3.56 | 0.48 / 0.73 | 0.1 / 0.12 | 0.32 / 0.36 | 0.3 / 0.61 |
| fastify | 339 | 392 | 1.36 / 3.06 | 0.35 / 0.42 | 0.41 / 0.61 | 0.56 / 0.66 | 0.09 / 0.11 | 0.08 / 0.09 | 0.23 / 0.27 | 0.22 / 0.25 |
| nestjs-starter | 68 | 95 | 0.53 / 0.63 | 0.23 / 0.26 | 0.3 / 0.37 | 0.44 / 0.52 | 0.09 / 0.11 | 0.09 / 0.11 | 0.24 / 0.27 | 0.21 / 0.24 |
| ky | 5494 | 6926 | 20.73 / 28.33 | 2.11 / 2.35 | 1.31 / 2.09 | 1.03 / 2.53 | 0.09 / 0.1 | 0.09 / 0.1 | 0.26 / 0.3 | 0.23 / 0.28 |

Compared with the Kuzu baseline:

- **Write** is 140–1250× faster (express 2956 → 12 ms, ky 4729 → 21 ms); there
  is no schema to create and no statement per record.
- **Every MCP tool** is faster at p50 and p95 on every sample: 1.3–3× on the
  scan-heavy tools (`graph_stats`, `find_definitions`, `list_exports`) and
  2–10× on the others.
- With `--runs 20`, p95 is effectively the second-slowest call, and a single
  garbage-collection pause can put it above the baseline (seen up to 5 ms for
  express `graph_stats`); use 100 runs to compare tails.
- `node_modules` went from 653 MB to 114 MB; the `kuzu` package alone was 531 MB.

## Parser: native vs WASM

Phase 3a moved parsing from the native `tree-sitter` binding (0.21.1) to
`web-tree-sitter` 0.27.1 with the same grammar versions built to WebAssembly.
Apple M4, Node v24.13.0, macOS, recorded 2026-10-27. Each cell is the median
of 5 full `scan` runs (wall time / peak RSS from `/usr/bin/time -l`), with the
two builds alternating so neither always runs on a warm file cache.

| Sample | Native ms | Native MB | WASM ms | WASM MB | WASM / native |
| --- | ---: | ---: | ---: | ---: | ---: |
| express | 954 | 184 | 481 | 226 | 0.50 |
| fastify | 115 | 102 | 98 | 122 | 0.85 |
| nestjs-starter | 88 | 90 | 81 | 125 | 0.92 |
| ky | 714 | 170 | 354 | 211 | 0.50 |
| internet-node-express-firebase-mongodb | 139 | 104 | 111 | 130 | 0.80 |
| internet-node-express-realworld | 159 | 106 | 120 | 121 | 0.75 |
| internet-nest | 3351 | 287 | 1327 | 305 | 0.40 |

- **Parsing alone is slower on WASM** (all 2091 files of the samples, 4.4 MB:
  native 257 ms, WASM 453 ms). Full scans are still faster because extractors
  read many node properties, and each read is an N-API call on the native
  binding but a plain WebAssembly memory read on web-tree-sitter.
- **Memory** is 15–40 MB higher (the WebAssembly heap). Six scans of
  `internet-nest` in one process level off at about 370 MB RSS; trees are freed
  with `delete()` and do not accumulate.
- **Output is identical**: golden graph, golden query and smoke tests pass
  unchanged, and `internet-nest` gives the same 40488 nodes and 41360
  relationships on both builds.
- **Install**: `npm ci --omit=dev --ignore-scripts` gives a 4.5 MB
  `node_modules` (only `web-tree-sitter`, was 67 MB with the native binding and
  five grammar packages). The vendored grammars add 3.5 MB.

## Parse cache

`npm run benchmark:incremental` (Phase 5), Apple M4, Node v24.13.0, recorded
2026-10-28. In-process `buildGraph` times in milliseconds for a full scan (no
cache), a cold-cache scan (parses everything and writes the cache) and a
warm-cache scan with no file changes. Every warm scan reproduced the full
scan's graph exactly.

| Sample | Files | Full | Cold cache | Warm cache | Full / warm |
| --- | ---: | ---: | ---: | ---: | ---: |
| express | 141 | 333 | 316 | 61 | 5.4× |
| fastify | 18 | 15 | 14 | 3.9 | 3.9× |
| nestjs-starter | 7 | 9.6 | 5.1 | 2.1 | 4.5× |
| ky | 52 | 194 | 205 | 33 | 5.9× |
| internet-node-express-firebase-mongodb | 24 | 28 | 23 | 4.0 | 7.1× |
| internet-node-express-realworld | 39 | 28 | 31 | 5.8 | 4.8× |
| internet-nest | 1714 | 1433 | 1581 | 402 | 3.6× |

- What remains of a warm scan is file discovery, hashing every file for the
  manifest, reading cache entries, and the cross-file passes, which always run
  (about 200 ms of the 400 ms on `internet-nest`).
- A cold-cache scan costs up to 10% more than a full scan for writing entries.
- The two `internet-nest` files that fail to parse are never cached and are
  parsed on every scan.
- From the CLI, `scan` of express goes from 0.49 s to 0.22 s wall time with a
  warm cache.

## Parser benchmark and parse workers

`npm run bench:parser` (Phase 3e) builds, then measures `dist/` on every
sample: tree-sitter alone, the language parsers (parse plus extraction, run
once per file), and a full scan without the parse cache, on the main thread
and with the default parse workers. Apple M4, Node v24.13.0, recorded
2026-10-28; medians of 5 runs in milliseconds.

| Sample | Files | KB | Parse | Extract | Scan, main thread | Extract / scan | Scan, workers |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| express | 141 | 532 | 63 | 236 | 264 | 89% | 220 (4) |
| fastify | 18 | 18 | 2 | 8 | 10 | 80% | 10 (0) |
| nestjs-starter | 7 | 3 | 0 | 2 | 3 | 67% | 3 (0) |
| ky | 52 | 448 | 51 | 164 | 186 | 88% | 187 (0) |
| internet-node-express-firebase-mongodb | 24 | 40 | 5 | 16 | 18 | 89% | 18 (0) |
| internet-node-express-realworld | 39 | 53 | 6 | 20 | 24 | 83% | 24 (0) |
| internet-nest | 1714 | 3215 | 333 | 1163 | 1417 | 82% | 851 (4) |

- **Per-file work dominates.** Parsing and extraction are 80–90% of a scan;
  tree-sitter itself is about a quarter of that, the rest is walking the trees
  in JavaScript. Cross-file resolvers and semantic contributors are the
  remaining 10–20%.
- **Parse workers.** Files the parse cache does not have are parsed on
  `node:worker_threads` once there are 100 or more of them: up to 4 workers,
  leaving a core for the main thread. `internet-nest` scans 1.7× faster
  (1417 → 851 ms) and `express` 1.2×; more than 4 workers did not help.
  `--workers <n>` sets the count, `--workers 0` parses on the main thread. A
  warm-cache rescan (watch) with few changes stays on the main thread. Worker
  results are structured-cloned copies, and the graph is identical either way
  (`tests/parse-workers.test.ts`, and byte-identical normalized exports of
  `internet-nest`). From the TypeScript sources (`npm run dev`, tests) workers
  start only when asked for, since each one compiles the sources again.
- From the CLI, `scan --no-cache` of `internet-nest` goes from 2.3 s to 1.6 s
  wall time.

### Grammar upgrades

Scan time must not regress when grammars change. Before running
`npm run grammars:build` with new versions, record a baseline on the same
machine, then compare after the rebuild:

```bash
npm run bench:parser -- --json .concentrate/bench-before.json
# update versions in scripts/build-grammars.mjs, then:
npm run grammars:build
npm run bench:parser -- --baseline .concentrate/bench-before.json
```

The comparison lists the grammars that changed and exits with 1 when a
sample's parse or scan median is more than 1.15× the baseline and at least
20 ms slower (`--tolerance`, `--min-delta`), so the small samples' 1–2 ms
jitter does not count.
