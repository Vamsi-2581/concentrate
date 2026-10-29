import type { IGraphContributor } from "../../contracts/graph-contributor.js";
import { resolveCall } from "./call-targets.js";
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
    );

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

// A file whose default export is one of its functions also lists that
// function under the name "default", so default imports and
// `export { default } from` re-exports resolve like named ones. When the
// exported name is a module-level variable (`const ky = createInstance()`),
// a same-named function counts only if that variable declares it, so a
// nested function of the same name is never picked.
function indexDefaultExports(graph: IGraphContributor, functionsByFileAndName: Map<string, Map<string, string[]>>): void {
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
    const functions = functionsByFileAndName.get(fileId);
    if (!functions || functions.has("default")) continue;
    const lines = variableLines.get(`${fileId}\0${name}`);
    const targets = (functions.get(name) ?? []).filter((id) => !lines || lines.includes(Number(nodesById.get(id)?.properties.line)));
    if (targets.length > 0) functions.set("default", targets);
  }
}
