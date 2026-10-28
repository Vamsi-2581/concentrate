import type { ScanReport } from "../scan/report.js";
import type { IGraphContributor } from "./graph-contributor.js";

export interface ISemanticContributor {
  contribute(
    graph: IGraphContributor,
    rootPath: string,
    report: ScanReport,
    // Every file the scan discovered (absolute paths, include/exclude and
    // .gitignore applied), source or not.
    files: readonly string[],
  ): Promise<void> | void;
}
