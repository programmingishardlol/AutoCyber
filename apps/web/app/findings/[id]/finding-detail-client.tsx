"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type { FixProposal, FixProposalStatus } from "@autocyber/core";
import type { GitHubPrRemediationResult, GitHubRepositoryTarget, LocalRemediationExecution } from "@autocyber/remediation";
import { Badge, SeverityBadge, StatusBadge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { getFindingStackDisplay, getFixProposalDisplay, type ProposalFindingContext } from "@/lib/fix-proposal-display";
import { formatFilterLabel, resolveFindingDetail, sortFindingsForDashboard } from "@/lib/findings-dashboard";
import type { ScanErrorResponse, ScanResponse, ScanSource } from "@/lib/scanner-service";
import { formatPercent } from "@/lib/utils";

interface FindingDetailClientProps {
  defaultPath: string;
  findingId: string;
  initialParams: Record<string, string>;
}

export function FindingDetailClient({ defaultPath, findingId, initialParams }: FindingDetailClientProps) {
  const source: ScanSource = initialParams.source === "github" ? "github" : "local";
  const path = initialParams.path ?? defaultPath;
  const repoUrl = initialParams.repoUrl ?? "";
  const [scanState, setScanState] = useState<{
    loading: boolean;
    response: ScanResponse | null;
    error: ScanErrorResponse | null;
  }>({ loading: true, response: null, error: null });
  const [proposalState, setProposalState] = useState<{
    loading: boolean;
    proposal: FixProposal | null;
    error: string | null;
  }>({ loading: false, proposal: null, error: null });
  const [remediationState, setRemediationState] = useState<{
    loading: boolean;
    execution: LocalRemediationExecution | null;
    error: string | null;
  }>({ loading: false, execution: null, error: null });
  const [pullRequestState, setPullRequestState] = useState<{
    loading: boolean;
    result: GitHubPrRemediationResult | null;
    error: string | null;
  }>({ loading: false, result: null, error: null });
  const [githubTarget, setGithubTarget] = useState<GitHubRepositoryTarget>({
    owner: "",
    repo: "",
    defaultBranch: "main",
    tokenMode: "token",
    repoUrl: ""
  });

  useEffect(() => {
    const controller = new AbortController();
    setScanState({ loading: true, response: null, error: null });

    fetch("/api/scans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(source === "github" ? { source, repoUrl } : { source, path }),
      signal: controller.signal
    })
      .then(async (response) => {
        const body = (await response.json()) as ScanResponse | ScanErrorResponse;
        if ("error" in body) {
          setScanState({ loading: false, response: null, error: body });
          return;
        }

        setScanState({ loading: false, response: body, error: null });
      })
      .catch((error: Error) => {
        if (error.name === "AbortError") return;
        setScanState({
          loading: false,
          response: null,
          error: { error: "scan failed", message: "The finding detail page could not load scanner output." }
        });
      });

    return () => controller.abort();
  }, [source, path, repoUrl]);

  const findings = useMemo(() => sortFindingsForDashboard(scanState.response?.findings ?? []), [scanState.response]);
  const finding = resolveFindingDetail(findings, findingId);
  const backQuery = new URLSearchParams({ source, path });
  if (repoUrl) backQuery.set("repoUrl", repoUrl);

  useEffect(() => {
    setProposalState({ loading: false, proposal: null, error: null });
    setRemediationState({ loading: false, execution: null, error: null });
    setPullRequestState({ loading: false, result: null, error: null });
  }, [finding?.id]);

  async function generateProposal() {
    if (!finding) return;
    setProposalState({ loading: true, proposal: null, error: null });

    try {
      const response = await fetch("/api/fix-proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finding })
      });
      const body = (await response.json()) as { proposal?: FixProposal; error?: string; message?: string };

      if (!response.ok || !body.proposal) {
        setProposalState({
          loading: false,
          proposal: null,
          error: body.message ?? "AutoCyber could not generate a fix proposal for this finding."
        });
        return;
      }

      const storedStatus = readStoredProposalStatus(body.proposal.id);
      setProposalState({
        loading: false,
        proposal: storedStatus ? { ...body.proposal, status: storedStatus } : body.proposal,
        error: null
      });
    } catch {
      setProposalState({
        loading: false,
        proposal: null,
        error: "AutoCyber could not reach the fix proposal service."
      });
    }
  }

  function setProposalStatus(status: FixProposalStatus) {
    setProposalState((current) => {
      if (!current.proposal) return current;
      storeProposalStatus(current.proposal.id, status);
      setRemediationState({ loading: false, execution: null, error: null });
      setPullRequestState({ loading: false, result: null, error: null });
      return {
        ...current,
        proposal: {
          ...current.proposal,
          status,
          updatedAt: new Date().toISOString()
        }
      };
    });
  }

  async function runLocalVerification() {
    if (!finding || !proposalState.proposal) return;
    setRemediationState({ loading: true, execution: null, error: null });

    try {
      const response = await fetch("/api/remediations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposal: proposalState.proposal,
          repositoryPath: path,
          originalFinding: {
            ruleId: finding.ruleId,
            affectedFile: finding.affectedFile
          }
        })
      });
      const body = (await response.json()) as { execution?: LocalRemediationExecution; error?: string; message?: string };
      setRemediationState({
        loading: false,
        execution: body.execution ?? null,
        error: response.ok ? null : body.execution?.error ?? body.message ?? "Local remediation failed."
      });
      setPullRequestState({ loading: false, result: null, error: null });
    } catch {
      setRemediationState({
        loading: false,
        execution: null,
        error: "AutoCyber could not reach the local remediation service."
      });
    }
  }

  async function createGitHubPullRequest() {
    if (!proposalState.proposal || !remediationState.execution) return;
    setPullRequestState({ loading: true, result: null, error: null });

    try {
      const response = await fetch("/api/github-prs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposal: proposalState.proposal,
          execution: remediationState.execution,
          target: githubTarget
        })
      });
      const body = (await response.json()) as { pullRequest?: GitHubPrRemediationResult; error?: string; message?: string };
      setPullRequestState({
        loading: false,
        result: body.pullRequest ?? null,
        error: response.ok ? null : body.pullRequest?.error ?? body.message ?? "GitHub PR creation failed."
      });
    } catch {
      setPullRequestState({
        loading: false,
        result: null,
        error: "AutoCyber could not reach the GitHub PR service."
      });
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={finding?.title ?? (scanState.loading ? "Loading finding" : "Finding unavailable")}
        description={
          finding
            ? "A scanner-backed finding detail with affected file, evidence, confidence, and remediation guidance."
            : "The scan result is loading or the selected finding could not be resolved."
        }
      />

      <Link href={`/findings?${backQuery.toString()}`} className="text-sm font-semibold text-slate-700">
        Back to findings
      </Link>

      {scanState.loading ? <LoadingState /> : null}

      {scanState.error ? (
        <section className="rounded-lg border border-red-200 bg-red-50 p-6">
          <h2 className="font-semibold text-red-900">{scanState.error.error}</h2>
          <p className="mt-2 text-sm text-red-700">{scanState.error.message}</p>
        </section>
      ) : null}

      {!scanState.loading && !scanState.error && !finding ? (
        <section className="rounded-lg border border-dashed border-border bg-white p-8 text-center">
          <h2 className="font-semibold text-slate-950">Finding not found</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            The scanner returned results, but none matched this finding id for the current repository path.
          </p>
        </section>
      ) : null}

      {finding ? (
        <div className="grid gap-6 xl:grid-cols-[0.62fr_0.38fr]">
          <section className="space-y-6">
            <div className="rounded-lg border border-border bg-white p-6 shadow-surface">
              <div className="flex flex-wrap gap-2">
                <SeverityBadge severity={finding.severity} />
                <StatusBadge status={finding.status} />
                <Badge>{formatFilterLabel(finding.category)}</Badge>
                {finding.stackTags.map((tag) => (
                  <Badge key={tag} tone="blue">{tag}</Badge>
                ))}
              </div>
              <dl className="mt-6 grid gap-4 sm:grid-cols-3">
                <Metric label="Confidence" value={formatPercent(finding.confidence)} />
                <Metric label="Autofix" value={finding.autofixAvailable ? "Available" : "Manual"} />
                <Metric label="Rule" value={finding.ruleId} />
              </dl>
            </div>

            <StartupStackContext finding={finding} />

            <DetailSection title="What is wrong">
              <p>
                AutoCyber detected <span className="font-medium text-slate-800">{formatFilterLabel(finding.category)}</span> in{" "}
                <span className="font-mono text-slate-800">{finding.affectedFile}</span>.
              </p>
            </DetailSection>

            <DetailSection title="Why it matters">
              <p>{finding.riskExplanation}</p>
            </DetailSection>

            <DetailSection title="Evidence">
              <div className="space-y-4">
                {finding.evidence.map((evidence) => (
                  <div key={`${evidence.filePath}-${evidence.startLine}-${evidence.snippet}`} className="overflow-hidden rounded-md border border-border">
                    <div className="bg-slate-50 px-4 py-2 font-mono text-xs font-medium text-slate-700">
                      {evidence.filePath}:{evidence.startLine}-{evidence.endLine}
                    </div>
                    <pre className="overflow-x-auto bg-slate-950 p-4 text-sm leading-6 text-slate-100">{evidence.snippet}</pre>
                  </div>
                ))}
              </div>
            </DetailSection>
          </section>

          <aside className="space-y-6">
            <DetailSection title="Recommendation">
              <p>{finding.remediationSummary}</p>
            </DetailSection>

            <DetailSection title="Verification">
              <p>{finding.verificationStrategy}</p>
            </DetailSection>

            <section className="rounded-lg border border-border bg-white p-6 shadow-surface">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="font-semibold text-slate-950">Fix proposal</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Generate a human-reviewable remediation plan. In Stage 4A, AutoCyber only applies approved patches to a temporary local working copy and does not modify the original repo or open a PR.
                  </p>
                </div>
                <Badge tone={finding.autofixAvailable ? "green" : "gray"}>
                  {finding.autofixAvailable ? "Template available" : "Manual template"}
                </Badge>
              </div>

              <button
                type="button"
                onClick={generateProposal}
                disabled={proposalState.loading}
                className="mt-4 rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {proposalState.loading ? "Generating..." : proposalState.proposal ? "Regenerate proposal" : "Generate fix proposal"}
              </button>

              {proposalState.error ? <p className="mt-3 text-sm font-medium text-red-700">{proposalState.error}</p> : null}
            </section>
          </aside>
        </div>
      ) : null}

      {finding && proposalState.proposal ? (
        <FixProposalReview
          proposal={proposalState.proposal}
          findingSummary={{
            title: finding.title,
            affectedFile: finding.affectedFile,
            whyItMatters: finding.riskExplanation,
            ruleId: finding.ruleId,
            category: finding.category,
            stackTags: finding.stackTags,
            remediationSummary: finding.remediationSummary,
            verificationStrategy: finding.verificationStrategy
          }}
          remediationState={remediationState}
          pullRequestState={pullRequestState}
          githubTarget={githubTarget}
          onGitHubTargetChange={setGithubTarget}
          onRunLocalVerification={runLocalVerification}
          onCreateGitHubPullRequest={createGitHubPullRequest}
          onStatusChange={setProposalStatus}
          canRunLocalVerification={source === "local" && proposalState.proposal.status === "approved"}
          canCreateGitHubPullRequest={
            proposalState.proposal.status === "approved" &&
            remediationState.execution?.status === "verified" &&
            remediationState.execution.verificationResult?.status === "passed"
          }
        />
      ) : null}
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-white p-6 shadow-surface">
      <h2 className="font-semibold text-slate-950">{title}</h2>
      <div className="mt-3 text-sm leading-6 text-slate-600">{children}</div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-slate-50 p-4">
      <dt className="text-xs font-medium uppercase text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-slate-950">{value}</dd>
    </div>
  );
}

