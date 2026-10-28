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
