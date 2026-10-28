import { runWatchAdapter, type WatchAdapterOptions } from "../adapters/cli/index.js";

type WatchOptions = WatchAdapterOptions;

export async function watchCommand(projectPath: string, options: WatchOptions): Promise<void> {
  await runWatchAdapter(projectPath, options);
}
