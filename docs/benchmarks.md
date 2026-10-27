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
