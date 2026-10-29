# Agent benchmark

Does an agent answer code questions better or more cheaply when it has
Concentrate's MCP tools? The benchmark asks Claude Code the same questions
twice per run, on the pinned sample repositories:

- **baseline:** `claude -p` with its file tools only: `Read`, `Grep`, `Glob`
  and `ls`.
- **concentrate:** the same tools plus the `concentrate` MCP server
  (`concentrate mcp`) on a graph of the sample.

Both modes run with `--strict-mcp-config`, so the user's own MCP servers are
left out, and with editing, web and sub-agent tools disallowed. The only
difference is the MCP server.

```bash
npm run samples:fetch
npm run bench:agent -- --dry-run          # print the commands, call nothing
npm run bench:agent -- --runs 3           # every question, 3 runs per mode
npm run bench:agent -- --question rw-env --runs 1 --model sonnet
```

It needs the [Claude Code CLI](https://docs.claude.com/en/docs/claude-code)
on `PATH`, signed in. Runs are billed to that account: 13 questions × 2
modes × 3 runs is 78 sessions.

## Questions

[`bench/agent/questions.json`](../bench/agent/questions.json) holds 13
questions over five samples, in five categories:

| Category | Questions | Example |
| --- | ---: | --- |
| callers | 4 | Which functions call `generateToken`? |
| data | 3 | In sample/06-mongoose, which HTTP routes modify the cats collection? |
| routes | 2 | List every HTTP route in the fastify-postgres example. |
| env | 2 | Which environment variables does this app read? |
| impact | 1 | If `profileMapper` changes, which HTTP routes are affected? |
| cycles | 1 | Is there an import cycle inside packages/core/repl? |

The expected answers were written by reading the sample source, not taken
from Concentrate's output. Some questions fall on gaps the
[accuracy report](accuracy.md) found: `generateToken` is called through a
default import that the graph does not resolve, and the fastify-postgres
routes are declared inside a function. Those questions show what an agent
does when the graph is incomplete.

## Scoring

Scoring is deterministic; no model judges the answers. An answer is correct
when it contains every `mustInclude` string and at least one string of each
`anyOf` group, compared case-insensitively with Markdown code marks, quotes
and line breaks ignored. A run that ends in an error (for example the
`--max-turns` limit, 30 by default) is incorrect.

Per question and mode the report gives the number of correct runs and the
medians of:

- **input tokens:** everything the model read, cache writes and reads
  included;
- **output tokens;**
- **tool calls:** the `tool_use` blocks in the transcript, MCP calls included;
- **turns, duration and cost,** as `claude -p --output-format stream-json`
  reports them.

The totals line gives the same medians over all runs of a mode. Results go to
`bench/results/agent-<date>.json` with every run's answer and tool counts.

## Results

Not recorded yet: the benchmark needs a signed-in `claude` CLI, which the
environment that wrote it did not have. Run `npm run bench:agent`, commit the
results file and fill in the README's Numbers section from its totals line.
