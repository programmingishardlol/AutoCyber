import { readRepositoryFiles } from "./file-system";
import { initialScannerRules } from "../checks/rules";
import { detectProjectProfile } from "../project-detection/detect-project";
import { scannerRuleIds, type RuleContext, type Scanner, type ScannerInput, type ScannerResult } from "../types";

const defaultMaxFileSizeBytes = 1024 * 1024;

export function createLocalScanner(): Scanner {
  return {
    async scan(input: ScannerInput): Promise<ScannerResult> {
      const repositoryId = input.repositoryId ?? "local_repository";
      const scanJobId = input.scanJobId ?? "local_scan";
      const { files, errors } = await readRepositoryFiles(input.repositoryPath, input.maxFileSizeBytes ?? defaultMaxFileSizeBytes);
      const fileSet = new Set(files.map((file) => file.relativePath));

      const context: RuleContext = {
        repositoryPath: input.repositoryPath,
        repositoryId,
        scanJobId,
        files,
        hasFile(relativePath) {
          return fileSet.has(relativePath);
        }
      };

      return {
        scanner: "local",
        repositoryPath: input.repositoryPath,
        repositoryId,
        scanJobId,
        projectProfile: detectProjectProfile(files),
        filesScanned: files.length,
        rulesRun: [...scannerRuleIds],
        findings: initialScannerRules.flatMap((rule) => rule.run(context)),
        errors
      };
    }
  };
}
