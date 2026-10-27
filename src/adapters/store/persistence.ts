import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import { MemoryGraph, type NodeRecord, type PropertyValue, type RelationshipRecord } from "./graph.js";

/**
 * On-disk snapshot of a MemoryGraph:
 *
 *   <dir>/HEAD.json                 which segments make up the current graph
 *   <dir>/segments/<hash>.jsonl.gz  one segment per owning source file, plus "global"
 *
 * Segments are content-addressed and never overwritten, so a commit writes
 * only the segments whose content changed and then atomically renames
 * HEAD.json. Readers never lock: they read HEAD.json and the segments it names.
 */

export const STORE_FORMAT = 1;
export const GLOBAL_SEGMENT = "global";
const HEAD_FILE = "HEAD.json";
const SEGMENTS_DIR = "segments";
/** Unreferenced segments are kept this long so readers of the previous HEAD can finish. */
const SEGMENT_GRACE_MS = 60_000;
const READ_ATTEMPTS = 3;

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export type Head = {
  format: number;
  schemaVersion: number;
  generation: number;
  writtenAt: string;
  nodes: number;
  relationships: number;
  /** Segment key (owning file id or "global") → segment file name. */
  segments: Record<string, string>;
};

type NodeLine = ["n", string, string, Record<string, PropertyValue>];
type RelationshipLine = ["r", string, string, string, Record<string, PropertyValue>];

export async function readHead(directory: string): Promise<Head | null> {
  let raw: string;
  try {
    raw = await readFile(path.join(directory, HEAD_FILE), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const head = JSON.parse(raw) as Head;
  if (head.format !== STORE_FORMAT) {
    throw new Error(`Unsupported graph store format ${head.format} in ${directory}; run concentrate scan again`);
  }
  return head;
}

/** Load the current snapshot. A segment deleted under us means a newer HEAD exists, so start over. */
export async function loadSnapshot(directory: string): Promise<{ head: Head | null; graph: MemoryGraph }> {
  for (let attempt = 1; ; attempt += 1) {
    const head = await readHead(directory);
    const graph = new MemoryGraph();
    if (!head) return { head, graph };
    try {
      const segments = await Promise.all(Object.values(head.segments).map(async (file) => (
        (await gunzipAsync(await readFile(path.join(directory, SEGMENTS_DIR, file)))).toString("utf8")
      )));
      const relationshipLines: RelationshipLine[] = [];
      for (const segment of segments) {
        for (const line of segment.split("\n")) {
          if (!line) continue;
          const record = JSON.parse(line) as NodeLine | RelationshipLine;
          if (record[0] === "n") graph.addNode(record[1], record[2], record[3]);
          else relationshipLines.push(record);
        }
      }
      for (const [, type, from, to, properties] of relationshipLines) {
        if (!graph.addRelationship(type, from, to, properties)) {
          throw new Error(`Corrupt graph store in ${directory}: ${type} ${from} -> ${to} has a missing endpoint`);
        }
      }
      return { head, graph };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || attempt >= READ_ATTEMPTS) throw error;
    }
  }
}

/** Write `graph` as the next generation. The caller holds the writer lock. */
export async function commitSnapshot(
  directory: string,
  graph: MemoryGraph,
  options: { schemaVersion: number; previous: Head | null },
): Promise<Head> {
  const segmentsDirectory = path.join(directory, SEGMENTS_DIR);
  await mkdir(segmentsDirectory, { recursive: true });

  const segments: Record<string, string> = {};
  for (const [key, content] of serializeSegments(graph)) {
    const file = `${createHash("sha256").update(content).digest("hex").slice(0, 32)}.jsonl.gz`;
    segments[key] = file;
    if (options.previous && Object.values(options.previous.segments).includes(file)) continue;
    const target = path.join(segmentsDirectory, file);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, await gzipAsync(content));
    await rename(temporary, target);
  }

  const head: Head = {
    format: STORE_FORMAT,
    schemaVersion: options.schemaVersion,
    generation: (options.previous?.generation ?? 0) + 1,
    writtenAt: new Date().toISOString(),
    nodes: graph.nodeCount,
    relationships: graph.relationshipCount,
    segments,
  };
  const headPath = path.join(directory, HEAD_FILE);
  const temporary = `${headPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(head, null, 2)}\n`);
  await rename(temporary, headPath);

  await collectGarbage(segmentsDirectory, new Set(Object.values(segments)));
  return head;
}

async function collectGarbage(segmentsDirectory: string, referenced: ReadonlySet<string>): Promise<void> {
  const now = Date.now();
  for (const file of await readdir(segmentsDirectory)) {
    if (referenced.has(file)) continue;
    const target = path.join(segmentsDirectory, file);
    try {
      if (now - (await stat(target)).mtimeMs > SEGMENT_GRACE_MS) await unlink(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

/**
 * Split the graph into segments: what each file owns (its File node, every
 * node whose id starts with `<file id>:`, and relationships inside the file),
 * plus one global segment for everything else. Lines are sorted so equal
 * content always hashes the same, whatever the insertion order.
 */
export function serializeSegments(graph: MemoryGraph): Map<string, string> {
  const fileIds = new Set([...graph.nodesWithLabel("File")].map((node) => node.id));
  const ownerCache = new Map<NodeRecord, string>();
  const owner = (node: NodeRecord): string => {
    let key = ownerCache.get(node);
    if (key === undefined) {
      key = owningFile(node.id, fileIds) ?? GLOBAL_SEGMENT;
      ownerCache.set(node, key);
    }
    return key;
  };

  const lines = new Map<string, string[]>();
  const add = (key: string, line: string) => {
    let list = lines.get(key);
    if (!list) lines.set(key, list = []);
    list.push(line);
  };
  for (const node of graph.nodes()) {
    add(owner(node), JSON.stringify(["n", node.label, node.id, node.properties] satisfies NodeLine));
  }
  for (const relationship of graph.relationships()) {
    const from = owner(relationship.from);
    add(from === owner(relationship.to) ? from : GLOBAL_SEGMENT, relationshipLine(relationship));
  }

  const segments = new Map<string, string>();
  for (const key of [...lines.keys()].sort()) {
    segments.set(key, `${lines.get(key)!.sort().join("\n")}\n`);
  }
  return segments;
}

function relationshipLine(relationship: RelationshipRecord): string {
  return JSON.stringify([
    "r", relationship.type, relationship.from.id, relationship.to.id, relationship.properties,
  ] satisfies RelationshipLine);
}

/** The longest File id that equals `id` or is followed by `:` in it. */
function owningFile(id: string, fileIds: ReadonlySet<string>): string | undefined {
  if (fileIds.has(id)) return id;
  if (!id.startsWith("file:")) return undefined;
  for (let index = id.lastIndexOf(":"); index > "file:".length - 1; index = id.lastIndexOf(":", index - 1)) {
    const candidate = id.slice(0, index);
    if (fileIds.has(candidate)) return candidate;
  }
  return undefined;
}
