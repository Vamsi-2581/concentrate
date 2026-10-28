import path from "node:path";
import type { SupportedSourceFile } from "./source-files.js";
import type { SupportedLanguage } from "./language.js";
import { nodeFileSystemReader, type FileSystemReader } from "./fs-reader.js";

export type ScanManifest = {
  version: 1;
  rootPath: string;
  hashAlgorithm: "sha256";
  generatedAt: string;
  files: ScanManifestFile[];
};

export type ScanManifestFile = {
  path: string;
  language: SupportedLanguage;
  sizeBytes: number;
  mtimeMs: number;
  hash: string;
};

export async function createScanManifest(
  rootPath: string,
  files: SupportedSourceFile[],
  reader: FileSystemReader = nodeFileSystemReader,
): Promise<ScanManifest> {
  const entries = await Promise.all(
    files.map((file) => createScanManifestFile(rootPath, file, reader)),
  );

  return {
    version: 1,
    rootPath,
    hashAlgorithm: "sha256",
    generatedAt: new Date().toISOString(),
    files: entries.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

async function createScanManifestFile(
  rootPath: string,
  file: SupportedSourceFile,
  reader: FileSystemReader,
): Promise<ScanManifestFile> {
  const [metadata, content] = await Promise.all([
    reader.stat(file.filePath),
    reader.readFile(file.filePath),
  ]);

  return {
    path: toPosixPath(path.relative(rootPath, file.filePath)),
    language: file.language,
    sizeBytes: metadata.size,
    mtimeMs: metadata.mtimeMs,
    hash: reader.hash(content, "sha256"),
  };
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

