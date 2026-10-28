import { parentPort } from "node:worker_threads";
import type { SupportedLanguage } from "../core/scan/language.js";
import { coreIntegrationRegistry } from "./default-registry.js";

// Worker thread of the parser pool (parser-pool.ts): parses one file per
// message with the same language parsers a scan uses on the main thread.

export type ParseRequest = { id: number; language: SupportedLanguage; rootPath: string; filePath: string };
export type ParseResponse =
  | { id: number; ok: true; parsed: unknown }
  | { id: number; ok: false; message: string };

parentPort!.on("message", async ({ id, language, rootPath, filePath }: ParseRequest) => {
  let response: ParseResponse;
  try {
    const parsed = await coreIntegrationRegistry.getLanguageParser(language).parse(rootPath, filePath);
    response = { id, ok: true, parsed };
  } catch (error) {
    response = { id, ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  parentPort!.postMessage(response);
});
