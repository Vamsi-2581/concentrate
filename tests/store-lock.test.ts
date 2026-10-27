import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { acquireWriteLock, GraphLockError } from "../src/adapters/store/lock.js";

const workRoot = await mkdtemp(path.join(os.tmpdir(), "concentrate-lock-"));
after(() => rm(workRoot, { recursive: true, force: true }));

let counter = 0;
const freshDirectory = () => path.join(workRoot, `lock-${counter++}`);
const exists = (file: string) => stat(file).then(() => true, () => false);

/** A pid that is certainly not running: a child that has already exited. */
function deadPid(): number {
  return spawnSync(process.execPath, ["-e", ""]).pid!;
}

describe("writer lock", () => {
  it("records the owner and removes the lock on release", async () => {
    const directory = freshDirectory();
    const release = await acquireWriteLock(directory);
    const owner = JSON.parse(await readFile(path.join(directory, "LOCK"), "utf8"));
    assert.equal(owner.pid, process.pid);
    assert.equal(owner.host, os.hostname());
    await release();
    assert.equal(await exists(path.join(directory, "LOCK")), false);
  });

  it("fails at once while another writer holds it", async () => {
    const directory = freshDirectory();
    const release = await acquireWriteLock(directory);
    await assert.rejects(acquireWriteLock(directory), (error: unknown) => (
      error instanceof GraphLockError && error.owner?.pid === process.pid && /locked by process/.test(error.message)
    ));
    await release();
  });

  it("waits for the holder when asked to, up to a timeout", async () => {
    const directory = freshDirectory();
    const release = await acquireWriteLock(directory);
    await assert.rejects(acquireWriteLock(directory, { wait: true, timeoutMs: 100 }), GraphLockError);
    setTimeout(() => void release(), 50);
    const second = await acquireWriteLock(directory, { wait: true, timeoutMs: 5_000 });
    await second();
  });

  it("takes over a lock whose process is gone", async () => {
    const directory = freshDirectory();
    await acquireWriteLock(directory);
    await writeFile(path.join(directory, "LOCK"), JSON.stringify({ pid: deadPid(), host: os.hostname(), startedAt: new Date().toISOString() }));
    const release = await acquireWriteLock(directory);
    await release();
  });

  it("takes over a lock older than ten minutes", async () => {
    const directory = freshDirectory();
    await acquireWriteLock(directory);
    const lockPath = path.join(directory, "LOCK");
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, host: "elsewhere", startedAt: "2000-01-01T00:00:00.000Z" }));
    const longAgo = new Date(Date.now() - 11 * 60_000);
    await utimes(lockPath, longAgo, longAgo);
    const release = await acquireWriteLock(directory);
    await release();
  });

  it("keeps a lock held by a live process on another host", async () => {
    const directory = freshDirectory();
    await acquireWriteLock(directory);
    await writeFile(path.join(directory, "LOCK"), JSON.stringify({ pid: deadPid(), host: "elsewhere", startedAt: new Date().toISOString() }));
    await assert.rejects(acquireWriteLock(directory), GraphLockError);
  });
});
