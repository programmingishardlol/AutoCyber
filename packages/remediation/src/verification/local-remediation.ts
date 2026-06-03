import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createLocalScanner } from "@autocyber/scanner";
import type { FixProposal } from "@autocyber/core";
import type {
  LocalRemediationExecution,
  OriginalFindingReference,
  RemediationVerificationCheck,
  RemediationVerificationResult
} from "../types";
import { getLocalRemediationBlockReason } from "../validation/proposal-safety";

const ignoredCopyEntries = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage", ".turbo"]);

export interface LocalRemediationInput {
  proposal: FixProposal;
  repositoryPath: string;
  originalFinding?: OriginalFindingReference;
  allowCommandVerification?: boolean;
  now?: string;
}

export interface PatchApplicationResult {
  workingCopyPath: string;
  filesChanged: string[];
}

interface ParsedFilePatch {
  filePath: string;
  hunks: ParsedHunk[];
}

interface ParsedHunk {
  lines: string[];
}

export async function createLocalRemediationExecution(input: LocalRemediationInput): Promise<LocalRemediationExecution> {
  const now = input.now ?? new Date().toISOString();
  const blockReason = getLocalRemediationBlockReason(input.proposal);
  if (blockReason) {
    return sanitizeExecution({
      id: createExecutionId(input.proposal),
      fixProposalId: input.proposal.id,
      repositoryId: input.proposal.repositoryId,
      status: "failed",
      workingCopyPath: null,
      filesChanged: [],
      verificationResult: null,
      error: blockReason,
      createdAt: now,
      updatedAt: now
    });
  }

  return {
    id: createExecutionId(input.proposal),
    fixProposalId: input.proposal.id,
    repositoryId: input.proposal.repositoryId,
    status: "approved",
    workingCopyPath: null,
    filesChanged: [],
    verificationResult: null,
    error: null,
    createdAt: now,
    updatedAt: now
  };
}

export async function runLocalRemediation(input: LocalRemediationInput): Promise<LocalRemediationExecution> {
  const created = await createLocalRemediationExecution(input);
  if (created.status === "failed") return created;

  try {
    const patchResult = await applyApprovedProposalToTempCopy(input);
    const applyingState: LocalRemediationExecution = {
      ...created,
      status: "verifying",
      workingCopyPath: patchResult.workingCopyPath,
      filesChanged: patchResult.filesChanged,
      updatedAt: input.now ?? new Date().toISOString()
    };
    const verificationResult = await runRemediationVerification({
      proposal: input.proposal,
      workingCopyPath: patchResult.workingCopyPath,
      originalFinding: input.originalFinding,
      allowCommandVerification: input.allowCommandVerification
    });

    return sanitizeExecution({
      ...applyingState,
      status: verificationResult.status === "failed" ? "failed" : "verified",
      verificationResult,
      error: verificationResult.status === "failed" ? "Verification failed for the remediated working copy." : null,
      updatedAt: input.now ?? new Date().toISOString()
    });
  } catch (error) {
    return sanitizeExecution({
      ...created,
      status: "failed",
      error: error instanceof Error ? error.message : "Local remediation failed.",
      updatedAt: input.now ?? new Date().toISOString()
    });
  }
}

export async function applyApprovedProposalToTempCopy(input: LocalRemediationInput): Promise<PatchApplicationResult> {
  const blockReason = getLocalRemediationBlockReason(input.proposal);
  if (blockReason) {
    throw new Error(blockReason);
  }

  const workingCopyPath = join(tmpdir(), `autocyber-remediation-${randomUUID()}`);
  await mkdir(workingCopyPath, { recursive: true });
  await cp(input.repositoryPath, workingCopyPath, {
    recursive: true,
    filter: (source) => !ignoredCopyEntries.has(basename(source))
  });

  const parsedPatches = parseUnifiedDiff(input.proposal.diff);
  const expectedFiles = new Set(input.proposal.filesChanged);
  const changedFiles: string[] = [];

  for (const patch of parsedPatches) {
    if (!expectedFiles.has(patch.filePath)) {
      throw new Error(`Patch touches unexpected file: ${patch.filePath}`);
    }
    await applyFilePatch(workingCopyPath, patch);
    changedFiles.push(patch.filePath);
  }

  return {
    workingCopyPath,
    filesChanged: Array.from(new Set(changedFiles))
  };
}

