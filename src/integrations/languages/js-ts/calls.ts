import type Parser from "tree-sitter";
import type { GraphNode } from "../../../core/graph/model.js";
import {
  analyzeMemberCallExpression,
  walkScoped,
} from "../tree-sitter-utils.js";
import {
  extractName,
  isClassNode,
  isFunctionNode,
  isModuleLevelDeclarator,
  isVariableClassValue,
  isVariableFunctionValue,
} from "./common.js";
import {
  extractFunctionParameters,
  extractReturnType,
} from "./function-signature.js";

export function isInlineHandlerArgument(node: Parser.SyntaxNode): boolean {
  if (node.type !== "arrow_function" && node.type !== "function_expression") return false;
  if (node.parent?.type !== "arguments") return false;
  const callExpr = node.parent.parent;
  if (!callExpr || callExpr.type !== "call_expression") return false;
  return isModuleLevelCallExpression(callExpr);
}

// A callback passed to the call that initializes a module-level variable:
// `export const User = createParamDecorator((data, ctx) => { … })`.
export function isInitializerHandlerArgument(node: Parser.SyntaxNode): boolean {
  if (node.type !== "arrow_function" && node.type !== "function_expression") return false;
  if (node.parent?.type !== "arguments") return false;
  const callExpr = node.parent.parent;
  if (!callExpr || callExpr.type !== "call_expression") return false;
  const declarator = callExpr.parent;
  return declarator?.type === "variable_declarator"
    && declarator.childForFieldName("value")?.id === callExpr.id
    && isModuleLevelDeclarator(declarator);
}

export function isObjectLiteralHandlerFunction(node: Parser.SyntaxNode): boolean {
  if (node.type !== "arrow_function" && node.type !== "function_expression") return false;
  if (node.parent?.type !== "pair") return false;

  const key = node.parent.childForFieldName("key");
  if (!key || !isHandlerPropertyName(key)) return false;

  const objectNode = node.parent.parent;
  const argsNode = objectNode?.parent;
  const callExpr = argsNode?.parent;
  if (objectNode?.type !== "object" || argsNode?.type !== "arguments" || callExpr?.type !== "call_expression") {
    return false;
  }

  return isModuleLevelCallExpression(callExpr);
}

