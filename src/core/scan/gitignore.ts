import { compileGlob } from "./glob.js";

/**
 * Gitignore rule matching (https://git-scm.com/docs/gitignore).
 *
 * Rules are grouped by the directory whose `.gitignore` they came from. For a
 * path, every group on its ancestor chain is checked from the root down, and
 * the last matching rule wins, so deeper files override shallower ones.
 *
 * `ignores()` checks only the path itself. Git never re-includes a file whose
 * parent directory is ignored; callers get that by not walking into ignored
 * directories (see `walkFiles`).
 */

type Rule = {
  regex: RegExp;
  negated: boolean;
  directoryOnly: boolean;
};

export class GitIgnore {
  private readonly groups = new Map<string, Rule[]>();

  /**
   * Add rules relative to `baseDirectory` (POSIX, `""` for the root).
   * Accepts `.gitignore` file content or a list of patterns.
   */
  add(patterns: string | readonly string[], baseDirectory = ""): this {
    const lines = typeof patterns === "string" ? patterns.split("\n") : patterns;
    const rules = lines.map(parseRule).filter((rule): rule is Rule => rule !== null);
    if (rules.length > 0) {
      const group = this.groups.get(baseDirectory) ?? [];
      group.push(...rules);
      this.groups.set(baseDirectory, group);
    }
    return this;
  }

  ignores(relativePath: string, isDirectory: boolean): boolean {
    let ignored = false;
    const parts = relativePath.split("/");
    for (let depth = 0; depth < parts.length; depth += 1) {
      const base = parts.slice(0, depth).join("/");
      const rules = this.groups.get(base);
      if (!rules) continue;
      const pathInBase = parts.slice(depth).join("/");
      for (const rule of rules) {
        if (rule.directoryOnly && !isDirectory) continue;
        if (rule.regex.test(pathInBase)) {
          ignored = !rule.negated;
        }
      }
    }
    return ignored;
  }
}

function parseRule(rawLine: string): Rule | null {
  let line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
  if (line.startsWith("#")) return null;

  // Trailing spaces are dropped unless escaped with a backslash.
  while (line.endsWith(" ") && !line.endsWith("\\ ")) {
    line = line.slice(0, -1);
  }

  let negated = false;
  if (line.startsWith("!")) {
    negated = true;
    line = line.slice(1);
  }

  let directoryOnly = false;
  if (line.endsWith("/")) {
    directoryOnly = true;
    line = line.slice(0, -1);
  }

  if (line === "") return null;

  // A slash at the start or in the middle anchors the pattern to its base directory.
  let pattern: string;
  if (line.includes("/")) {
    pattern = line.startsWith("/") ? line.slice(1) : line;
  } else {
    pattern = `**/${line}`;
  }
  if (pattern === "") return null;

  return { regex: compileGlob(pattern, { braces: false }), negated, directoryOnly };
}
