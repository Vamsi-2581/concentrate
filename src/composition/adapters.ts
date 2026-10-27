import type { ILanguageParser } from "../core/contracts/language-parser.js";
import { coreIntegrationRegistry } from "./default-registry.js";

export { scanOrchestrator } from "./orchestrator.js";

export function getParserAdapter(language: string): ILanguageParser {
  return coreIntegrationRegistry.getLanguageParser(language);
}

export function registerParserAdapter(parser: ILanguageParser): void {
  coreIntegrationRegistry.registerLanguageParser(parser);
}

// Registered parsers (language level plus framework plugins), indexed by language name.
export const languageParsers: ReadonlyMap<string, ILanguageParser> = coreIntegrationRegistry.languageParsers;
export const languageResolvers = coreIntegrationRegistry.languageResolvers;
export const semanticContributors = coreIntegrationRegistry.semanticContributors;
