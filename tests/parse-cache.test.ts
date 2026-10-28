import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { buildCodeGraph } from "../src/composition/orchestrator.js";
import { formatNormalizedGraph, normalizeGraph } from "../src/core/graph/normalize.js";
import { ParseCache } from "../src/core/scan/parse-cache.js";
import type { BuildCodeGraphResult } from "../src/core/scan/index.js";

const fixturesRoot = path.join(import.meta.dirname, "../fixtures");

const normalized = (result: BuildCodeGraphResult) => formatNormalizedGraph(normalizeGraph(result));

async function tempDirectory(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeProject(root: string, files: Record<string, string>): Promise<void> {
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content, "utf8");
  }
}

// Scans with the cache and without it; the graphs must be identical.
async function assertCachedScanMatchesFullScan(root: string, cacheDirectory: string, step: string) {
  const cached = await buildCodeGraph(root, { continueOnError: true, cacheDirectory });
  const full = await buildCodeGraph(root, { continueOnError: true });
  assert.equal(normalized(cached), normalized(full), `${step}: cached scan differs from a full scan`);
  return cached.report.parseCache;
}

describe("parse cache", () => {
  it("matches a full scan after files are added, changed, deleted and renamed", async () => {
    const root = await tempDirectory("concentrate-cache-project-");
    const cacheDirectory = await tempDirectory("concentrate-cache-");
    await writeProject(root, {
      "src/paths.ts": "export const USERS_PATH = '/users'\n",
      "src/routes.ts": [
        "import express from 'express'",
        "import { USERS_PATH } from './paths'",
        "import { greet } from './greet'",
        "const app = express()",
        "const router = express.Router()",
        "function list(req, res) { res.json(greet()) }",
        "router.get(USERS_PATH, list)",
        "app.use('/api', router)",
        "",
      ].join("\n"),
      "src/greet.ts": "export function greet() { return 1; }\n",
    });
    const usersRoute = (result: BuildCodeGraphResult) =>
      result.nodes.find((node) => node.label === "Route" && node.properties.method === "GET");

    let cache = await assertCachedScanMatchesFullScan(root, cacheDirectory, "first scan");
    assert.deepEqual(cache, { enabled: true, hits: 0, misses: 3, written: 3, pruned: 0 });

    cache = await assertCachedScanMatchesFullScan(root, cacheDirectory, "no change");
    assert.deepEqual(cache, { enabled: true, hits: 3, misses: 0, written: 0, pruned: 0 });

    // The route is declared in routes.ts but its path comes from paths.ts:
    // changing only paths.ts must update the route although routes.ts is cached.
    await writeFile(path.join(root, "src/paths.ts"), "export const USERS_PATH = '/people'\n");
    cache = await assertCachedScanMatchesFullScan(root, cacheDirectory, "change");
    assert.deepEqual([cache.hits, cache.misses, cache.pruned], [2, 1, 1]);
    const changed = await buildCodeGraph(root, { continueOnError: true, cacheDirectory });
    assert.equal(usersRoute(changed)?.properties.fullPath, "/api/people");

    await writeProject(root, { "src/extra.ts": "import { greet } from './greet'\nexport const value = greet()\n" });
    cache = await assertCachedScanMatchesFullScan(root, cacheDirectory, "add");
    assert.deepEqual([cache.hits, cache.misses], [3, 1]);

    await rm(path.join(root, "src/extra.ts"));
    cache = await assertCachedScanMatchesFullScan(root, cacheDirectory, "delete");
    assert.deepEqual([cache.hits, cache.misses, cache.pruned], [3, 0, 1]);

    // A rename keeps the content but changes the path, which parse results contain.
    await rename(path.join(root, "src/greet.ts"), path.join(root, "src/hello.ts"));
    await writeFile(
      path.join(root, "src/routes.ts"),
      (await readFile(path.join(root, "src/routes.ts"), "utf8")).replace("'./greet'", "'./hello'"),
    );
    cache = await assertCachedScanMatchesFullScan(root, cacheDirectory, "rename");
    assert.deepEqual([cache.hits, cache.misses], [1, 2]);
    const renamed = await buildCodeGraph(root, { continueOnError: true, cacheDirectory });
    assert.ok(renamed.nodes.some((node) => node.label === "File" && node.properties.relativePath === "src/hello.ts"));
    assert.ok(!renamed.nodes.some((node) => node.label === "File" && node.properties.relativePath === "src/greet.ts"));
  });

  it("matches a full scan on every fixture", async () => {
    const cacheDirectory = await tempDirectory("concentrate-cache-fixtures-");
    const fixtures = (await readdir(fixturesRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory());
    for (const fixture of fixtures) {
      const root = path.join(fixturesRoot, fixture.name);
      await buildCodeGraph(root, { continueOnError: true, cacheDirectory });
      const cache = await assertCachedScanMatchesFullScan(root, cacheDirectory, fixture.name);
      assert.equal(cache.misses, 0, `${fixture.name}: warm scan parsed files again`);
    }
  });

  it("misses when the parser fingerprint changes", async () => {
    const directory = await tempDirectory("concentrate-cache-fingerprint-");
    const parsed = { fileNodeId: "file:a.ts", nodes: [], relationships: [] };
    const before = new ParseCache(directory, "/project", "parser-v1");
    await before.write(before.key("a.ts", "hash"), parsed);
    assert.deepEqual(await before.read(before.key("a.ts", "hash")), parsed);

    const after = new ParseCache(directory, "/project", "parser-v2");
    assert.equal(await after.read(after.key("a.ts", "hash")), null);
    assert.equal(after.report.misses, 1);
  });

  it("keeps projects that share a cache directory apart", async () => {
    const directory = await tempDirectory("concentrate-cache-projects-");
    const parsed = { fileNodeId: "file:a.ts", nodes: [], relationships: [] };
    const first = new ParseCache(directory, "/first", "parser");
    await first.write(first.key("a.ts", "hash"), parsed);

    const second = new ParseCache(directory, "/second", "parser");
    await second.prune();
    assert.equal(second.report.pruned, 0);
    assert.deepEqual(await new ParseCache(directory, "/first", "parser").read(first.key("a.ts", "hash")), parsed);
  });
});
