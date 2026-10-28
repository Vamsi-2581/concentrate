// Output budget for the agent-facing tools: a tool result must stay small
// enough to fit an agent's context comfortably. When the JSON is larger, the
// longest arrays are halved until it fits, and `truncated` records how many
// items each array lost, so callers know to narrow the query.

export const OUTPUT_BUDGET_CHARS = 24_000;

type Json = Record<string, unknown>;

export function fitToBudget<T extends Json>(value: T, budget = OUTPUT_BUDGET_CHARS): T & { truncated?: Record<string, number> } {
  const result: Json = structuredClone(value);
  const truncated: Record<string, number> = {};

  while (JSON.stringify(result).length > budget) {
    const longest = longestArray(result);
    if (!longest || longest.array.length <= 1) break;
    const keep = Math.floor(longest.array.length / 2);
    truncated[longest.path] = (truncated[longest.path] ?? 0) + longest.array.length - keep;
    longest.array.length = keep;
  }

  if (Object.keys(truncated).length > 0) result.truncated = truncated;
  return result as T & { truncated?: Record<string, number> };
}

// The array with the most serialized characters, searched through nested objects.
function longestArray(value: unknown, path = ""): { path: string; array: unknown[] } | null {
  let best: { path: string; array: unknown[]; size: number } | null = null;
  const visit = (node: unknown, at: string) => {
    if (Array.isArray(node)) {
      const size = JSON.stringify(node).length;
      if (!best || size > best.size) best = { path: at, array: node, size };
      node.forEach((item, index) => visit(item, `${at}[${index}]`));
    } else if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) visit(child, at ? `${at}.${key}` : key);
    }
  };
  visit(value, path);
  return best;
}
