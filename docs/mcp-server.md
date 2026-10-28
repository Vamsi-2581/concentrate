# MCP Server

Concentrate can expose a scanned graph as a read-only Model Context
Protocol server over stdio.

## Run

Scan a project first:

```bash
npm run scan -- /path/to/project --database .concentrate/graph
```

Start the MCP server:

```bash
npm run mcp -- --database .concentrate/graph
```

Example MCP client command configuration:

```json
{
  "command": "npm",
  "args": [
    "run",
    "mcp",
    "--",
    "--database",
    "/absolute/path/to/.concentrate/graph"
  ]
}
```

The server writes JSON-RPC responses to stdout and keeps graph access read-only.

Use an absolute database path in long-running editor/client configurations so
the MCP process does not depend on the client's working directory.

## Protocol

The server speaks both eras of MCP over newline-delimited JSON-RPC on stdio
and keeps no session state.

- **Modern (2026-07-28).** There is no handshake. Every request carries the
  protocol version in `params._meta["io.modelcontextprotocol/protocolVersion"]`.
  `server/discover` returns `supportedVersions`, `capabilities`
  (`tools`, `resources`) and short `instructions`. Every result has
  `resultType: "complete"` and names the server in
  `_meta["io.modelcontextprotocol/serverInfo"]`. List and read results carry
  `ttlMs` and `cacheScope`: the tool and resource lists are `public` and change
  only with the build; resource contents are `private` with `ttlMs: 0`, since
  every scan changes them. A version other than 2026-07-28 gets error `-32022`
  with `data: { supported, requested }`. `ping` is not part of this era.
- **Legacy (2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05).** `initialize`
  echoes the client's `protocolVersion` when it is one of these and otherwise
  answers `2025-11-25`. Requests without the `_meta` version, `ping` among
  them, get the legacy result shapes.

Errors:

- Unknown methods return `-32601`. An unknown tool, an unknown resource or a
  malformed `tools/call` (no name, non-object arguments) returns `-32602`.
- Failures inside a tool (a missing argument, an invalid cursor, git failing
  in `detect_changes`) are tool results with `isError: true` and the message
  as text, so the model can read and correct them.

Tool results return the JSON twice: as `structuredContent` and as a compact
JSON text block for clients that only read `content`. Every tool has a
`title` and the annotations `readOnlyHint: true`, `destructiveHint: false`,
`idempotentHint: true` and `openWorldHint: false`.

Smoke test after scanning a graph:

```bash
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"graph_stats","arguments":{},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}' \
  | npm run mcp -- --database /absolute/path/to/.concentrate/graph
```

A legacy client starts with
`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"client","version":"1"}}}`
and sends the same `tools/call` without `_meta`.

## Resources

`resources/list` returns one resource, `concentrate://graph/summary`
(`application/json`): schema version, the repo root, file counts, languages,
packages with their file counts, the 15 largest directories (first two path
segments), routes by framework, entrypoints by kind, data models by library,
env var and config counts, and node counts per label. It is a few kilobytes
even for large repositories; read it first to decide which tools to call.

## Tools

- `graph_stats`: returns schema version and node counts.
- `find_definitions`: finds symbols across functions, classes, variables,
  interfaces, type aliases, and enums.
- `find_callers`: finds call sites that resolve to a named function.
- `list_exports`: lists exported definitions and re-exports, optionally scoped
  to one file.
- `trace_import_chain`: returns a resolved import path between two files when
  one exists.
- `list_routes`: lists detected HTTP route declarations and handlers.
- `list_entrypoints`: lists non-HTTP backend entrypoints such as queues, cron
  jobs, events, realtime handlers, and schedulers.
- `list_env_config`: lists environment variable usage and config declarations
  or consumers.
- `list_data_access`: lists data-access operations by source, model, library,
  and operation.

### Agent tools

These answer a whole question in one call instead of a chain of lookups.

- `impact_of({ symbol?, file?, maxDepth = 5, limit = 50 })`: what is affected
  if a function, method, class or file changes. A symbol selects functions with
  that name and the methods of a class with that name; a file selects every
  function in it; both together narrow the symbol to the file. Returns
  `callers` (transitive, with `depth`), `moduleCallers` (top-level code that
  calls the seeds or their callers), `routes` and `entrypoints` that run any of
  them (`reachedThrough` says which function and in which role), and the
  `dataAccess`, `envVars` and `config` of the seeds themselves. For a route,
  use `route_details`.
