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

## Compatibility Smoke

After scanning a graph, verify the stdio protocol with:

```bash
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | npm run mcp -- --database /absolute/path/to/.concentrate/graph
```

Expected behavior:

- `initialize` returns the MCP protocol version, tool capability, and server
  info.
- `tools/list` returns all Concentrate tools.
- `tools/call` responses return MCP `content` blocks containing compact JSON
  text.

Example `tools/call` request:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "graph_stats",
    "arguments": {}
  }
}
```

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

### Output budget

Agent tool results are kept under 24,000 characters of JSON. When a result is
larger, its longest lists are halved until it fits, and a `truncated` object
lists how many items each list lost (for example `{ "callers": 120 }`). Narrow
the call (`file`, a lower `maxDepth` or `limit`) to see the rest. The other
tools are bounded by their `limit` argument instead.

## Current Limits

- The first server pass is read-only and stdio-only.
- Tool responses are compact JSON text payloads.
- `trace_import_chain` follows resolved file-to-file import edges only.
- Backend semantic tools reflect the graph semantics already produced by the
  scanner; they do not execute application code or infer runtime framework
  configuration beyond scanned source relationships.
- Results depend on the existing graph quality and known parser/resolver
  limitations. For the agent tools in particular: Express handlers imported
  from another file are not linked to their routes, and env reads inside class
  methods are recorded on the file rather than the method, so `impact_of` and
  `route_details` cannot follow those links yet.

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
