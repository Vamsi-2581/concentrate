import { mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

/**
 * Writer lock for a graph store directory. Only writers lock; readers use
 * snapshots. A lock whose process is gone (same host) or that is older than
 * STALE_AFTER_MS is taken over.
 */

const LOCK_FILE = "LOCK";
const STALE_AFTER_MS = 10 * 60_000;
const WAIT_TIMEOUT_MS = 60_000;

export type LockOwner = { pid: number; host: string; startedAt: string };

export class GraphLockError extends Error {
  constructor(directory: string, readonly owner: LockOwner | null) {
    super(owner
      ? `Graph store ${directory} is locked by process ${owner.pid} on ${owner.host} since ${owner.startedAt}. `
        + "Another scan is writing; wait for it or retry."
      : `Graph store ${directory} is locked by another writer.`);
    this.name = "GraphLockError";
  }
}

export type AcquireOptions = {
  /** Wait for the current writer instead of failing at once. */
  wait?: boolean;
  timeoutMs?: number;
};

/** Take the writer lock; resolves to a release function. */
export async function acquireWriteLock(directory: string, options: AcquireOptions = {}): Promise<() => Promise<void>> {
  await mkdir(directory, { recursive: true });
  const lockPath = path.join(directory, LOCK_FILE);
  const deadline = Date.now() + (options.timeoutMs ?? WAIT_TIMEOUT_MS);
  let delay = 25;

  for (;;) {
    const owner: LockOwner = { pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString() };
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(JSON.stringify(owner));
      } finally {
        await handle.close();
      }
      return async () => {
        try {
          await unlink(lockPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }

    const current = await readOwner(lockPath);
    if (await isStale(lockPath, current)) {
      await unlink(lockPath).catch(() => {});
      continue;
    }
    if (!options.wait || Date.now() >= deadline) {
      throw new GraphLockError(directory, current);
    }
    await sleep(delay);
    delay = Math.min(delay * 2, 500);
  }
}

async function readOwner(lockPath: string): Promise<LockOwner | null> {
  try {
    return JSON.parse(await readFile(lockPath, "utf8")) as LockOwner;
  } catch {
    // Missing, or caught between create and write.
    return null;
  }
}

async function isStale(lockPath: string, owner: LockOwner | null): Promise<boolean> {
  let age: number;
  try {
    age = Date.now() - (await stat(lockPath)).mtimeMs;
  } catch {
    return false;
  }
  if (age > STALE_AFTER_MS) return true;
  if (!owner) return false;
  return owner.host === os.hostname() && !isAlive(owner.pid);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
