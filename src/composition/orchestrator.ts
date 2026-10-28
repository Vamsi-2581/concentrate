import { buildCodeGraph as coreBuildCodeGraph, createScanOrchestrator } from "../core/scan/orchestrator.js";
import { coreIntegrationRegistry } from "./default-registry.js";
import type { BuildCodeGraphOptions, BuildCodeGraphResult } from "../core/scan/result.js";
import { parserFingerprint } from "./parser-fingerprint.js";

const deps = {
  getParser: (language: string) => coreIntegrationRegistry.getLanguageParser(language),
  resolvers: coreIntegrationRegistry.languageResolvers,
  contributors: coreIntegrationRegistry.semanticContributors,
  parserFingerprint,
};

export const scanOrchestrator = createScanOrchestrator(deps);

export function buildCodeGraph(
  projectPath: string,
  options: BuildCodeGraphOptions,
): Promise<BuildCodeGraphResult> {
  return coreBuildCodeGraph(projectPath, options, deps);
}
