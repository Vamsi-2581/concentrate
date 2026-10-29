import { readFile } from "node:fs/promises";
import path from "node:path";
import type { IGraphContributor } from "../../../core/contracts/graph-contributor.js";
import type { GraphNode } from "../../../core/graph/model.js";
import { addUniqueScanWarning, type ScanReport } from "../../../core/scan/report.js";

// Prisma schema files (schema.prisma, or a folder of .prisma files that form
// one schema) read without the Prisma toolchain: models, views, enums and
// composite types with their fields and attributes, and the datasource
// provider. The scan adds a DataModel per model, a Table per model and view
// (named after @@map, else the model), MAPS_TO_TABLE between them and
// RELATES_TO for relation fields.

export type PrismaAttribute = { name: string; args: PrismaArgument[] };
export type PrismaArgument = { key: string | null; value: string | string[] };

export type PrismaField = {
  name: string;
  type: string;
  list: boolean;
  optional: boolean;
  line: number;
  attributes: PrismaAttribute[];
};

export type PrismaBlock = {
  kind: "model" | "view" | "enum" | "type";
  name: string;
  file: string;
  line: number;
  fields: PrismaField[];
  attributes: PrismaAttribute[];
};

export type ParsedPrismaFile = {
  provider: string | null;
  blocks: PrismaBlock[];
  errors: Array<{ line: number; message: string }>;
};

const blockStart = /^(model|view|enum|type|datasource|generator)\s+([A-Za-z_]\w*)\s*\{\s*$/u;
const fieldLine = /^([A-Za-z_]\w*)\s+([A-Za-z_][\w.]*)(\[\])?(\?)?(?:\s+(.*))?$/u;

export function parsePrismaSchema(source: string, file: string): ParsedPrismaFile {
  const result: ParsedPrismaFile = { provider: null, blocks: [], errors: [] };
  let current: { kind: string; block: PrismaBlock } | null = null;

  for (const [index, raw] of source.split(/\r?\n/u).entries()) {
    const line = index + 1;
    const text = stripComment(raw).trim();
    if (!text) continue;

    if (!current) {
      const start = blockStart.exec(text);
      if (!start) {
        result.errors.push({ line, message: `Unexpected ${JSON.stringify(text.slice(0, 40))} outside a block` });
        continue;
      }
      current = {
        kind: start[1]!,
        block: { kind: start[1] as PrismaBlock["kind"], name: start[2]!, file, line, fields: [], attributes: [] },
      };
      continue;
    }

    if (text === "}") {
      if (["model", "view", "enum", "type"].includes(current.kind)) result.blocks.push(current.block);
      current = null;
      continue;
    }

    const block = current.block;
    if (current.kind === "datasource" || current.kind === "generator") {
      const setting = /^(\w+)\s*=\s*(.+)$/u.exec(text);
      if (current.kind === "datasource" && setting?.[1] === "provider") result.provider = unquote(setting[2]!.trim());
      continue;
    }
    // Block attributes are kept without the second `@`: @@map -> map.
    if (text.startsWith("@@")) {
      block.attributes.push(...parseAttributes(text.slice(1)));
      continue;
    }
    if (current.kind === "enum") {
      const value = /^([A-Za-z_]\w*)\b(.*)$/u.exec(text);
      if (value) block.fields.push({ name: value[1]!, type: "enum", list: false, optional: false, line, attributes: parseAttributes(value[2]!) });
      else result.errors.push({ line, message: `Unrecognized enum value in ${block.name}` });
      continue;
    }
    const field = fieldLine.exec(text);
    if (!field) {
      result.errors.push({ line, message: `Unrecognized field in ${block.kind} ${block.name}` });
      continue;
    }
    block.fields.push({
      name: field[1]!,
      type: field[2]!,
      list: field[3] !== undefined,
      optional: field[4] !== undefined,
      line,
      attributes: parseAttributes(field[5] ?? ""),
    });
  }

  if (current) result.errors.push({ line: current.block.line, message: `Unclosed block ${current.block.name}` });
  return result;
}

// `// comment` outside strings.
function stripComment(line: string): string {
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === "\\" && quoted) index++;
    else if (char === "\"") quoted = !quoted;
    else if (!quoted && char === "/" && line[index + 1] === "/") return line.slice(0, index);
  }
  return line;
}

// `@id @default(now()) @relation("A", fields: [x])` -> attributes with their
// top-level arguments. Text before the first `@` is ignored.
export function parseAttributes(text: string): PrismaAttribute[] {
  const attributes: PrismaAttribute[] = [];
  let index = text.indexOf("@");
  while (index !== -1 && index < text.length) {
    const name = /^@([A-Za-z_][\w.]*)/u.exec(text.slice(index));
    if (!name) {
      index = text.indexOf("@", index + 1);
      continue;
    }
    index += name[0].length;
    let args: PrismaArgument[] = [];
    if (text[index] === "(") {
      const end = closingParenthesis(text, index);
      args = splitTopLevel(text.slice(index + 1, end)).map(parseArgument);
      index = end + 1;
    }
    attributes.push({ name: name[1]!, args });
    index = text.indexOf("@", index);
  }
  return attributes;
}

