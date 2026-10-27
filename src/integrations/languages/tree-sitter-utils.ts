import type { SyntaxNode } from "./syntax/tree-sitter.js";

export type CallExpressionParts = {
  expression: string;
  callee: string;
  receiver: string | null;
};

export function walk(node: SyntaxNode, visit: (node: SyntaxNode) => void): void {
  visit(node);
  for (const child of node.namedChildren) {
    walk(child, visit);
  }
}

export function walkScoped(
  node: SyntaxNode,
  visit: (node: SyntaxNode) => void,
  shouldSkipChild: (node: SyntaxNode) => boolean,
): void {
  visit(node);

  for (const child of node.namedChildren) {
    if (child.id !== node.id && shouldSkipChild(child)) {
      continue;
    }

    walkScoped(child, visit, shouldSkipChild);
  }
}

export function analyzeMemberCallExpression(expression: string | undefined): CallExpressionParts | null {
  if (!expression) {
    return null;
  }

  const lastDotIndex = expression.lastIndexOf(".");
  if (lastDotIndex === -1) {
    return {
      expression,
      callee: expression,
      receiver: null,
    };
  }

  const rawReceiver = expression.slice(0, lastDotIndex);
  const receiver = rawReceiver.includes("(") ? stripCallsFromReceiver(rawReceiver) : rawReceiver;

  return {
    expression,
    callee: expression.slice(lastDotIndex + 1),
    receiver,
  };
}

function stripCallsFromReceiver(receiver: string): string {
  const parenIndex = receiver.indexOf("(");
  if (parenIndex === -1) return receiver;
  const base = receiver.slice(0, parenIndex);
  const dotIndex = base.indexOf(".");
  return dotIndex === -1 ? base : base.slice(0, dotIndex);
}