export async function runRemediationVerification(input: {
  proposal: FixProposal;
  workingCopyPath: string;
  originalFinding?: OriginalFindingReference;
  allowCommandVerification?: boolean;
}): Promise<RemediationVerificationResult> {
  const checksRun: RemediationVerificationCheck[] = [];
  const limitations: string[] = [];

  if (input.originalFinding) {
    const scanner = createLocalScanner();
    const result = await scanner.scan({
      repositoryPath: input.workingCopyPath,
      repositoryId: input.proposal.repositoryId,
      scanJobId: `verify_${input.proposal.id}`
    });
    const matchingFinding = result.findings.find(
      (finding) => finding.ruleId === input.originalFinding?.ruleId && finding.affectedFile === input.originalFinding.affectedFile
    );
    checksRun.push({
      name: "scanner-rule",
      status: matchingFinding ? "failed" : "passed",
      outputSummary: matchingFinding
        ? `${input.originalFinding.ruleId} still appears for ${input.originalFinding.affectedFile}.`
        : `${input.originalFinding.ruleId} no longer appears for ${input.originalFinding.affectedFile}.`
    });
  } else {
    checksRun.push({
      name: "scanner-rule",
      status: "skipped",
      outputSummary: "Original scanner rule metadata was not provided."
    });
    limitations.push("Scanner rule rerun was skipped because original finding metadata was not provided.");
  }

  const patternCheck = await runPatternCheck(input);
  checksRun.push(patternCheck);

  if (input.allowCommandVerification) {
    checksRun.push({
      name: "typecheck",
      status: "skipped",
      outputSummary: "Command execution is not implemented in Stage 4A package tests."
    });
    checksRun.push({
      name: "test",
      status: "skipped",
      outputSummary: "Command execution is not implemented in Stage 4A package tests."
    });
    limitations.push("Command verification hook exists, but command execution is not enabled in this implementation.");
  } else {
    checksRun.push({
      name: "typecheck",
      status: "skipped",
      outputSummary: "Typecheck command was not run."
    });
    checksRun.push({
      name: "test",
      status: "skipped",
      outputSummary: "Test command was not run."
    });
    limitations.push("Command verification is disabled by default to avoid executing untrusted repository code.");
  }

  const failed = checksRun.some((check) => check.status === "failed");
  const passed = checksRun.some((check) => check.status === "passed");
  const status = failed ? "failed" : passed ? "passed" : "skipped";

  return sanitizeVerificationResult({
    status,
    checksRun,
    outputSummary: checksRun.map((check) => `${check.name}: ${check.outputSummary}`).join(" "),
    limitations
  });
}

function parseUnifiedDiff(diff: string): ParsedFilePatch[] {
  const lines = diff.split(/\r?\n/);
  const patches: ParsedFilePatch[] = [];
  let current: ParsedFilePatch | null = null;
  let currentHunk: ParsedHunk | null = null;

  for (const line of lines) {
    if (line.startsWith("--- ")) {
      currentHunk = null;
      continue;
    }
    if (line.startsWith("+++ ")) {
      current = { filePath: normalizeDiffPath(line.slice(4).trim()), hunks: [] };
      patches.push(current);
      continue;
    }
    if (line.startsWith("@@")) {
      if (!current) throw new Error("Patch could not be parsed.");
      currentHunk = { lines: [] };
      current.hunks.push(currentHunk);
      continue;
    }
    if (!currentHunk) continue;
    if (line === "\\ No newline at end of file") continue;
    if (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) {
      currentHunk.lines.push(line);
    }
  }

  if (patches.length === 0 || patches.some((patch) => patch.hunks.length === 0)) {
    throw new Error("Patch could not be parsed.");
  }

  return patches;
}

