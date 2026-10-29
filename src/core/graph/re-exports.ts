// Re-export Import nodes (`isReExport`) keep only the statement text in
// `specifier`; these read the names back out of it.

export type ReExportName = { imported: string; exported: string };

// `export { a, b as c, type D } from './x'` -> a→a, b→c, D→D.
export function parseReExportNames(specifier: string): ReExportName[] {
  const list = /\{([^}]*)\}/.exec(specifier)?.[1];
  if (!list) return [];
  return list.split(",").flatMap((part) => {
    const match = /^\s*(?:type\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?\s*$/.exec(part);
    return match ? [{ imported: match[1]!, exported: match[2] ?? match[1]! }] : [];
  });
}

// `export * as ns from './x'` -> ns.
export function parseNamespaceReExport(specifier: string): string | null {
  return /\*\s*as\s+([\w$]+)/.exec(specifier)?.[1] ?? null;
}