function closingParenthesis(text: string, open: number): number {
  let depth = 0;
  let quoted = false;
  for (let index = open; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === "\\") index++;
      else if (char === "\"") quoted = false;
    } else if (char === "\"") quoted = true;
    else if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") {
      depth--;
      if (depth === 0) return index;
    }
  }
  return text.length;
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === "\\") index++;
      else if (char === "\"") quoted = false;
    } else if (char === "\"") quoted = true;
    else if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (char === "," && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function parseArgument(text: string): PrismaArgument {
  const named = /^([A-Za-z_]\w*)\s*:\s*([\s\S]+)$/u.exec(text);
  const value = (named ? named[2]! : text).trim();
  return {
    key: named ? named[1]! : null,
    value: value.startsWith("[") && value.endsWith("]")
      ? splitTopLevel(value.slice(1, -1)).map(unquote)
      : unquote(value),
  };
}

function unquote(value: string): string {
  return value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")
    ? value.slice(1, -1).replace(/\\(.)/gu, "$1")
    : value;
}

function attribute(attributes: readonly PrismaAttribute[], name: string): PrismaAttribute | undefined {
  return attributes.find((entry) => entry.name === name);
}

// A named argument, or with key null the first positional one.
function argument(attr: PrismaAttribute | undefined, key: string | null): string | string[] | undefined {
  return attr?.args.find((arg) => arg.key === key)?.value;
}

function stringArgument(attr: PrismaAttribute | undefined, key: string | null): string | null {
  const value = argument(attr, key);
  return typeof value === "string" ? value : null;
}

function listArgument(attr: PrismaAttribute | undefined, key: string | null): string[] | null {
  const value = argument(attr, key);
  return Array.isArray(value) ? value : null;
}

export type PrismaSchema = {
  // Scan-relative directory of the schema (the folder for multi-file schemas).
  directory: string;
  // Scan-relative directory of the nearest package.json above the schema.
  packageDirectory: string | null;
  provider: string | null;
  blocks: PrismaBlock[];
};

// Prisma model ids by client accessor (`prisma.user` -> User), per schema.
export type PrismaModelIndex = {
  schemas: Array<{ schema: PrismaSchema; modelIdByAccessor: Map<string, string> }>;
  packageDirectories: string[];
};

// Reads every .prisma file the scan discovered. Files in one directory form
// one schema (Prisma's multi-file schema folders); parse errors become scan
// warnings and the rest of the file is kept.
export async function loadPrismaSchemas(
  rootPath: string,
  files: readonly string[],
  report: ScanReport,
): Promise<{ schemas: PrismaSchema[]; packageDirectories: string[] }> {
  const relative = files.map((file) => path.relative(rootPath, file).split(path.sep).join("/"));
  const packageDirectories = relative
    .filter((file) => file === "package.json" || file.endsWith("/package.json"))
    .map((file) => path.posix.dirname(file));

  const byDirectory = new Map<string, string[]>();
  relative.forEach((file, index) => {
    if (!file.endsWith(".prisma") || file.split("/").includes("node_modules")) return;
    const directory = path.posix.dirname(file);
    byDirectory.set(directory, [...(byDirectory.get(directory) ?? []), files[index]!]);
  });

  const schemas: PrismaSchema[] = [];
  for (const [directory, schemaFiles] of [...byDirectory].sort(([a], [b]) => a.localeCompare(b))) {
    const schema: PrismaSchema = {
      directory,
      packageDirectory: nearestPackageDirectory(directory, packageDirectories),
      provider: null,
      blocks: [],
    };
    for (const filePath of schemaFiles.sort()) {
      const file = path.relative(rootPath, filePath).split(path.sep).join("/");
      let source: string;
      try {
        source = await readFile(filePath, "utf8");
      } catch (error) {
        addUniqueScanWarning(report, { path: file, message: error instanceof Error ? error.message : String(error) });
        continue;
      }
      const parsed = parsePrismaSchema(source, file);
      schema.provider ??= parsed.provider;
      schema.blocks.push(...parsed.blocks);
      for (const error of parsed.errors) {
        addUniqueScanWarning(report, { path: file, message: `Prisma schema line ${error.line}: ${error.message}` });
      }
    }
    if (schema.blocks.length > 0) schemas.push(schema);
  }
  return { schemas, packageDirectories };
}

export function nearestPackageDirectory(directory: string, packageDirectories: readonly string[]): string | null {
  let best: string | null = null;
  for (const candidate of packageDirectories) {
    const contains = candidate === "." || directory === candidate || directory.startsWith(`${candidate}/`);
    if (contains && (best === null || candidate.length > best.length || best === ".")) best = candidate;
  }
  return best;
}

export function prismaModelId(file: string, model: string): string {
  return `datamodel:prisma:${file}:${model}`;
}

export function tableId(library: string, declaredIn: string | null, name: string): string {
  return `table:${library}:${declaredIn ?? "-"}:${name}`;
}

const lowerFirst = (value: string) => value.charAt(0).toLowerCase() + value.slice(1);

// Adds the schema's models, tables and relations to the graph and returns
// the accessor index data-access resolution links Prisma calls with.
export function addPrismaSchemaGraph(
  graph: IGraphContributor,
  loaded: { schemas: PrismaSchema[]; packageDirectories: string[] },
): PrismaModelIndex {
  const index: PrismaModelIndex = { schemas: [], packageDirectories: loaded.packageDirectories };
  for (const schema of loaded.schemas) {
    const models = schema.blocks.filter((block) => block.kind === "model" || block.kind === "view");
    const modelIds = new Map(models.map((block) => [block.name, prismaModelId(block.file, block.name)]));
    const modelIdByAccessor = new Map<string, string>();

    for (const block of models) {
      const modelId = modelIds.get(block.name)!;
      modelIdByAccessor.set(lowerFirst(block.name), modelId);
      graph.addNode({
        id: modelId,
        label: "DataModel",
        properties: { name: block.name, library: "prisma", declaredIn: block.file, line: block.line },
      });

      const tableName = stringArgument(attribute(block.attributes, "map"), null) ?? block.name;
      const fieldList = (attr: PrismaAttribute) => listArgument(attr, null) ?? listArgument(attr, "fields") ?? [];
      const blockId = attribute(block.attributes, "id");
      const compoundId = blockId ? fieldList(blockId) : [];
      // @@unique([email]) makes one column unique; compound ones do not.
      const singleUnique = new Set(block.attributes
        .filter((attr) => attr.name === "unique")
        .map(fieldList)
        .flatMap((fields) => (fields.length === 1 ? fields : [])));
      const columns = block.fields
        .filter((field) => !modelIds.has(field.type))
        .map((field) => ({
          name: field.name,
          column: stringArgument(attribute(field.attributes, "map"), null) ?? field.name,
          type: field.type,
          optional: field.optional,
          list: field.list,
          isId: attribute(field.attributes, "id") !== undefined || compoundId.includes(field.name),
          isUnique: attribute(field.attributes, "unique") !== undefined || singleUnique.has(field.name),
        }));
      const table: GraphNode = {
        id: tableId("prisma", block.file, tableName),
        label: "Table",
        properties: {
          name: tableName,
          kind: block.kind === "view" ? "view" : schema.provider === "mongodb" ? "collection" : "table",
          library: "prisma",
          schemaName: stringArgument(attribute(block.attributes, "schema"), null),
          provider: schema.provider,
          declaredIn: block.file,
          line: block.line,
          columns: JSON.stringify(columns),
        },
      };
      graph.addNode(table);
      graph.addRelationship({ from: modelId, to: table.id, type: "MAPS_TO_TABLE", properties: {} });

      for (const field of block.fields) {
        const target = modelIds.get(field.type);
        if (!target) continue;
        const relation = attribute(field.attributes, "relation");
        graph.addRelationship({
          from: modelId,
          to: target,
          type: "RELATES_TO",
          properties: {
            field: field.name,
            kind: field.list ? "many" : "one",
            fields: JSON.stringify(listArgument(relation, "fields") ?? []),
            references: JSON.stringify(listArgument(relation, "references") ?? []),
            relationName: stringArgument(relation, "name") ?? stringArgument(relation, null),
            onDelete: stringArgument(relation, "onDelete"),
          },
        });
      }
    }
    index.schemas.push({ schema, modelIdByAccessor });
  }
  return index;
}

// The declared model a `prisma.<accessor>` call in `file` reaches: the schema
// in the caller's package, else the repository's only schema.
export function resolvePrismaModel(index: PrismaModelIndex, file: string, accessor: string): string | null {
  if (index.schemas.length === 0) return null;
  const packageDirectory = nearestPackageDirectory(path.posix.dirname(file), index.packageDirectories);
  const local = index.schemas.filter((entry) => entry.schema.packageDirectory === packageDirectory);
  const candidates = local.length > 0 ? local : index.schemas.length === 1 ? index.schemas : [];
  const matches = candidates.flatMap((entry) => entry.modelIdByAccessor.get(accessor) ?? []);
  return matches.length === 1 ? matches[0]! : null;
}
