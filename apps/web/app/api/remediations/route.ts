import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { getLocalRemediationBlockReason, runLocalRemediation, type OriginalFindingReference } from "@autocyber/remediation";
import type { FixProposal } from "@autocyber/core";
import { getPersistenceStore } from "../../../lib/persistence/store";

export const runtime = "nodejs";

interface RemediationRequest {
  proposal?: FixProposal;
  repositoryPath?: string;
  originalFinding?: OriginalFindingReference;
}

const allowedLocalRoots = [resolve(process.cwd()), resolve(process.cwd(), "../.."), resolve(process.cwd(), "../../.."), "/tmp", "/private/tmp"];

export async function POST(request: Request) {
  let input: RemediationRequest;

  try {
    input = (await request.json()) as RemediationRequest;
  } catch {
    return NextResponse.json({ error: "invalid remediation input", message: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!input.proposal || typeof input.proposal !== "object" || typeof input.repositoryPath !== "string") {
    return NextResponse.json(
      { error: "invalid remediation input", message: "An approved fix proposal and local repository path are required." },
      { status: 400 }
    );
  }

  const blockReason = getLocalRemediationBlockReason(input.proposal);
  if (blockReason) {
    return NextResponse.json({ error: "automatic remediation blocked", message: blockReason }, { status: 400 });
  }

  const repositoryPath = resolve(input.repositoryPath);
  if (!isAllowedLocalPath(repositoryPath) || !existsSync(repositoryPath)) {
    return NextResponse.json(
      { error: "path not allowed", message: "Local remediation is limited to the workspace, sibling development repositories, or temporary directories." },
      { status: 400 }
    );
  }

  await getPersistenceStore().saveFixProposal(input.proposal);

  const execution = await runLocalRemediation({
    proposal: input.proposal,
    repositoryPath,
    originalFinding: input.originalFinding
  });
  if (execution.verificationResult) {
    await getPersistenceStore().saveVerificationResult({
      id: `verification_${execution.id}`,
      fixProposalId: execution.fixProposalId,
      status: execution.verificationResult.status === "passed" ? "passed" : execution.verificationResult.status === "failed" ? "failed" : "not_started",
      scannerRerunStatus: execution.verificationResult.checksRun.some((check) => check.name === "scanner-rule" && check.status === "passed")
        ? "passed"
        : "not_started",
      testCommand: execution.verificationResult.checksRun.find((check) => check.name === "test")?.outputSummary ?? "Test command was not run.",
      testOutputSummary: execution.verificationResult.outputSummary,
      evidence: execution.verificationResult.checksRun.map((check) => `${check.name}: ${check.outputSummary}`),
      createdAt: execution.createdAt,
      updatedAt: execution.updatedAt
    });
  }

  return NextResponse.json({ execution }, { status: execution.status === "failed" ? 400 : 200 });
}

function isAllowedLocalPath(path: string): boolean {
  return allowedLocalRoots.some((root) => path === root || path.startsWith(`${root}/`));
}