export function createInlineHandlerNode(
  fileNodeId: string,
  handlerNode: Parser.SyntaxNode,
  callKind: "modulecall" | "initializercall" = "modulecall",
): { functionNode: GraphNode; callNodeId: string } | null {
  const argsNode = handlerNode.parent;
  const callExprNode = argsNode?.parent;
  if (!argsNode || !callExprNode) return null;

  const calleeText = callExprNode.childForFieldName("function")?.text ?? "unknown";
  const callParts = analyzeMemberCallExpression(calleeText);
  const expression = callParts?.expression ?? calleeText;

  const routePath = argsNode.namedChildren
    .find((c) => c.type === "string")
    ?.text.replace(/^["']|["']$/g, "");

  const argIndex = argsNode.namedChildren.indexOf(handlerNode);
  const syntheticName = routePath
    ? `<${expression}:${routePath}:arg${argIndex}>`
    : `<${expression}:arg${argIndex}>`;

  const row = callExprNode.startPosition.row + 1;
  const col = callExprNode.startPosition.column;
  const callNodeId = `${fileNodeId}:${callKind}:${row}:${col}:${expression}`;

  return {
    functionNode: {
      id: `${fileNodeId}:function:${handlerNode.startPosition.row + 1}:${syntheticName}`,
      label: "Function",
      properties: {
        name: syntheticName,
        kind: handlerNode.type,
        methodKind: null,
        line: handlerNode.startPosition.row + 1,
        endLine: handlerNode.endPosition.row + 1,
        className: null,
        isExported: false,
        isAsync: handlerNode.children.some((c) => c.type === "async"),
        isAbstract: false,
        visibility: "public",
        parameters: extractFunctionParameters(handlerNode),
        returnType: extractReturnType(handlerNode),
      },
    },
    callNodeId,
  };
}

export function createObjectLiteralHandlerNode(
  fileNodeId: string,
  handlerNode: Parser.SyntaxNode,
): { functionNode: GraphNode; callNodeId: string } | null {
  const pairNode = handlerNode.parent;
  const objectNode = pairNode?.parent;
  const argsNode = objectNode?.parent;
  const callExprNode = argsNode?.parent;
  if (!pairNode || !objectNode || !argsNode || !callExprNode) return null;

  const key = pairNode.childForFieldName("key");
  const propertyName = key ? normalizePropertyName(key) : "handler";
  const calleeText = callExprNode.childForFieldName("function")?.text ?? "unknown";
  const callParts = analyzeMemberCallExpression(calleeText);
  const expression = callParts?.expression ?? calleeText;
  const routePath = extractRoutePathFromObject(objectNode)
    ?? argsNode.namedChildren.find((c) => c.type === "string")?.text.replace(/^["']|["']$/g, "");
  const syntheticName = routePath
    ? `<${expression}:${routePath}:${propertyName}>`
    : `<${expression}:${propertyName}>`;
  const row = callExprNode.startPosition.row + 1;
  const col = callExprNode.startPosition.column;
  const callNodeId = `${fileNodeId}:modulecall:${row}:${col}:${expression}`;

  return {
    functionNode: {
      id: `${fileNodeId}:function:${handlerNode.startPosition.row + 1}:${syntheticName}`,
      label: "Function",
      properties: {
        name: syntheticName,
        kind: handlerNode.type,
        methodKind: null,
        line: handlerNode.startPosition.row + 1,
        endLine: handlerNode.endPosition.row + 1,
        className: null,
        isExported: false,
        isAsync: handlerNode.children.some((c) => c.type === "async"),
        isAbstract: false,
        visibility: "public",
        parameters: extractFunctionParameters(handlerNode),
        returnType: extractReturnType(handlerNode),
      },
    },
    callNodeId,
  };
}

function isModuleLevelCallExpression(callExpr: Parser.SyntaxNode): boolean {
  const parent = callExpr.parent;
  if (parent?.type === "expression_statement") {
    return parent.parent?.type === "program";
  }
  if (parent?.type === "await_expression") {
    return parent.parent?.type === "expression_statement"
      && parent.parent.parent?.type === "program";
  }
  return false;
}

function isHandlerPropertyName(node: Parser.SyntaxNode): boolean {
  return [
    "handler",
    "preHandler",
    "preValidation",
    "preParsing",
    "preSerialization",
    "onRequest",
    "onResponse",
    "onSend",
    "onTimeout",
    "onError",
  ].includes(normalizePropertyName(node));
}

function extractRoutePathFromObject(objectNode: Parser.SyntaxNode): string | null {
  for (const child of objectNode.namedChildren) {
    if (child.type !== "pair") continue;
    const key = child.childForFieldName("key");
    const value = child.childForFieldName("value");
    if (!key || value?.type !== "string") continue;
    if (normalizePropertyName(key) === "url" || normalizePropertyName(key) === "path") {
      return value.text.replace(/^["'`]|["'`]$/g, "");
    }
  }
  return null;
}

function normalizePropertyName(node: Parser.SyntaxNode): string {
  return node.type === "string" ? node.text.replace(/^["'`]|["'`]$/g, "") : node.text;
}

// Literal-ish arguments of a call or decorator as a JSON array: string contents,
// numbers, identifiers and member expressions; anything else is left out.
export function extractCallArgs(callExpr: Parser.SyntaxNode): string {
  const argsNode = callExpr.childForFieldName("arguments");
  if (!argsNode) return "[]";

  const args = argsNode.namedChildren
    .map((arg) => {
      if (arg.type === "string") return arg.text.replace(/^["'`]|["'`]$/g, "");
      if (arg.type === "number") return arg.text;
      if (arg.type === "identifier" || arg.type === "type_identifier") return arg.text;
      if (arg.type === "member_expression") return arg.text;
      return null;
    })
    .filter((v): v is string => v !== null);

  return JSON.stringify(args);
}

export function createModuleLevelCallNodes(fileNodeId: string, programNode: Parser.SyntaxNode): GraphNode[] {
  const calls: GraphNode[] = [];

  for (const stmt of programNode.namedChildren) {
    if (stmt.type !== "expression_statement") continue;

    let expr = stmt.namedChildren[0];
    if (!expr) continue;

    if (expr.type === "await_expression") {
      expr = expr.namedChildren[0];
    }

    if (!expr) continue;

    if (expr.type === "call_expression") {
      const parts = analyzeMemberCallExpression(expr.childForFieldName("function")?.text);
      if (!parts) continue;

      calls.push({
        id: `${fileNodeId}:modulecall:${expr.startPosition.row + 1}:${expr.startPosition.column}:${parts.expression}`,
        label: "Call",
        properties: {
          name: parts.expression,
          expression: parts.expression,
          callee: parts.callee,
          receiver: parts.receiver,
          line: expr.startPosition.row + 1,
          columnNumber: expr.startPosition.column,
          args: extractCallArgs(expr),
        },
      });
    } else if (expr.type === "new_expression") {
      const parts = analyzeMemberCallExpression(expr.childForFieldName("constructor")?.text);
      if (!parts) continue;

      const expression = `new ${parts.expression}`;
      calls.push({
        id: `${fileNodeId}:modulecall:${expr.startPosition.row + 1}:${expr.startPosition.column}:${expression}`,
        label: "Call",
        properties: {
          name: expression,
          expression,
          callee: parts.callee,
          receiver: parts.receiver,
          line: expr.startPosition.row + 1,
          columnNumber: expr.startPosition.column,
          args: extractCallArgs(expr),
        },
      });
    }
  }

  return calls;
}

export function createInitializerCallNode(fileNodeId: string, valueNode: Parser.SyntaxNode): GraphNode | null {
  if (valueNode.type === "call_expression") {
    const parts = analyzeMemberCallExpression(valueNode.childForFieldName("function")?.text);
    if (!parts) return null;

    return {
      id: `${fileNodeId}:initializercall:${valueNode.startPosition.row + 1}:${valueNode.startPosition.column}:${parts.expression}`,
      label: "Call",
      properties: {
        name: parts.expression,
        expression: parts.expression,
        callee: parts.callee,
        receiver: parts.receiver,
        line: valueNode.startPosition.row + 1,
        columnNumber: valueNode.startPosition.column,
        args: extractCallArgs(valueNode),
      },
    };
  }

  if (valueNode.type === "new_expression") {
    const parts = analyzeMemberCallExpression(valueNode.childForFieldName("constructor")?.text);
    if (!parts) return null;

    const expression = `new ${parts.expression}`;
    return {
      id: `${fileNodeId}:initializercall:${valueNode.startPosition.row + 1}:${valueNode.startPosition.column}:${expression}`,
      label: "Call",
      properties: {
        name: expression,
        expression,
        callee: parts.callee,
        receiver: parts.receiver,
        line: valueNode.startPosition.row + 1,
        columnNumber: valueNode.startPosition.column,
        args: extractCallArgs(valueNode),
      },
    };
  }

  return null;
}

export function createCallNodes(functionNodeId: string, node: Parser.SyntaxNode): GraphNode[] {
  const calls: GraphNode[] = [];

  walkScoped(node, (child) => {
    if (child.type === "call_expression") {
      const parts = analyzeMemberCallExpression(child.childForFieldName("function")?.text);
      if (!parts) return;

      calls.push({
        id: `${functionNodeId}:call:${child.startPosition.row + 1}:${child.startPosition.column}:${parts.expression}`,
        label: "Call",
        properties: {
          name: parts.expression,
          expression: parts.expression,
          callee: parts.callee,
          receiver: parts.receiver,
          line: child.startPosition.row + 1,
          columnNumber: child.startPosition.column,
          args: extractCallArgs(child),
        },
      });
    } else if (child.type === "new_expression") {
      const parts = analyzeMemberCallExpression(child.childForFieldName("constructor")?.text);
      if (!parts) return;

      const expression = `new ${parts.expression}`;
      calls.push({
        id: `${functionNodeId}:call:${child.startPosition.row + 1}:${child.startPosition.column}:${expression}`,
        label: "Call",
        properties: {
          name: expression,
          expression,
          callee: parts.callee,
          receiver: parts.receiver,
          line: child.startPosition.row + 1,
          columnNumber: child.startPosition.column,
          args: extractCallArgs(child),
        },
      });
    }
  }, ownsCalls);

  return calls;
}

// Functions that get a Function node of their own keep their calls. Anonymous
// callbacks such as forEach(el => …) or it('…', () => …) do not, so their calls
// belong to the enclosing function.
function ownsCalls(node: Parser.SyntaxNode): boolean {
  if (isClassNode(node) || isVariableClassValue(node)) return true;
  if (!isFunctionNode(node)) return false;
  if (node.type === "method_definition" || node.type === "abstract_method_signature") {
    return node.parent?.type === "class_body";
  }
  if (extractName(node) !== null) return true;

  const declarator = node.parent;
  if (
    isVariableFunctionValue(node)
    && declarator?.type === "variable_declarator"
    && declarator.childForFieldName("name")?.type === "identifier"
  ) {
    return true;
  }

  return isInlineHandlerArgument(node) || isObjectLiteralHandlerFunction(node) || isInitializerHandlerArgument(node);
}
