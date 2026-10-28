import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GRAPH_SCHEMA_VERSION } from "./graph-store.js";

// Identifies the code that produces parse results: every module of the running
// build (src/ under tsx, dist/ when built) plus the vendored grammars and the
// graph schema version. Parse cache entries made by other code never match, so
// editing a parser, upgrading a grammar or bumping the schema needs no manual
// cache invalidation.

const codeDirectory = fileURLToPath(new URL("../", import.meta.url));
const grammarManifest = fileURLToPath(new URL("../../vendor/grammars/manifest.json", import.meta.url));

let fingerprint: Promise<string> | undefined;

export function parserFingerprint(): Promise<string> {
  fingerprint ??= computeFingerprint();
  return fingerprint;
}

async function computeFingerprint(): Promise<string> {
  const hash = createHash("sha256").update(`schema ${GRAPH_SCHEMA_VERSION}\0`);
  const entries = await readdir(codeDirectory, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /\.(ts|js)$/.test(entry.name) && !entry.name.endsWith(".d.ts"))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
  for (const file of [...files, grammarManifest]) {
    hash.update(`${path.relative(codeDirectory, file)}\0`).update(await readFile(file)).update("\0");
  }
  return hash.digest("hex");
}
