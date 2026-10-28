import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, it } from "node:test";
import { startWatch, type WatchScan } from "../src/adapters/cli/watch.js";
import { GraphStore } from "../src/adapters/store/store.js";

// Collects watch scans and lets a test wait for the next one.
function scanRecorder() {
  const scans: WatchScan[] = [];
  let waiters: Array<(scan: WatchScan) => void> = [];
  return {
    scans,
    onScan(scan: WatchScan) {
      scans.push(scan);
      const ready = waiters;
      waiters = [];
      for (const resolve of ready) resolve(scan);
    },
    next(): Promise<WatchScan> {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("no watch scan within 10 s")), 10_000);
        waiters.push((scan) => {
          clearTimeout(timeout);
          resolve(scan);
        });
      });
    },
  };
}

async function functionNames(store: GraphStore): Promise<string[]> {
  const rows = await store.query("MATCH (fn:Function) RETURN fn.name AS name ORDER BY name");
  return rows.map((row) => String((row as { name: unknown }).name));
}

describe("watch", () => {
  it("rescans on changes and keeps the last graph when a scan fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "concentrate-watch-"));
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src/a.ts"), "export function one() { return 1; }\n");
    // Outputs inside the project: the watcher must not rescan because of its own writes.
    const outputs = path.join(root, ".concentrate");
    const options = {
      database: path.join(outputs, "graph"),
      cacheDir: path.join(outputs, "cache"),
      manifest: path.join(outputs, "manifest.json"),
      continueOnError: false,
      include: [],
      exclude: [],
      retryLock: true,
      debounce: 50,
    };

    const recorder = scanRecorder();
    const firstScan = recorder.next();
    const handle = startWatch(root, options, (scan) => recorder.onScan(scan));
    try {
      assert.equal((await firstScan).result?.report.status, "success");
      // A reader opened once, like a running MCP server, sees every new graph.
      const reader = await GraphStore.open(options.database);
      assert.deepEqual(await functionNames(reader), ["one"]);

      let next = recorder.next();
      await writeFile(path.join(root, "src/a.ts"), "export function two() { return 2; }\n");
      await writeFile(path.join(root, "src/b.ts"), "export function three() { return 3; }\n");
      let scan = await next;
      await handle.idle();
      assert.deepEqual(await functionNames(reader), ["three", "two"]);
      assert.ok((scan.result?.report.parseCache.misses ?? 0) >= 1);

      next = recorder.next();
      await writeFile(path.join(root, "src/b.ts"), "export function three( {\n");
      scan = await next;
      await handle.idle();
      assert.equal(scan.result?.report.status, "failed");
      assert.deepEqual(await functionNames(reader), ["three", "two"], "a failed scan keeps the last graph");

      next = recorder.next();
      await rm(path.join(root, "src/b.ts"));
      scan = await next;
      await handle.idle();
      assert.equal(scan.result?.report.status, "success");
      assert.deepEqual(await functionNames(reader), ["two"]);

      const scansSoFar = recorder.scans.length;
      await sleep(400);
      assert.equal(recorder.scans.length, scansSoFar, "writing the store must not trigger another scan");
      await reader.close();
    } finally {
      await handle.close();
    }
  });
});