- `detect_changes({ base = "HEAD", maxDepth = 5, limit = 50 })`: runs
  `git diff --unified=0 <base>` (no shell; `base` must look like a revision)
  plus untracked files, maps the changed lines onto declarations whose
  `line..endLine` span they touch, and returns the impact of the changed
  functions as in `impact_of`. Changed files the graph does not know are listed
  under `unscannedFiles`; rescan, or keep `concentrate watch` running, to
  include them. Fails when the scanned project is not in a git work tree.
- `route_details({ method, path, limit = 5 })`: for each matching route (method
  case-insensitive, path matched against the resolved full path or the path as
  declared): `handlers`, `lifecycle` steps (middleware, guards, hooks, ...) in
  order, the `callChain` from those functions (up to 4 levels, caller → callee
  with the call line), and the `dataAccess`, `envVars` and `config` of the
  route and that chain (`usedBy` lists where each one is used).
- `get_symbol_source({ name, file?, kind?, limit = 5 })`: source text of a
  declaration, sliced from the file on disk with the span from the last scan
  (at most 400 lines each, `truncated: true` beyond). `Class.method` selects
  one class's method; `kind` is one of function, method, class, interface,
  type, enum, variable.
- `get_file_outline({ file })`: the declarations of one file from the graph in
  line order: imports, functions, classes with their methods and fields,
  interfaces, types, enums, variables, routes and entrypoints. `file` can be a
  unique path suffix; several matches return `candidates`.

`file` arguments accept the scan-relative path or a path suffix
(`users/service.ts` matches `src/users/service.ts`).

Example:

```json
{ "name": "impact_of", "arguments": { "symbol": "UserService", "maxDepth": 3 } }
```

### Paging and output budget

Every tool that returns a list pages one primary list: `definitions`,
`callers`, `exports`, `routes`, `entrypoints`, `envConfig`, `dataAccess`, and
for the agent tools `callers` (`impact_of`), `changedFiles`
(`detect_changes`), `routes` (`route_details`), `matches`
(`get_symbol_source`) and `outline` (`get_file_outline`, `limit` defaults to
200). `limit` is the page size (at most 200). The result has a
`page: { offset, returned, nextCursor? }` field; pass `nextCursor` back as
`cursor` with the other arguments unchanged to get the next page. `limit` may
change between pages. A cursor from a different call, or one that was
altered, is rejected as a tool error. Pages follow each tool's fixed ordering;
if the graph is rescanned between pages, items can shift across a page
boundary.

`graph_stats` and `trace_import_chain` return a single answer and are not
paged.

Results are kept under 24,000 characters of JSON. A page that would be larger
ends early, with `page.shortenedToFit: true` and a `nextCursor` that continues
right after it. Other lists in a result (for example `routes` in `impact_of`)
are capped by `limit`; when they are still too large, the longest are halved
and a `truncated` object lists how many items each lost (for example
`{ "routes": 12 }`). Narrow the call (`file`, a lower `maxDepth`) to see them.

## Current Limits

- The first server pass is read-only and stdio-only.
- `trace_import_chain` follows resolved file-to-file import edges only.
- Backend semantic tools reflect the graph semantics already produced by the
  scanner; they do not execute application code or infer runtime framework
  configuration beyond scanned source relationships.
- Results depend on the existing graph quality and known parser/resolver
  limitations. Route handlers and middleware imported from another file are
  linked when they are bound by name (`import { listUsers } from './users'`,
  `const { auth } = require('./auth')`); default imports, namespace members
  (`handlers.list`) and re-export barrels are not followed yet.

## Troubleshooting

- If a client shows an empty graph, run `npm run scan -- <project>
  --database <path>` first and point MCP to the same database path.
- If a client starts MCP from another working directory, use an absolute
  `--database` path.
- The server never locks the store, so it can stay running while you scan. A
  finished scan is picked up on the next tool call; no restart is needed.
  Run `concentrate watch <project>` next to the server to keep the graph
  current while you edit.
- If the path is an old `.kuzu` database, the server reports it. Delete it and
  scan again (the default store is now the `.concentrate/graph/` directory).
- If a tool returns fewer semantic rows than expected, verify the graph with
  `npm run smoke:samples` and review known parser/resolver limitations.
