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
