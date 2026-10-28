import { createHash } from "node:crypto";
import { optionalLimit } from "./args.js";
import { fitToBudget, OUTPUT_BUDGET_CHARS } from "./budget.js";

// Cursor paging for the MCP tools. A paged tool has one primary list (its
// `listKey`); each call returns at most `limit` items of it, starting at the
// cursor's offset, and `page.nextCursor` when more follow. The cursor is
// opaque to clients: base64url JSON holding the offset and a hash of the tool
// name and its other arguments, so a cursor only works with the call that
// produced it. Offsets index the tool's deterministic ordering, so a graph
// that changes between pages can shift items across a page boundary.

export type PageWindow = {
  offset: number;
  limit: number;
  // Rows a query has to return so the page and the "more follow" probe are
  // covered: everything before the page, the page, and one more row.
  fetch: number;
  // The page out of the full ordered list, plus one probe item when more follow.
  take<T>(rows: readonly T[]): T[];
};

export type PageInfo = { offset: number; returned: number; nextCursor?: string; shortenedToFit?: true };

type CursorPayload = { o: number; k: string };

// Reads `limit` and `cursor` from a tool's arguments.
export function pageWindow(tool: string, args: Record<string, unknown>, fallbackLimit: number): PageWindow {
  const limit = optionalLimit(args.limit, fallbackLimit);
  const offset = args.cursor === undefined ? 0 : decodeCursor(tool, args, args.cursor);
  return {
    offset,
    limit,
    fetch: offset + limit + 1,
    take: (rows) => rows.slice(offset, offset + limit + 1),
  };
}

// Builds a paged result from the tool's output: `result[listKey]` holds the
// window from `PageWindow.take`. The page is shortened when the result would
// exceed the output budget; the other lists are shortened by `fitToBudget`
// first if they alone take more than half of it.
export function pagedResult(
  tool: string,
  args: Record<string, unknown>,
  window: PageWindow,
  result: Record<string, unknown>,
  listKey: string,
  budget = OUTPUT_BUDGET_CHARS,
): Record<string, unknown> {
  const { [listKey]: list, ...rest } = result;
  const items = Array.isArray(list) ? list : [];
  let more = items.length > window.limit;
  let page = items.slice(0, window.limit);

  const others = JSON.stringify(rest).length > budget / 2 ? fitToBudget(rest, budget / 2) : rest;
  const size = (count: number) => JSON.stringify({ ...others, [listKey]: page.slice(0, count), page: placeholderPage }).length;
  let shortened = false;
  if (page.length > 1 && size(page.length) > budget) {
    // The largest prefix that fits, keeping at least one item so paging advances.
    let low = 1;
    let high = page.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (size(middle) <= budget) low = middle;
      else high = middle - 1;
    }
    page = page.slice(0, low);
    more = true;
    shortened = true;
  }

  const info: PageInfo = {
    offset: window.offset,
    returned: page.length,
    ...(more ? { nextCursor: encodeCursor(tool, args, window.offset + page.length) } : {}),
    ...(shortened ? { shortenedToFit: true as const } : {}),
  };
  // Keys stay in the tool's order, with `truncated` and `page` last.
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(result)) output[key] = key === listKey ? page : (others as Record<string, unknown>)[key];
  return { ...output, ...others, [listKey]: page, page: info };
}

const placeholderPage: PageInfo = { offset: 0, returned: 0, nextCursor: "x".repeat(64), shortenedToFit: true };

export function encodeCursor(tool: string, args: Record<string, unknown>, offset: number): string {
  const payload: CursorPayload = { o: offset, k: argumentsKey(tool, args) };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeCursor(tool: string, args: Record<string, unknown>, cursor: unknown): number {
  let payload: Partial<CursorPayload> | undefined;
  if (typeof cursor === "string") {
    try {
      payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<CursorPayload>;
    } catch {
      payload = undefined;
    }
  }
  if (!payload || !Number.isSafeInteger(payload.o) || payload.o! < 0 || typeof payload.k !== "string") {
    throw new Error("Invalid cursor: pass page.nextCursor from a previous result unchanged");
  }
  if (payload.k !== argumentsKey(tool, args)) {
    throw new Error(`Invalid cursor: it belongs to a different ${tool} call; repeat the other arguments unchanged`);
  }
  return payload.o!;
}

// Hash of the tool and every argument except the paging ones; `limit` may
// change between pages.
function argumentsKey(tool: string, args: Record<string, unknown>): string {
  const { cursor: _cursor, limit: _limit, ...rest } = args;
  return createHash("sha256").update(`${tool}\0${stableJson(rest)}`).digest("base64url").slice(0, 16);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, child]) => child !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
