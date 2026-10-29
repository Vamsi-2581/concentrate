import type { IGraphContributor } from "../../contracts/graph-contributor.js";
import type { GraphNode } from "../../graph/model.js";
import { resolveCall, resolveDeclaration } from "./call-targets.js";
import {
  createResolutionRelationshipIndex,
  indexImportNodesByFile,
  indexNodesByFileAndName,
} from "./indexes.js";

export function addCallResolutionRelationships(graph: IGraphContributor): {
  resolved: number;
  unresolved: number;
} {
  const relationshipIndex = createResolutionRelationshipIndex(graph.relationships);
  const functionsByFileAndName = indexNodesByFileAndName(
    graph.nodes,
    relationshipIndex.fileByFunctionId,
    "Function",
  );
  const importNodesByFile = indexImportNodesByFile(graph.nodes, relationshipIndex.fileByImportId);
  indexDefaultExports(graph, functionsByFileAndName);
  const classesByFileAndName = indexNodesByFileAndName(graph.nodes, relationshipIndex.fileByClassId, "Class");
  indexDefaultExports(graph, classesByFileAndName);
  const classes: ClassIndex = {
    byFileAndName: classesByFileAndName,
    ...indexClassMembers(graph),
    importNodesByFile,
    resolvedFileByImportId: relationshipIndex.resolvedFileByImportId,
  };

  let resolved = 0;
  let unresolved = 0;

  for (const node of graph.nodes) {
    if (node.label !== "Call") continue;

    const callee = node.properties.callee as string | null;
    const receiver = node.properties.receiver as string | null;
    if (!callee) {
      unresolved++;
      continue;
    }

    // A call is made either inside a function or by a file's top-level code.
    const callerFunctionId = relationshipIndex.callerFunctionByCallId.get(node.id);
    const callerFileId = callerFunctionId
      ? relationshipIndex.fileByFunctionId.get(callerFunctionId)
      : relationshipIndex.callerFileByModuleCallId.get(node.id);
    if (!callerFileId) {
      unresolved++;
      continue;
    }

    const targetFunctionId = resolveCall(
      callee,
      receiver,
      callerFileId,
      functionsByFileAndName,
      importNodesByFile,
      relationshipIndex.resolvedFileByImportId,
    ) ?? resolveClassCall(node, callee, receiver, callerFileId, classes);

    if (!targetFunctionId) {
      unresolved++;
      continue;
    }

    graph.addRelationship({
      from: node.id,
      to: targetFunctionId,
      type: "CALL_RESOLVES_TO",
      properties: {},
    });
    resolved++;
  }

  return { resolved, unresolved };
}

type ClassIndex = {
  byFileAndName: Map<string, Map<string, string[]>>;
  methodsByClass: Map<string, Map<string, string>>;
  baseClassesByClass: Map<string, string[]>;
  importNodesByFile: Map<string, GraphNode[]>;
  resolvedFileByImportId: Map<string, string>;
};

// Calls that go through a class rather than a function: `new X(...)` runs
// X's constructor, and `X.method(...)` with X a class runs its static
// method. Both are looked up on the class and then its base classes. A class
// without a constructor anywhere in its chain leaves `new X()` unresolved,
// since CALL_RESOLVES_TO points at functions.
function resolveClassCall(call: GraphNode, callee: string, receiver: string | null, fileId: string, classes: ClassIndex): string | null {
  const expression = call.properties.expression;
  const isNew = typeof expression === "string" && expression.startsWith("new ");
  if (isNew ? receiver !== null : !receiver || receiver === "this" || receiver === "self" || receiver.includes(".")) return null;

  const classId = resolveDeclaration(isNew ? callee : receiver!, fileId, classes.byFileAndName, classes.importNodesByFile, classes.resolvedFileByImportId);
  return classId ? findMethod(classId, isNew ? "constructor" : callee, classes, new Set()) : null;
}

function findMethod(classId: string, name: string, classes: ClassIndex, visited: Set<string>): string | null {
  if (visited.has(classId)) return null;
  visited.add(classId);
  const own = classes.methodsByClass.get(classId)?.get(name);
  if (own) return own;
  for (const baseId of classes.baseClassesByClass.get(classId) ?? []) {
    const inherited = findMethod(baseId, name, classes, visited);
    if (inherited) return inherited;
  }
  return null;
}

function indexClassMembers(graph: IGraphContributor): Pick<ClassIndex, "methodsByClass" | "baseClassesByClass"> {
  const namesById = new Map<string, unknown>();
  for (const node of graph.nodes) {
    if (node.label === "Function") namesById.set(node.id, node.properties.name);
  }
  const methodsByClass = new Map<string, Map<string, string>>();
  const baseClassesByClass = new Map<string, string[]>();
  for (const relationship of graph.relationships) {
    if (relationship.type === "DEFINES_METHOD") {
      const name = namesById.get(relationship.to);
      if (typeof name !== "string") continue;
      let methods = methodsByClass.get(relationship.from);
      if (!methods) methodsByClass.set(relationship.from, methods = new Map());
      if (!methods.has(name)) methods.set(name, relationship.to);
    } else if (relationship.type === "EXTENDS") {
      baseClassesByClass.set(relationship.from, [...baseClassesByClass.get(relationship.from) ?? [], relationship.to]);
    }
  }
  return { methodsByClass, baseClassesByClass };
}

// A file whose default export is one of its functions (or classes) also
// lists it under the name "default", so default imports and
// `export { default } from` re-exports resolve like named ones. When the
// exported name is a module-level variable (`const ky = createInstance()`),
// a same-named function counts only if that variable declares it, so a
// nested function of the same name is never picked.
function indexDefaultExports(graph: IGraphContributor, declarationsByFileAndName: Map<string, Map<string, string[]>>): void {
  const defaults = new Map<string, string>();
  for (const node of graph.nodes) {
    if (node.label === "File" && typeof node.properties.defaultExport === "string") defaults.set(node.id, node.properties.defaultExport);
  }
  if (defaults.size === 0) return;

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const variableLines = new Map<string, number[]>();
  for (const relationship of graph.relationships) {
    if (relationship.type !== "DEFINES_VARIABLE") continue;
    const variable = nodesById.get(relationship.to);
    if (variable?.properties.name !== defaults.get(relationship.from)) continue;
    const key = `${relationship.from}\0${variable!.properties.name}`;
    variableLines.set(key, [...variableLines.get(key) ?? [], Number(variable!.properties.line)]);
  }

  for (const [fileId, name] of defaults) {
    const functions = declarationsByFileAndName.get(fileId);
    if (!functions || functions.has("default")) continue;
    const lines = variableLines.get(`${fileId}\0${name}`);
    const targets = (functions.get(name) ?? []).filter((id) => !lines || lines.includes(Number(nodesById.get(id)?.properties.line)));
    if (targets.length > 0) functions.set("default", targets);
  }
}
