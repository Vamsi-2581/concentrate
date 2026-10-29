import type { SyntaxNode } from "../../languages/syntax/tree-sitter.js";
import type { GraphNode, GraphRelationship } from "../../../core/graph/model.js";
import { tableId } from "./prisma-schema.js";

// Parse-time data-model declarations in JS/TS source:
// - TypeORM `@Entity()` / `@ViewEntity()` classes with column and relation
//   decorators on their fields;
// - Mongoose schemas: NestJS `@Schema()` classes with `@Prop()` fields, and
//   `new Schema({ ... })` objects;
// - Drizzle `pgTable` / `mysqlTable` / `sqliteTable` definitions.
// Each becomes a DataModel and a Table joined by MAPS_TO_TABLE. Relations name
// their target by class or variable name, which another file may declare, so
// they are kept on the DataModel as `pendingRelations` and resolved after
// parsing (see data-access.ts).

export type PendingRelation = {
  field: string;
  kind: "one" | "many";
  target: string;
  fields: string[];
  references: string[];
  relationName: string | null;
  onDelete: string | null;
};

type Column = {
  name: string;
  column: string;
  type: string | null;
  optional: boolean;
  list: boolean;
  isId: boolean;
  isUnique: boolean;
};

type Declaration = {
  library: "typeorm" | "mongoose" | "drizzle";
  model: string;
  table: string;
  kind: "table" | "view" | "collection";
  schemaName: string | null;
  provider: string | null;
  line: number;
  columns: Column[];
  relations: PendingRelation[];
};

