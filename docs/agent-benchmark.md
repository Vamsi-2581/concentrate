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
npm run bench:agent -- --rescore bench/results/agent-2026-10-29.json
```

It needs the [Claude Code CLI](https://docs.claude.com/en/docs/claude-code)
on `PATH` (or `--claude <path>`), signed in. Runs use that account: a
subscription's usage limits, or API billing when `ANTHROPIC_API_KEY` is set.
13 questions × 2 modes × 3 runs is 78 sessions; `--runs 1` is 26.

## Questions

[`bench/agent/questions.json`](../bench/agent/questions.json) holds 13
questions over five samples, in six categories:

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

Recorded 2026-10-29 with Claude Code 2.1.308, `--model sonnet`, one run per
question and mode (`--runs 1 --max-turns 15`) to keep the usage small
([`bench/results/agent-2026-10-29.json`](../bench/results/agent-2026-10-29.json)).
Medians; `base → concentrate`:

| Question | Category | Correct (base / conc.) | Input tokens | Output tokens | Tool calls | Cost USD |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| rw-token-callers | callers | 1/1 / 1/1 | 94.8k → 130.3k | 0.5k → 0.7k | 2 → 4 | 0.0516 → 0.0601 |
| rw-profile-mapper-impact | impact | 1/1 / 1/1 | 134.0k → 208.5k | 1.4k → 1.8k | 7 → 6 | 0.0898 → 0.0937 |
| rw-delete-comment-tables | data | 1/1 / 1/1 | 130.4k → 168.8k | 1.0k → 0.7k | 4 → 4 | 0.0693 → 0.0759 |
| rw-env | env | 1/1 / 1/1 | 95.5k → 97.8k | 0.7k → 0.7k | 3 → 3 | 0.0527 → 0.0566 |
| rw-http-exception | callers | 1/1 / 1/1 | 63.7k → 64.9k | 0.4k → 0.4k | 1 → 1 | 0.0493 → 0.0497 |
| fastify-postgres-routes | routes | 1/1 / 1/1 | 128.4k → 98.1k | 0.8k → 0.6k | 5 → 3 | 0.0679 → 0.0574 |
| fastify-env | env | 1/1 / 1/1 | 94.6k → 96.9k | 0.7k → 0.4k | 2 → 3 | 0.0532 → 0.0518 |
| express-user-routes | routes | 1/1 / 1/1 | 95.2k → 96.9k | 0.6k → 0.6k | 3 → 3 | 0.061 → 0.0549 |
| express-trystat | callers | 1/1 / 1/1 | 94.8k → 96.5k | 0.4k → 0.5k | 2 → 2 | 0.0514 → 0.0516 |
| ky-validate-and-merge | callers | 1/1 / 1/1 | 95.4k → 97.2k | 0.5k → 0.5k | 2 → 2 | 0.0604 → 0.0542 |
| nest-typeorm-user-writes | data | 1/1 / 1/1 | 96.8k → 97.3k | 0.6k → 0.7k | 3 → 3 | 0.064 → 0.0567 |
| nest-mongoose-cat-writes | data | 1/1 / 1/1 | 95.0k → 97.2k | 0.7k → 0.7k | 3 → 3 | 0.0542 → 0.056 |
| nest-repl-cycle | cycles | 1/1 / 1/1 | 131.2k → 101.5k | 1.6k → 0.9k | 5 → 2 | 0.0755 → 0.0758 |

| | Baseline | Concentrate |
| --- | ---: | ---: |
| Correct | 13/13 | 13/13 |
| Median input tokens | 95.4k | 97.3k (+2%) |
| Median tool calls | 3 | 3 |
| Total cost (CLI estimate) | $0.80 | $0.79 |

What this run shows:

- **No difference on these questions.** Both modes answered all 13
  correctly at about the same cost. The questions are narrow and the samples
  small, so one or two greps answer most of them; there is little for a
  graph to save.
- **The agent used the MCP tools in 6 of 13 runs** (`find_callers`,
  `impact_of`, `route_details`, `list_env_config`, `find_import_cycles`).
  Claude Code loads MCP tools on demand, so each of those runs paid for a
  `ToolSearch` call first, and it usually verified the graph's answer with
  grep afterwards.
- **Where it helped:** the import-cycle question (5 → 2 tool calls, 131k →
  102k input tokens), the one a text search cannot answer directly.
- **Where it cost more:** the realworld callers, impact and route-tables
  questions read about 30–55% more input tokens: the MCP calls
  (`find_callers`, `impact_of`, `route_details`) came on top of the greps
  rather than replacing them.
- One run per question is a small sample: a few thousand tokens either way
  is within run-to-run variation. `--runs 3` gives medians.

The first scoring missed the two `nest-mongoose-cat-writes` answers, which
put the routes in a Markdown table (`| POST | /cats |`). The scorer now
reads table bars as spaces, and `npm run bench:agent -- --rescore <file>`
re-scored the saved answers without new runs.

Next steps for a benchmark that can show a difference: questions that need
the whole graph (impact across many files, every route touching a table in
`internet-nest`), and the `--max-turns` limit as a cost ceiling.
