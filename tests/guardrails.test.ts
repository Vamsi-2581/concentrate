/**
 * Dependency boundary guardrails.
 *
 * Allowed dependency directions:
 *
 *   src/core/contracts/
 *     → src/core/graph/model.js     (graph model DTO exports)
 *     → src/core/scan/              (scan/report/result DTO exports)
 *     → each other
 *     ✗ src/integrations/           (language/framework integrations)
 *     ✗ src/adapters/               (platform adapter layer)
 *     ✗ src/commands/               (CLI commands)
 *     ✗ scanner/, parsers/, graph/  (legacy directories, now deleted)
 *
 *   src/core/scan/ and src/core/graph/
 *     → src/core/graph/             (graph model)
 *     → src/core/scan/              (scan utilities)
 *     → src/core/contracts/         (interfaces)
 *     → src/core/integrations/      (registry wiring)
 *     ✗ src/integrations/           (language/framework integrations)
 *     ✗ src/adapters/               (platform adapter layer)
 *
 *   src/core/ (all subdirectories)
 *     ✗ src/composition/            (default wiring; depends on integrations)
 *     ✗ src/integrations/
 *
 *   src/integrations/languages/
 *     → src/core/                   (contracts and core types)
 *     → each other (cross-language)
 *     ✗ src/integrations/frameworks/ (framework semantics)
 *     ✗ src/adapters/               (platform adapter layer)
 *     ✗ src/commands/               (CLI commands)
 *     ✗ scanner/, parsers/, graph/  (legacy directories, now deleted)
 *
 *   src/integrations/frameworks/
 *     → src/core/
 *     → src/integrations/languages/
 *     ✗ src/adapters/               (platform adapter layer)
 *     ✗ src/commands/               (CLI commands)
 *     ✗ scanner/, parsers/, graph/  (legacy directories, now deleted)
 *
 *   src/commands/
 *     → src/adapters/cli/           (platform command adapters)
 *     ✗ src/core/, src/integrations/, src/parsers/
 */

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

const srcRoot = path.join(import.meta.dirname, "../src");

async function collectTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => path.join(e.parentPath, e.name));
}

function extractImportPaths(source: string): string[] {
  // Static `import ... from "x"`, `export ... from "x"` and side-effect `import "x"`.
  // The specifier must follow `from` or the keyword directly, so string literals
  // inside ordinary `export const` / `export function` declarations are ignored.
  const pattern = /^\s*(?:import|export)\b(?:[^'";]*?\bfrom)?\s*['"]([^'"\n]+)['"]/gm;
  return [...source.matchAll(pattern)].map((match) => match[1]!);
}

function resolveImportPath(file: string, importPath: string): string | null {
  if (!importPath.startsWith(".")) {
    return null;
  }

  const resolved = path.resolve(path.dirname(file), importPath);
  return path.relative(srcRoot, resolved).split(path.sep).join("/");
}

async function checkFiles(
  dir: string,
  forbiddenPrefixes: string[],
): Promise<Array<{ file: string; violation: string }>> {
  const violations: Array<{ file: string; violation: string }> = [];
  const files = await collectTsFiles(dir);

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const imports = extractImportPaths(source);

    for (const imp of imports) {
      const resolved = resolveImportPath(file, imp);
      if (!resolved) {
        continue;
      }

      for (const forbidden of forbiddenPrefixes) {
        if (resolved === forbidden || resolved.startsWith(forbidden)) {
          violations.push({
            file: path.relative(srcRoot, file),
            violation: `forbidden import "${imp}" resolves to "${resolved}" under "${forbidden}"`,
          });
        }
      }
    }
  }

  return violations;
}

const legacyDirs = ["scanner/", "parsers/", "graph/"];

/**
 * Runtime packages src/ may still import. Concentrate is moving to zero runtime
 * dependencies (docs/ROADMAP.md): this list may only shrink, and it must be
 * empty at the end of milestone M4.
 */
const RUNTIME_DEPENDENCY_ALLOWLIST: readonly string[] = [
  "tree-sitter", // Phase 3
  "tree-sitter-go", // Phase 3
  "tree-sitter-javascript", // Phase 3
  "tree-sitter-python", // Phase 3
  "tree-sitter-rust", // Phase 3
  "tree-sitter-typescript", // Phase 3
];

function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

/** Bare (non-relative, non-`node:`) package imports per src/ file, including dynamic import() and require(). */
async function bareImportsBySourceFile(): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  for (const file of await collectTsFiles(srcRoot)) {
    const source = await readFile(file, "utf8");
    const specifiers = [
      ...extractImportPaths(source),
      ...[...source.matchAll(/\b(?:import|require)\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1]!),
    ];
    const packages = new Set(specifiers
      .filter((specifier) => !specifier.startsWith(".") && !specifier.startsWith("node:"))
      .map(packageNameOf));
    if (packages.size > 0) {
      result.set(path.relative(srcRoot, file), packages);
    }
  }
  return result;
}