// What each kind of declaration needs in the source text; files without any
// of these are not walked.
const entityText = /@(?:Entity|ViewEntity|Schema)\b/u;
const schemaObjectText = /\bSchema\s*\(/u;
const drizzleText = /\b(?:pg|mysql|sqlite|singlestore)Table\s*\(/u;

export function applyDataSchemaParseSemantics(
  fileNodeId: string,
  programNode: SyntaxNode,
  nodes: GraphNode[],
  relationships: GraphRelationship[],
): void {
  const source = programNode.text;
  const declaredIn = fileNodeId.slice("file:".length);
  const declarations = [
    ...(entityText.test(source)
      ? programNode.descendantsOfType("class_declaration").flatMap((node) => (node ? classDeclaration(node) : []))
      : []),
    ...(schemaObjectText.test(source) ? mongooseSchemaObjects(programNode) : []),
    ...(drizzleText.test(source) ? drizzleTables(programNode) : []),
  ];
  for (const declaration of declarations) {
    const modelId = `datamodel:${declaration.library}:${declaredIn}:${declaration.model}`;
    const table = tableId(declaration.library, declaredIn, declaration.table);
    nodes.push({
      id: modelId,
      label: "DataModel",
      properties: {
        name: declaration.model,
        library: declaration.library,
        declaredIn,
        line: declaration.line,
        ...(declaration.relations.length > 0 ? { pendingRelations: JSON.stringify(declaration.relations) } : {}),
      },
    });
    nodes.push({
      id: table,
      label: "Table",
      properties: {
        name: declaration.table,
        kind: declaration.kind,
        library: declaration.library,
        schemaName: declaration.schemaName,
        provider: declaration.provider,
        declaredIn,
        line: declaration.line,
        columns: JSON.stringify(declaration.columns),
      },
    });
    relationships.push({ from: modelId, to: table, type: "MAPS_TO_TABLE", properties: {} });
  }
}

// TypeORM entities and NestJS Mongoose schema classes.

const typeormColumnDecorators = new Set([
  "Column",
  "PrimaryColumn",
  "PrimaryGeneratedColumn",
  "ObjectIdColumn",
  "CreateDateColumn",
  "UpdateDateColumn",
  "DeleteDateColumn",
  "VersionColumn",
]);
const typeormIdDecorators = new Set(["PrimaryColumn", "PrimaryGeneratedColumn", "ObjectIdColumn"]);
const typeormRelationDecorators = new Map<string, "one" | "many">([
  ["OneToOne", "one"],
  ["ManyToOne", "one"],
  ["OneToMany", "many"],
  ["ManyToMany", "many"],
]);

type Decorator = { name: string; args: SyntaxNode[] };

function classDeclaration(node: SyntaxNode): Declaration[] {
  const name = node.childForFieldName("name")?.text;
  if (!name) return [];
  const decorators = decoratorsOf(node.parent?.type === "export_statement" ? node.parent : node);
  const entity = decorators.find((decorator) => decorator.name === "Entity" || decorator.name === "ViewEntity");
  const schema = decorators.find((decorator) => decorator.name === "Schema");
  if (!entity && !schema) return [];
  const fields = classFields(node);
  const line = node.startPosition.row + 1;

  if (entity) {
    const [first, second] = entity.args;
    const options = objectProperties(first?.type === "object" ? first : second);
    const columns: Column[] = [];
    const relations: PendingRelation[] = [];
    let objectIds = false;
    for (const field of fields) {
      for (const decorator of field.decorators) {
        if (typeormColumnDecorators.has(decorator.name)) {
          if (decorator.name === "ObjectIdColumn") objectIds = true;
          const [typeArg, optionsArg] = decorator.args;
          const columnOptions = objectProperties(typeArg?.type === "object" ? typeArg : optionsArg);
          columns.push({
            name: field.name,
            column: stringOf(columnOptions.get("name")) ?? field.name,
            type: stringOf(typeArg) ?? stringOf(columnOptions.get("type")) ?? field.type,
            optional: field.optional || columnOptions.get("nullable")?.text === "true",
            list: false,
            isId: typeormIdDecorators.has(decorator.name) || columnOptions.get("primary")?.text === "true",
            isUnique: columnOptions.get("unique")?.text === "true",
          });
        }
        const kind = typeormRelationDecorators.get(decorator.name);
        if (kind) {
          const target = targetName(decorator.args[0]);
          if (!target) continue;
          const relationOptions = objectProperties(decorator.args.find((arg) => arg.type === "object"));
          const joinColumn = field.decorators.find((entry) => entry.name === "JoinColumn");
          const joinName = stringOf(objectProperties(joinColumn?.args[0]).get("name"));
          relations.push({
            field: field.name,
            kind,
            target,
            fields: joinName ? [joinName] : [],
            references: [],
            relationName: null,
            onDelete: stringOf(relationOptions.get("onDelete")),
          });
        }
      }
    }
    return [{
      library: "typeorm",
      model: name,
      table: stringOf(first) ?? stringOf(options.get("name")) ?? snakeCase(name),
      kind: entity.name === "ViewEntity" ? "view" : objectIds ? "collection" : "table",
      schemaName: stringOf(options.get("schema")),
      provider: objectIds ? "mongodb" : null,
      line,
      columns,
      relations,
    }];
  }

  const options = objectProperties(schema!.args[0]);
  const columns: Column[] = [];
  const relations: PendingRelation[] = [];
  for (const field of fields) {
    const prop = field.decorators.find((decorator) => decorator.name === "Prop");
    if (!prop) continue;
    const propOptions = prop.args[0]?.type === "array" ? objectProperties(prop.args[0].namedChildren[0] ?? undefined) : objectProperties(prop.args[0]);
    const list = prop.args[0]?.type === "array" || /\[\]$/u.test(field.type ?? "");
    const ref = targetName(propOptions.get("ref"));
    if (ref) {
      relations.push({ field: field.name, kind: list ? "many" : "one", target: ref, fields: [], references: [], relationName: null, onDelete: null });
    }
    columns.push({
      name: field.name,
      column: field.name,
      type: (propOptions.get("type") ? typeText(propOptions.get("type")!) : null) ?? field.type?.replace(/\[\]$/u, "") ?? null,
      optional: propOptions.get("required")?.text !== "true",
      list,
      isId: false,
      isUnique: propOptions.get("unique")?.text === "true",
    });
  }
  return [{
    library: "mongoose",
    model: name,
    table: stringOf(options.get("collection")) ?? mongooseCollectionName(name),
    kind: "collection",
    schemaName: null,
    provider: "mongodb",
    line,
    columns,
    relations,
  }];
}

type ClassField = { name: string; type: string | null; optional: boolean; line: number; decorators: Decorator[] };

function classFields(node: SyntaxNode): ClassField[] {
  const body = node.childForFieldName("body");
  if (!body) return [];
  const fields: ClassField[] = [];
  let pending: Decorator[] = [];
  for (const child of body.namedChildren) {
    if (!child) continue;
    if (child.type === "decorator") {
      const decorator = decoratorOf(child);
      if (decorator) pending.push(decorator);
      continue;
    }
    if (child.type === "public_field_definition" || child.type === "field_definition") {
      const name = (child.childForFieldName("name") ?? child.childForFieldName("property"))?.text;
      if (name) {
        fields.push({
          name,
          type: child.childForFieldName("type")?.text.replace(/^:\s*/u, "") ?? null,
          optional: child.children.some((part) => part?.type === "?"),
          line: child.startPosition.row + 1,
          decorators: [...pending, ...decoratorsOf(child)],
        });
      }
    }
    pending = [];
  }
  return fields;
}

function decoratorsOf(node: SyntaxNode): Decorator[] {
  return node.namedChildren.flatMap((child) => (child?.type === "decorator" ? decoratorOf(child) ?? [] : []));
}

function decoratorOf(node: SyntaxNode): Decorator | null {
  const inner = node.namedChildren[0];
  if (!inner) return null;
  if (inner.type === "call_expression") {
    const name = inner.childForFieldName("function")?.text.split(".").at(-1);
    return name ? { name, args: argumentsOf(inner) } : null;
  }
  return { name: inner.text.split(".").at(-1)!, args: [] };
}

// Mongoose `const CatSchema = new Schema({ ... }, { collection })`, named by
// `model('Cat', CatSchema)` in the same file, else by the variable without
// its Schema suffix.

function mongooseSchemaObjects(programNode: SyntaxNode): Declaration[] {
  const modelNames = new Map<string, string>();
  for (const call of programNode.descendantsOfType("call_expression")) {
    const callee = call?.childForFieldName("function")?.text;
    if (!call || !callee || !/^(?:\w+\.)?model$/u.test(callee)) continue;
    const [nameArg, schemaArg] = argumentsOf(call);
    const name = stringOf(nameArg);
    if (name && schemaArg?.type === "identifier") modelNames.set(schemaArg.text, name);
  }

  const declarations: Declaration[] = [];
  for (const expression of programNode.descendantsOfType("new_expression")) {
    const constructor = expression?.childForFieldName("constructor")?.text;
    if (!expression || !constructor || !/^(?:\w+\.)?Schema$/u.test(constructor)) continue;
    const [definition, optionsArg] = argumentsOf(expression);
    if (definition?.type !== "object") continue;
    const declarator = expression.parent?.type === "variable_declarator" ? expression.parent : null;
    const variable = declarator?.childForFieldName("name")?.text;
    if (!variable) continue;
    const model = modelNames.get(variable) ?? upperFirst(variable.replace(/Schema$/u, "") || variable);

    const columns: Column[] = [];
    const relations: PendingRelation[] = [];
    for (const [field, value] of objectProperties(definition)) {
      const list = value.type === "array";
      const inner = list ? value.namedChildren[0] ?? value : value;
      const options = inner.type === "object" ? objectProperties(inner) : new Map<string, SyntaxNode>();
      const typeNode = inner.type === "object" ? options.get("type") : inner;
      const ref = targetName(options.get("ref"));
      if (ref) relations.push({ field, kind: list ? "many" : "one", target: ref, fields: [], references: [], relationName: null, onDelete: null });
      columns.push({
        name: field,
        column: field,
        type: typeNode ? typeText(typeNode) : null,
        optional: options.get("required")?.text !== "true",
        list,
        isId: false,
        isUnique: options.get("unique")?.text === "true",
      });
    }
    declarations.push({
      library: "mongoose",
      model,
      table: stringOf(objectProperties(optionsArg).get("collection")) ?? mongooseCollectionName(model),
      kind: "collection",
      schemaName: null,
      provider: "mongodb",
      line: expression.startPosition.row + 1,
      columns,
      relations,
    });
  }
  return declarations;
}

// Drizzle `export const users = pgTable('users', { id: serial('id').primaryKey(), ... })`.
// The model is the variable; queries name it (`db.select().from(users)`).

const drizzleTableFunctions = new Map([
  ["pgTable", "postgresql"],
  ["mysqlTable", "mysql"],
  ["sqliteTable", "sqlite"],
  ["singlestoreTable", "singlestore"],
]);

function drizzleTables(programNode: SyntaxNode): Declaration[] {
  const declarations: Declaration[] = [];
  for (const call of programNode.descendantsOfType("call_expression")) {
    if (!call) continue;
    const callee = call.childForFieldName("function");
    // pgTable(...) or a schema's table: authSchema.table(...)
    const provider = callee ? drizzleTableFunctions.get(callee.text) : undefined;
    if (!provider) continue;
    const [nameArg, definition] = argumentsOf(call);
    const table = stringOf(nameArg);
    const declarator = call.parent?.type === "variable_declarator" ? call.parent : null;
    const variable = declarator?.childForFieldName("name")?.text;
    if (!table || !variable || definition?.type !== "object") continue;

    const columns: Column[] = [];
    const relations: PendingRelation[] = [];
    for (const [field, value] of objectProperties(definition)) {
      const chain = callChain(value);
      const base = chain[0];
      if (!base) continue;
      const methods = new Set(chain.slice(1).map((link) => link.name));
      const references = chain.find((link) => link.name === "references");
      const target = references ? referencedTable(references.args[0]) : null;
      if (target) {
        const onDelete = stringOf(objectProperties(references!.args[1]).get("onDelete"));
        relations.push({ field, kind: "one", target: target.table, fields: [field], references: target.column ? [target.column] : [], relationName: null, onDelete });
      }
      columns.push({
        name: field,
        column: stringOf(base.args[0]) ?? field,
        type: base.name,
        optional: !methods.has("notNull") && !methods.has("primaryKey"),
        list: methods.has("array"),
        isId: methods.has("primaryKey"),
        isUnique: methods.has("unique"),
      });
    }
    declarations.push({
      library: "drizzle",
      model: variable,
      table,
      kind: "table",
      schemaName: null,
      provider,
      line: call.startPosition.row + 1,
      columns,
      relations,
    });
  }
  return declarations;
}

// `text('name').notNull().unique()` -> [text('name'), notNull(), unique()].
function callChain(node: SyntaxNode): Array<{ name: string; args: SyntaxNode[] }> {
  const links: Array<{ name: string; args: SyntaxNode[] }> = [];
  let current: SyntaxNode | null = node;
  while (current?.type === "call_expression") {
    const callee: SyntaxNode | null = current.childForFieldName("function");
    const args = argumentsOf(current);
    if (callee?.type === "member_expression") {
      links.unshift({ name: callee.childForFieldName("property")?.text ?? "", args });
      current = callee.childForFieldName("object");
    } else {
      links.unshift({ name: callee?.text ?? "", args });
      current = null;
    }
  }
  return links;
}

// `() => users.id` -> { table: users, column: id }.
function referencedTable(node: SyntaxNode | undefined): { table: string; column: string | null } | null {
  const body = node?.type === "arrow_function" ? node.childForFieldName("body") : node;
  if (body?.type !== "member_expression") return null;
  const object = body.childForFieldName("object");
  return object?.type === "identifier" ? { table: object.text, column: body.childForFieldName("property")?.text ?? null } : null;
}

// Syntax helpers.

function argumentsOf(call: SyntaxNode): SyntaxNode[] {
  return (call.childForFieldName("arguments")?.namedChildren ?? []).filter((arg): arg is SyntaxNode => arg !== null && arg.type !== "comment");
}

function objectProperties(node: SyntaxNode | undefined | null): Map<string, SyntaxNode> {
  const properties = new Map<string, SyntaxNode>();
  if (node?.type !== "object") return properties;
  for (const pair of node.namedChildren) {
    if (pair?.type !== "pair") continue;
    const key = pair.childForFieldName("key");
    const value = pair.childForFieldName("value");
    const name = key?.type === "string" ? stringOf(key) : key?.text;
    if (name && value) properties.set(name, value);
  }
  return properties;
}

function stringOf(node: SyntaxNode | undefined | null): string | null {
  if (!node || (node.type !== "string" && node.type !== "template_string")) return null;
  if (node.type === "template_string" && node.namedChildren.some((child) => child?.type === "template_substitution")) return null;
  return node.text.slice(1, -1);
}

// `() => Photo`, `'Photo'`, `Photo.name`, `Photo` -> Photo.
function targetName(node: SyntaxNode | undefined | null): string | null {
  if (!node) return null;
  const text = stringOf(node);
  if (text) return text;
  const body = node.type === "arrow_function" ? node.childForFieldName("body") : node;
  if (body?.type === "identifier") return body.text;
  if (body?.type === "member_expression" && body.childForFieldName("property")?.text === "name") {
    const object = body.childForFieldName("object");
    return object?.type === "identifier" ? object.text : null;
  }
  return null;
}

// `String`, `mongoose.Schema.Types.ObjectId`, `[String]` -> String, ObjectId.
function typeText(node: SyntaxNode): string | null {
  const inner = node.type === "array" ? node.namedChildren[0] : node;
  if (!inner || (inner.type !== "identifier" && inner.type !== "member_expression")) return null;
  return inner.text.split(".").at(-1) ?? null;
}

// TypeORM's default naming strategy: PhotoMetadata -> photo_metadata.
export function snakeCase(name: string): string {
  return name
    .replace(/([a-z\d])([A-Z])/gu, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z\d]+)/gu, "$1_$2")
    .toLowerCase();
}

// Mongoose's default collection: the model name lowercased and pluralized
// (the common English rules only).
export function mongooseCollectionName(model: string): string {
  const name = model.toLowerCase();
  if (/(?:s|x|z|ch|sh)$/u.test(name)) return `${name}es`;
  if (/[^aeiou]y$/u.test(name)) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}

const upperFirst = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