async function applyFilePatch(workingCopyPath: string, patch: ParsedFilePatch): Promise<void> {
  const filePath = join(workingCopyPath, patch.filePath);
  const originalContent = await readFile(filePath, "utf8");
  const trailingNewline = originalContent.endsWith("\n");
  let currentLines = splitContent(originalContent);

  for (const hunk of patch.hunks) {
    const oldSequence = hunk.lines.filter((line) => line.startsWith(" ") || line.startsWith("-")).map((line) => line.slice(1));
    const newSequence = hunk.lines.filter((line) => line.startsWith(" ") || line.startsWith("+")).map((line) => line.slice(1));
    const index = findSequence(currentLines, oldSequence);
    if (index === -1) {
      throw new Error(`Patch could not be applied to ${patch.filePath}.`);
    }
    currentLines = [...currentLines.slice(0, index), ...newSequence, ...currentLines.slice(index + oldSequence.length)];
  }

  await writeFile(filePath, joinContent(currentLines, trailingNewline));
}

async function runPatternCheck(input: { proposal: FixProposal; workingCopyPath: string }): Promise<RemediationVerificationCheck> {
  const parsedPatches = parseUnifiedDiff(input.proposal.diff);
  for (const patch of parsedPatches) {
    const content = await readFile(join(input.workingCopyPath, patch.filePath), "utf8");
    for (const hunk of patch.hunks) {
      const removedLines = hunk.lines.filter((line) => line.startsWith("-")).map((line) => line.slice(1)).filter(Boolean);
      const addedLines = hunk.lines.filter((line) => line.startsWith("+")).map((line) => line.slice(1)).filter(Boolean);
      const removedStillPresent = removedLines.some((line) => content.includes(line));
      const addedMissing = addedLines.some((line) => !content.includes(line));
      if (removedStillPresent || addedMissing) {
        return {
          name: "pattern",
          status: "failed",
          outputSummary: `Expected patch patterns were not fully reflected in ${patch.filePath}.`
        };
      }
    }
  }

  return {
    name: "pattern",
    status: "passed",
    outputSummary: "Removed patterns are absent and added patterns are present in the temporary working copy."
  };
}

function normalizeDiffPath(value: string): string {
  return value.replace(/^a\//, "").replace(/^b\//, "");
}

function splitContent(content: string): string[] {
  const lines = content.split(/\r?\n/);
  return content.endsWith("\n") ? lines.slice(0, -1) : lines;
}

function joinContent(lines: string[], trailingNewline: boolean): string {
  return `${lines.join("\n")}${trailingNewline ? "\n" : ""}`;
}

function findSequence(lines: string[], sequence: string[]): number {
  if (sequence.length === 0) return 0;
  for (let index = 0; index <= lines.length - sequence.length; index += 1) {
    if (sequence.every((line, offset) => lines[index + offset] === line)) {
      return index;
    }
  }
  return -1;
}

function createExecutionId(proposal: FixProposal): string {
  return `rem_${proposal.id.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

function sanitizeExecution(execution: LocalRemediationExecution): LocalRemediationExecution {
  return {
    ...execution,
    error: execution.error ? redactSecrets(execution.error) : null,
    verificationResult: execution.verificationResult ? sanitizeVerificationResult(execution.verificationResult) : null
  };
}

function sanitizeVerificationResult(result: RemediationVerificationResult): RemediationVerificationResult {
  return {
    ...result,
    outputSummary: redactSecrets(result.outputSummary),
    limitations: result.limitations.map(redactSecrets),
    checksRun: result.checksRun.map((check) => ({
      ...check,
      outputSummary: redactSecrets(check.outputSummary)
    }))
  };
}

function redactSecrets(value: string): string {
  return value
    .replace(/(sk-(?:proj-)?)[A-Za-z0-9_-]{12,}/g, "$1[REDACTED]")
    .replace(/(=)\s*["']?[A-Za-z0-9_./+=-]{24,}["']?/g, "$1[REDACTED]");
}
