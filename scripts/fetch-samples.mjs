#!/usr/bin/env node
// Fetch the pinned sample repositories listed in scripts/samples.json.
// Uses only node: built-ins and the `git` CLI. Safe to re-run: samples already
// at the pinned commit are skipped.
//
//   node scripts/fetch-samples.mjs [--suite standing|internet|all]
//
// Target directory: $CONCENTRATE_SAMPLES_DIR, or .concentrate/samples.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { suite: { type: "string", default: "standing" } } });
if (!["standing", "internet", "all"].includes(values.suite)) {
  console.error(`Unknown suite: ${values.suite} (expected standing, internet or all)`);
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(new URL("./samples.json", import.meta.url), "utf8"));
const samplesDir = path.resolve(process.env.CONCENTRATE_SAMPLES_DIR ?? ".concentrate/samples");
const selected = manifest.samples.filter((sample) => values.suite === "all" || sample.suite === values.suite);

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

mkdirSync(samplesDir, { recursive: true });
for (const sample of selected) {
  const target = path.join(samplesDir, sample.name);
  if (existsSync(path.join(target, ".git"))) {
    let head = "";
    try {
      head = git(target, "rev-parse", "HEAD");
    } catch {
      // Broken checkout; re-fetch below.
    }
    if (head === sample.sha) {
      console.log(`ok       ${sample.name} @ ${sample.sha.slice(0, 12)}`);
      continue;
    }
  }

  console.log(`fetching ${sample.name} @ ${sample.sha.slice(0, 12)} from ${sample.repo}`);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  git(target, "init", "--quiet");
  git(target, "remote", "add", "origin", sample.repo);
  git(target, "fetch", "--quiet", "--depth", "1", "origin", sample.sha);
  git(target, "-c", "advice.detachedHead=false", "checkout", "--quiet", "FETCH_HEAD");
}

console.log(`Samples ready in ${samplesDir}`);