function LoadingState() {
  return (
    <section className="rounded-lg border border-border bg-white p-6 shadow-surface">
      <div className="h-5 w-40 animate-pulse rounded-md bg-slate-200" />
      <div className="mt-4 h-32 animate-pulse rounded-md bg-slate-100" />
    </section>
  );
}

function StartupStackContext({ finding }: { finding: ProposalFindingContext }) {
  const contexts = getFindingStackDisplay(finding);
  if (contexts.length === 0) return null;

  return (
    <section className="rounded-lg border border-border bg-white p-6 shadow-surface">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-semibold text-slate-950">Startup stack context</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            AutoCyber is interpreting this finding against the provider and framework boundaries that are present in the scanned repo.
          </p>
        </div>
        <Badge tone="blue">Stage 5</Badge>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {contexts.map((context) => (
          <div key={context.stack} className="rounded-md border border-border bg-slate-50 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="blue">{context.stack}</Badge>
              <h3 className="text-sm font-semibold text-slate-950">{context.label}</h3>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600">{context.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function FixProposalReview({
  proposal,
  findingSummary,
  remediationState,
  pullRequestState,
  githubTarget,
  canRunLocalVerification,
  canCreateGitHubPullRequest,
  onRunLocalVerification,
  onCreateGitHubPullRequest,
  onGitHubTargetChange,
  onStatusChange
}: {
  proposal: FixProposal;
  findingSummary: ProposalFindingContext & { title: string; whyItMatters: string };
  remediationState: { loading: boolean; execution: LocalRemediationExecution | null; error: string | null };
  pullRequestState: { loading: boolean; result: GitHubPrRemediationResult | null; error: string | null };
  githubTarget: GitHubRepositoryTarget;
  canRunLocalVerification: boolean;
  canCreateGitHubPullRequest: boolean;
  onRunLocalVerification(): void;
  onCreateGitHubPullRequest(): void;
  onGitHubTargetChange(target: GitHubRepositoryTarget): void;
  onStatusChange(status: FixProposalStatus): void;
}) {
  const display = getFixProposalDisplay(proposal, findingSummary);
  const isAdvisory = display.kind === "advisory";
  const canApplyPatch = canRunLocalVerification && !isAdvisory;
  const canOpenPr = canCreateGitHubPullRequest && !isAdvisory;

  return (
    <section className="rounded-lg border border-border bg-white p-6 shadow-surface">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={proposal.status} />
            <Badge tone="blue">Human review required</Badge>
            <Badge tone={display.tone}>{display.label}</Badge>
          </div>
          <h2 className="mt-3 text-xl font-semibold text-slate-950">{proposal.title}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">{proposal.explanation}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => onStatusChange("approved")} className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">
            Approve
          </button>
          <button type="button" onClick={() => onStatusChange("rejected")} className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700">
            Reject
          </button>
        </div>
      </div>

      <div className={`mt-6 rounded-md border p-4 ${isAdvisory ? "border-orange-200 bg-orange-50" : "border-emerald-200 bg-emerald-50"}`}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={display.tone}>{display.kind === "advisory" ? "Manual remediation required" : "Patch ready for review"}</Badge>
          <span className={`text-sm font-semibold ${isAdvisory ? "text-orange-900" : "text-emerald-900"}`}>{display.summary}</span>
        </div>
        {display.whyAutoCyberCannotPatch ? <p className="mt-3 text-sm leading-6 text-orange-800">{display.whyAutoCyberCannotPatch}</p> : null}
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <ReviewBlock title="Original finding summary">
          <p className="font-medium text-slate-800">{findingSummary.title}</p>
          <p className="mt-2 font-mono text-xs text-slate-600">{findingSummary.affectedFile}</p>
          <p className="mt-3">{findingSummary.whyItMatters}</p>
        </ReviewBlock>
        <ReviewBlock title="Proposed change">
          <p>{proposal.proposedPatch}</p>
          <p className="mt-3 text-xs font-medium uppercase text-slate-500">Files changed</p>
          <ul className="mt-2 space-y-1 font-mono text-xs text-slate-700">
            {proposal.filesChanged.map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
        </ReviewBlock>
        {isAdvisory ? (
          <ReviewBlock title="Recommended manual steps">
            <ol className="space-y-2">
              {display.manualSteps.map((step, index) => (
                <li key={step}>
                  <span className="font-semibold text-slate-900">{index + 1}.</span> {step}
                </li>
              ))}
            </ol>
          </ReviewBlock>
        ) : null}
        <ReviewBlock title="Risk of fix">
          <p>{proposal.risk}</p>
        </ReviewBlock>
        <ReviewBlock title="Verification plan">
          <ol className="space-y-2">
            {proposal.verificationPlan.map((step, index) => (
              <li key={step}>
                <span className="font-semibold text-slate-900">{index + 1}.</span> {step}
              </li>
            ))}
          </ol>
        </ReviewBlock>
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold text-slate-950">{display.diffTitle}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">{display.diffDescription}</p>
        <pre className={`mt-3 overflow-x-auto rounded-md p-4 text-sm leading-6 ${isAdvisory ? "border border-orange-200 bg-orange-50 text-orange-900" : "bg-slate-950 text-slate-100"}`}>
          {proposal.diff}
        </pre>
      </div>

      <div className="mt-6 rounded-md border border-border bg-slate-50 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">Local verified remediation</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {isAdvisory
                ? display.actionDisabledReason
                : "Stage 4A applies this patch to a temporary local working copy and reruns verification. It does not modify the original repo and does not create a GitHub PR."}
            </p>
          </div>
          <button
            type="button"
            onClick={onRunLocalVerification}
            disabled={!canApplyPatch || remediationState.loading}
            className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {remediationState.loading ? "Verifying..." : "Run local remediation"}
          </button>
        </div>
        {isAdvisory ? <p className="mt-3 text-sm font-medium text-orange-800">Manual remediation is required before verification or PR creation can run.</p> : null}
        {!canRunLocalVerification && !isAdvisory ? <p className="mt-3 text-sm text-slate-600">Approve the proposal first to enable local remediation.</p> : null}
        {remediationState.error ? <p className="mt-3 text-sm font-medium text-red-700">{remediationState.error}</p> : null}
        {remediationState.execution ? <RemediationResult execution={remediationState.execution} /> : null}
      </div>

      <div className="mt-6 rounded-md border border-border bg-slate-50 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">GitHub pull request</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Stage 4B creates a remediation branch from the default branch, commits only the verified changed files, and opens a PR after local verification passes.
            </p>
          </div>
          <button
            type="button"
            onClick={onCreateGitHubPullRequest}
            disabled={!canOpenPr || pullRequestState.loading || !githubTarget.owner || !githubTarget.repo}
            className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {pullRequestState.loading ? "Creating PR..." : "Create GitHub PR"}
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <LabeledInput
            label="Owner"
            value={githubTarget.owner}
            onChange={(owner) => onGitHubTargetChange({ ...githubTarget, owner, repoUrl: buildRepoUrl(owner, githubTarget.repo) })}
          />
          <LabeledInput
            label="Repository"
            value={githubTarget.repo}
            onChange={(repo) => onGitHubTargetChange({ ...githubTarget, repo, repoUrl: buildRepoUrl(githubTarget.owner, repo) })}
          />
          <LabeledInput
            label="Default branch"
            value={githubTarget.defaultBranch}
            onChange={(defaultBranch) => onGitHubTargetChange({ ...githubTarget, defaultBranch })}
          />
        </div>
        <p className="mt-3 text-sm text-slate-600">
          Requires server-side `GITHUB_TOKEN` with least-privilege contents and pull request permissions. AutoCyber never sends the token to the browser.
        </p>
        {isAdvisory ? (
          <p className="mt-3 text-sm font-medium text-orange-800">Advisory proposals cannot create GitHub PRs until a human supplies an applyable patch and local verification passes.</p>
        ) : null}
        {!canCreateGitHubPullRequest && !isAdvisory ? (
          <p className="mt-3 text-sm text-slate-600">Approve the proposal and complete passing local verification before creating a GitHub PR.</p>
        ) : null}
        {pullRequestState.error ? <p className="mt-3 text-sm font-medium text-red-700">{pullRequestState.error}</p> : null}
        {pullRequestState.result ? <GitHubPullRequestResult result={pullRequestState.result} /> : null}
      </div>
    </section>
  );
}

function ReviewBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-slate-50 p-4">
      <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
      <div className="mt-2 text-sm leading-6 text-slate-600">{children}</div>
    </div>
  );
}

function RemediationResult({ execution }: { execution: LocalRemediationExecution }) {
  return (
    <div className="mt-4 space-y-4 rounded-md border border-border bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={execution.status === "verified" ? "green" : execution.status === "failed" ? "red" : "yellow"}>{execution.status}</Badge>
        <Badge tone="gray">No GitHub PR created</Badge>
      </div>
      <dl className="grid gap-3 md:grid-cols-2">
        <Metric label="Working copy" value={execution.workingCopyPath ?? "Not created"} />
        <Metric label="Files changed" value={execution.filesChanged.length > 0 ? execution.filesChanged.join(", ") : "None"} />
      </dl>
      {execution.verificationResult ? (
        <div>
          <h4 className="text-sm font-semibold text-slate-950">Verification result</h4>
          <p className="mt-2 text-sm text-slate-600">{execution.verificationResult.outputSummary}</p>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            {execution.verificationResult.checksRun.map((check) => (
              <li key={`${check.name}-${check.outputSummary}`}>
                <span className="font-semibold text-slate-900">{check.name}</span>: {check.status} - {check.outputSummary}
              </li>
            ))}
          </ul>
          {execution.verificationResult.limitations.length > 0 ? (
            <div className="mt-3 text-sm text-slate-600">
              <div className="font-semibold text-slate-900">Limitations</div>
              <ul className="mt-1 list-inside list-disc">
                {execution.verificationResult.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      {execution.error ? <p className="text-sm font-medium text-red-700">{execution.error}</p> : null}
    </div>
  );
}

function GitHubPullRequestResult({ result }: { result: GitHubPrRemediationResult }) {
  return (
    <div className="mt-4 space-y-4 rounded-md border border-border bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={result.status === "pr_created" ? "green" : result.status === "failed" ? "red" : "yellow"}>{result.status}</Badge>
        <Badge tone="blue">GitHub</Badge>
      </div>
      <dl className="grid gap-3 md:grid-cols-2">
        <Metric label="Branch" value={result.branchName ?? "Not created"} />
        <Metric label="Files changed" value={result.filesChanged.length > 0 ? result.filesChanged.join(", ") : "None"} />
        <Metric label="Verification" value={result.verificationSummary} />
        <Metric label="Provider" value={result.provider} />
      </dl>
      {result.pullRequestUrl ? (
        <a href={result.pullRequestUrl} className="text-sm font-semibold text-slate-800 underline" target="_blank" rel="noreferrer">
          Open pull request
        </a>
      ) : null}
      {result.error ? <p className="text-sm font-medium text-red-700">{result.error}</p> : null}
    </div>
  );
}

function LabeledInput({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase text-slate-500">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-slate-400"
      />
    </label>
  );
}

function buildRepoUrl(owner: string, repo: string): string {
  return owner && repo ? `https://github.com/${owner}/${repo}` : "";
}

function readStoredProposalStatus(proposalId: string): FixProposalStatus | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(getProposalStatusStorageKey(proposalId));
  return value === "approved" || value === "rejected" || value === "draft" ? value : null;
}

function storeProposalStatus(proposalId: string, status: FixProposalStatus) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getProposalStatusStorageKey(proposalId), status);
}

function getProposalStatusStorageKey(proposalId: string): string {
  return `autocyber:fix-proposal:${proposalId}:status`;
}