describe("Architecture dependency guardrails", () => {
  it("src/core/contracts/ only imports core contracts, core graph, and core scan DTOs", async () => {
    const violations = await checkFiles(
      path.join(srcRoot, "core/contracts"),
      [
        "integrations/",
        "adapters/",
        "commands/",
        ...legacyDirs,
      ],
    );

    assert.deepEqual(
      violations,
      [],
      `Boundary violations in core/contracts:\n${violations.map((v) => `  ${v.file}: ${v.violation}`).join("\n")}`,
    );
  });

  it("src/core/scan/ and src/core/graph/ do not import from integrations or adapters", async () => {
    const violations = [
      ...await checkFiles(path.join(srcRoot, "core/scan"), ["integrations/", "adapters/", ...legacyDirs]),
      ...await checkFiles(path.join(srcRoot, "core/graph"), ["integrations/", "adapters/", ...legacyDirs]),
    ];

    assert.deepEqual(
      violations,
      [],
      `Boundary violations in core/scan or core/graph:\n${violations.map((v) => `  ${v.file}: ${v.violation}`).join("\n")}`,
    );
  });

  it("src/core/ does not depend on composition, integrations, platform adapters, command modules, or legacy directories", async () => {
    const violations = await checkFiles(
      path.join(srcRoot, "core"),
      [
        "composition/",
        "integrations/",
        "adapters/cli/",
        "adapters/store/",
        "adapters/mcp/",
        "commands/",
        ...legacyDirs,
      ],
    );

    assert.deepEqual(
      violations,
      [],
      `Boundary violations in core:\n${violations.map((v) => `  ${v.file}: ${v.violation}`).join("\n")}`,
    );
  });

  it("src/integrations/languages/ does not import from framework integrations, adapters, commands, or legacy directories", async () => {
    const violations = await checkFiles(
      path.join(srcRoot, "integrations/languages"),
      [
        "integrations/frameworks/",
        "adapters/",
        "commands/",
        ...legacyDirs,
      ],
    );

    assert.deepEqual(
      violations,
      [],
      `Boundary violations in integrations/languages:\n${violations.map((v) => `  ${v.file}: ${v.violation}`).join("\n")}`,
    );
  });

  it("src/integrations/frameworks/ does not import from adapters, commands, or legacy directories", async () => {
    const violations = await checkFiles(
      path.join(srcRoot, "integrations/frameworks"),
      [
        "adapters/",
        "commands/",
        ...legacyDirs,
      ],
    );

    assert.deepEqual(
      violations,
      [],
      `Boundary violations in integrations/frameworks:\n${violations.map((v) => `  ${v.file}: ${v.violation}`).join("\n")}`,
    );
  });

  it("src/integrations/languages/js-ts/resolution/ does not import from framework integrations", async () => {
    const violations = await checkFiles(
      path.join(srcRoot, "integrations/languages/js-ts/resolution"),
      ["integrations/frameworks/"],
    );

    assert.deepEqual(
      violations,
      [],
      `Boundary violations in js-ts/resolution:\n${violations.map((v) => `  ${v.file}: ${v.violation}`).join("\n")}`,
    );
  });

  it("src/integrations/frameworks/js-ts/resolution/ does not import from adapters or commands", async () => {
    const violations = await checkFiles(
      path.join(srcRoot, "integrations/frameworks/js-ts/resolution"),
      ["adapters/", "commands/"],
    );

    assert.deepEqual(
      violations,
      [],
      `Boundary violations in frameworks/js-ts/resolution:\n${violations.map((v) => `  ${v.file}: ${v.violation}`).join("\n")}`,
    );
  });

  it("src/commands/ delegates to CLI adapters instead of core, integrations, or legacy directories", async () => {
    const violations = await checkFiles(
      path.join(srcRoot, "commands"),
      [
        "core/",
        "integrations/",
        "parsers/",
        ...legacyDirs,
      ],
    );

    assert.deepEqual(
      violations,
      [],
      `Boundary violations in commands:\n${violations.map((v) => `  ${v.file}: ${v.violation}`).join("\n")}`,
    );
  });

  it("src/ imports only node: built-ins and allow-listed runtime dependencies", async () => {
    const violations: string[] = [];
    for (const [file, packages] of await bareImportsBySourceFile()) {
      for (const name of packages) {
        if (!RUNTIME_DEPENDENCY_ALLOWLIST.includes(name)) {
          violations.push(`${file}: imports "${name}"`);
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `New runtime dependencies are not allowed (zero-dependency goal, docs/ROADMAP.md):\n${violations.join("\n")}`,
    );
  });

  it("package.json dependencies are a subset of the runtime allow-list", async () => {
    const packageJson = JSON.parse(await readFile(path.join(srcRoot, "../package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const extra = Object.keys(packageJson.dependencies ?? {}).filter((name) => !RUNTIME_DEPENDENCY_ALLOWLIST.includes(name));

    assert.deepEqual(extra, [], `Dependencies outside the allow-list: ${extra.join(", ")}`);
  });

  it("every allow-listed runtime dependency is still imported (remove it from the list once unused)", async () => {
    const used = new Set([...(await bareImportsBySourceFile()).values()].flatMap((packages) => [...packages]));
    const stale = RUNTIME_DEPENDENCY_ALLOWLIST.filter((name) => !used.has(name));

    assert.deepEqual(stale, [], `Allow-listed but no longer imported; remove from RUNTIME_DEPENDENCY_ALLOWLIST and package.json: ${stale.join(", ")}`);
  });

  it("CLI and MCP adapters reach the graph store only through contracts and composition", async () => {
    const violations = [
      ...await checkFiles(path.join(srcRoot, "adapters/cli"), ["adapters/store/"]),
      ...await checkFiles(path.join(srcRoot, "adapters/mcp"), ["adapters/store/"]),
    ];

    assert.deepEqual(
      violations,
      [],
      `Storage engine leaks into CLI/MCP:\n${violations.map((v) => `  ${v.file}: ${v.violation}`).join("\n")}`,
    );
  });
});
