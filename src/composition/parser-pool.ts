import { Worker } from "node:worker_threads";
import type { IParserPool } from "../core/contracts/parser-pool.js";
import type { ParsedSourceFile } from "../core/graph/model.js";
import type { SupportedLanguage } from "../core/scan/language.js";
import { coreIntegrationRegistry } from "./default-registry.js";
import type { ParseRequest, ParseResponse } from "./parse-worker.js";

// Parses files on `size` worker threads. Each file goes to the worker with the
// fewest files in flight; results are structured-cloned back, so they are
// plain copies of what the worker's parser returned. A worker that fails to
// start or dies hands its files to the main thread, so the scan result never
// depends on the workers.

const runningFromSources = import.meta.url.endsWith(".ts");

// From sources every worker compiles the TypeScript module graph again at
// startup, which costs more than parallel parsing saves, so only an explicit
// worker count starts them there.
export const autoParseWorkers = !runningFromSources;
const workerUrl = new URL(runningFromSources ? "./parse-worker.ts" : "./parse-worker.js", import.meta.url);

// Under tsx (tests, `npm run dev`) the worker needs tsx's loader too: loader
// hooks registered on the main thread do not reach worker threads. Workers
// otherwise inherit the process's flags.
function workerOptions(): { execArgv?: string[] } {
  if (!runningFromSources) return {};
  try {
    return { execArgv: ["--import", import.meta.resolve("tsx")] };
  } catch {
    return {};
  }
}

type Job = ParseRequest & { resolve: (parsed: ParsedSourceFile) => void; reject: (error: unknown) => void };
type PoolWorker = { worker: Worker; jobs: Map<number, Job>; failed: boolean };

function parseOnMainThread(job: Job): void {
  coreIntegrationRegistry.getLanguageParser(job.language).parse(job.rootPath, job.filePath).then(job.resolve, job.reject);
}

// `script` is the worker module; tests pass a failing one.
export function createParserPool(size: number, script: URL = workerUrl): IParserPool {
  let nextId = 0;
  let closing = false;
  const options = workerOptions();
  const workers: PoolWorker[] = Array.from({ length: Math.max(1, size) }, () => {
    let worker: Worker;
    try {
      worker = new Worker(script, options);
    } catch {
      return null;
    }
    const entry: PoolWorker = { worker, jobs: new Map(), failed: false };
    entry.worker.on("message", (response: ParseResponse) => {
      const job = entry.jobs.get(response.id);
      if (!job) return;
      entry.jobs.delete(response.id);
      if (response.ok) job.resolve(response.parsed as ParsedSourceFile);
      else job.reject(new Error(response.message));
    });
    const fail = () => {
      if (closing) return;
      entry.failed = true;
      for (const job of entry.jobs.values()) parseOnMainThread(job);
      entry.jobs.clear();
    };
    entry.worker.on("error", fail);
    entry.worker.on("exit", fail);
    return entry;
  }).filter((entry) => entry !== null);

  return {
    parse(language: SupportedLanguage, rootPath: string, filePath: string) {
      return new Promise<ParsedSourceFile>((resolve, reject) => {
        const job: Job = { id: nextId++, language, rootPath, filePath, resolve, reject };
        const live = workers.filter((entry) => !entry.failed);
        if (live.length === 0) return parseOnMainThread(job);
        const entry = live.reduce((least, candidate) => (candidate.jobs.size < least.jobs.size ? candidate : least));
        entry.jobs.set(job.id, job);
        const { id } = job;
        entry.worker.postMessage({ id, language, rootPath, filePath } satisfies ParseRequest);
      });
    },
    async close() {
      closing = true;
      await Promise.all(workers.map((entry) => entry.worker.terminate()));
    },
  };
}
