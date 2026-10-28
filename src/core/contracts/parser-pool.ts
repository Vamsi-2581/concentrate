import type { ParsedSourceFile } from "../graph/model.js";
import type { SupportedLanguage } from "../scan/language.js";

// Parses files off the main thread. A scan starts one when many files need
// parsing and closes it when parsing is done.
export interface IParserPool {
  parse(language: SupportedLanguage, rootPath: string, filePath: string): Promise<ParsedSourceFile>;
  close(): Promise<void>;
}
