import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type {
  AuditLog,
  Finding,
  FixProposal,
  PullRequestRecord,
  Repository,
  ScanJob,
  SecurityMemory,
  VerificationResult
} from "@autocyber/core";
import type { NormalizedFinding, ProjectProfile } from "@autocyber/scanner";
import {
  auditLogs,
  findings,
  fixProposals,
  pullRequests,
  repositories,
  scanJobs,
  securityMemories,
  verificationResults
} from "../db/schema";

type FindingSummary = ScanJob["summary"];
type RepositoryInput = Pick<Repository, "projectId" | "provider" | "owner" | "name" | "defaultBranch" | "url">;
type ScanJobInput = Pick<ScanJob, "repositoryId" | "source" | "branch" | "commitSha">;

const defaultTeamId = "team_dev";
const actor = "autocyber";
const emptySummary: FindingSummary = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };

export interface PersistenceSnapshot {
  repositories: Repository[];
  scanJobs: ScanJob[];
  findings: Finding[];
  fixProposals: FixProposal[];
  verificationResults: VerificationResult[];
  pullRequests: PullRequestRecord[];
  securityMemories: SecurityMemory[];
  auditLogs: AuditLog[];
}

export interface PersistenceStore {
  upsertRepository(input: RepositoryInput): Promise<Repository>;
  createScanJob(input: ScanJobInput): Promise<ScanJob>;
  completeScanJob(scanJobId: string, summary: FindingSummary): Promise<void>;
  failScanJob(scanJobId: string): Promise<void>;
  saveFindings(input: NormalizedFinding[]): Promise<Finding[]>;
  saveFixProposal(input: FixProposal): Promise<void>;
  saveVerificationResult(input: VerificationResult): Promise<void>;
  savePullRequest(input: PullRequestRecord): Promise<void>;
  upsertRepoProfileMemory(repositoryId: string, profile: ProjectProfile): Promise<void>;
  recordFixDecisionMemory(repositoryId: string, proposal: FixProposal, decision: "accepted_fix" | "rejected_fix"): Promise<void>;
  writeAuditLog(action: string, targetType: string, targetId: string): Promise<void>;
  snapshot(): PersistenceSnapshot;
}

export function createDevPersistenceStore(): PersistenceStore {
  const state: PersistenceSnapshot = {
    repositories: [],
    scanJobs: [],
    findings: [],
    fixProposals: [],
    verificationResults: [],
    pullRequests: [],
    securityMemories: [],
    auditLogs: []
  };

  return {
    async upsertRepository(input) {
      const existing = state.repositories.find(
        (repository) => repository.provider === input.provider && repository.owner === input.owner && repository.name === input.name
      );
      const now = isoNow();

      if (existing) {
        existing.defaultBranch = input.defaultBranch;
        existing.url = input.url;
        existing.updatedAt = now;
        return existing;
      }

      const repository: Repository = {
        id: createId("repo"),
        lastScannedAt: null,
        createdAt: now,
        updatedAt: now,
        ...input
      };
      state.repositories.push(repository);
      await this.writeAuditLog("repo_created", "repository", repository.id);
      return repository;
    },

    async createScanJob(input) {
      const now = isoNow();
      const scanJob: ScanJob = {
        id: createId("scan"),
        status: "running",
        startedAt: now,
        completedAt: null,
        summary: { ...emptySummary },
        ...input
      };
      state.scanJobs.push(scanJob);
      await this.writeAuditLog("scan_started", "scan_job", scanJob.id);
      return scanJob;
    },

    async completeScanJob(scanJobId, summary) {
      const scanJob = state.scanJobs.find((candidate) => candidate.id === scanJobId);
      if (scanJob) {
        scanJob.status = "completed";
        scanJob.completedAt = isoNow();
        scanJob.summary = summary;
        const repository = state.repositories.find((candidate) => candidate.id === scanJob.repositoryId);
        if (repository) repository.lastScannedAt = scanJob.completedAt;
      }
      await this.writeAuditLog("scan_completed", "scan_job", scanJobId);
    },

    async failScanJob(scanJobId) {
      const scanJob = state.scanJobs.find((candidate) => candidate.id === scanJobId);
      if (scanJob) {
        scanJob.status = "failed";
        scanJob.completedAt = isoNow();
      }
      await this.writeAuditLog("scan_failed", "scan_job", scanJobId);
    },

    async saveFindings(input) {
      const now = isoNow();
      const records = input.map<Finding>((finding) => ({
        id: finding.id,
        scanJobId: finding.scanJobId,
        repositoryId: finding.repositoryId,
        ruleId: finding.ruleId,
        title: finding.title,
        category: finding.category,
        severity: finding.severity,
        confidence: finding.confidence,
        status: finding.status,
        stackTags: finding.stackTags,
        affectedFile: finding.affectedFile,
        evidence: finding.evidence,
        riskExplanation: finding.riskExplanation,
        remediationSummary: finding.remediationSummary,
        verificationStrategy: finding.verificationStrategy,
        autofixAvailable: finding.autofixAvailable,
        createdAt: now,
        updatedAt: now
      }));
      state.findings.push(...records);
      for (const finding of records) {
        await this.writeAuditLog("finding_created", "finding", finding.id);
      }
      return records;
    },

    async saveFixProposal(input) {
      upsertById(state.fixProposals, input);
      await this.writeAuditLog("fix_proposal_created", "fix_proposal", input.id);
      if (input.status === "approved") {
        await this.recordFixDecisionMemory(input.repositoryId, input, "accepted_fix");
        await this.writeAuditLog("proposal_approved", "fix_proposal", input.id);
      }
      if (input.status === "rejected") {
        await this.recordFixDecisionMemory(input.repositoryId, input, "rejected_fix");
      }
    },

    async saveVerificationResult(input) {
      upsertById(state.verificationResults, input);
      await this.writeAuditLog("local_remediation_completed", "verification_result", input.id);
    },

    async savePullRequest(input) {
      upsertById(state.pullRequests, input);
      await this.writeAuditLog("github_pr_created", "pull_request", input.id);
    },

    async upsertRepoProfileMemory(repositoryId, profile) {
      const memory: SecurityMemory = {
        id: `mem_repo_profile_${repositoryId}`,
        teamId: defaultTeamId,
        repositoryId,
        kind: "repo_profile",
        title: "Repository stack profile",
        content: JSON.stringify(profile),
        source: "scanner_observed",
        confidence: "medium",
        createdAt: isoNow(),
        updatedAt: isoNow()
      };
      upsertById(state.securityMemories, memory);
    },

    async recordFixDecisionMemory(repositoryId, proposal, decision) {
      const memory: SecurityMemory = {
        id: createId("mem"),
        teamId: defaultTeamId,
        repositoryId,
        kind: decision,
        title: proposal.title,
        content: `User ${decision === "accepted_fix" ? "approved" : "rejected"} ${proposal.kind} proposal ${proposal.id}.`,
        source: decision === "accepted_fix" ? "user_approved" : "user_rejected",
        confidence: "high",
        createdAt: isoNow(),
        updatedAt: isoNow()
      };
      state.securityMemories.push(memory);
    },

    async writeAuditLog(action, targetType, targetId) {
      state.auditLogs.push({
        id: createId("audit"),
        teamId: defaultTeamId,
        actor,
        action,
        targetType,
        targetId,
        createdAt: isoNow()
      });
    },

    snapshot() {
      return state;
    }
  };
}

export function getPersistenceStore(): PersistenceStore {
  if (!globalThis.__autocyberPersistenceStore) {
    globalThis.__autocyberPersistenceStore =
      process.env.AUTOCYBER_PERSISTENCE === "database" && (process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL)
        ? createDatabasePersistenceStore(process.env.DATABASE_URL ?? process.env.SUPABASE_DATABASE_URL!)
        : createDevPersistenceStore();
  }

  return globalThis.__autocyberPersistenceStore;
}

function createDatabasePersistenceStore(connectionString: string): PersistenceStore {
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);
  const devStore = createDevPersistenceStore();

  async function persistNewSideEffects(before: { securityMemoryCount: number; auditLogCount: number }): Promise<void> {
    const snapshot = devStore.snapshot();
    const newMemories = snapshot.securityMemories.slice(before.securityMemoryCount);
    const newAuditLogs = snapshot.auditLogs.slice(before.auditLogCount);

    if (newMemories.length) {
      await db.insert(securityMemories).values(newMemories.map(toMemoryRow)).onConflictDoNothing();
    }

    if (newAuditLogs.length) {
      await db.insert(auditLogs).values(newAuditLogs.map(toAuditRow)).onConflictDoNothing();
    }
  }

  return {
    ...devStore,
    async upsertRepository(input) {
      const before = getSideEffectCounts(devStore.snapshot());
      const repository = await devStore.upsertRepository(input);
      await db.insert(repositories).values(toRepositoryRow(repository)).onConflictDoNothing();
      await persistNewSideEffects(before);
      return repository;
    },
    async createScanJob(input) {
      const before = getSideEffectCounts(devStore.snapshot());
      const scanJob = await devStore.createScanJob(input);
      await db.insert(scanJobs).values(toScanJobRow(scanJob)).onConflictDoNothing();
      await persistNewSideEffects(before);
      return scanJob;
    },
    async completeScanJob(scanJobId, summary) {
      const before = getSideEffectCounts(devStore.snapshot());
      await devStore.completeScanJob(scanJobId, summary);
      const scanJob = devStore.snapshot().scanJobs.find((candidate) => candidate.id === scanJobId);
      if (scanJob) {
        await db
          .update(scanJobs)
          .set({
            status: scanJob.status,
            completedAt: scanJob.completedAt ? new Date(scanJob.completedAt) : null,
            summary: scanJob.summary
          })
          .where(eq(scanJobs.id, scanJobId));
        await db
          .update(repositories)
          .set({
            lastScannedAt: scanJob.completedAt ? new Date(scanJob.completedAt) : null,
            updatedAt: new Date(isoNow())
          })
          .where(eq(repositories.id, scanJob.repositoryId));
      }
      await persistNewSideEffects(before);
    },
    async failScanJob(scanJobId) {
      const before = getSideEffectCounts(devStore.snapshot());
      await devStore.failScanJob(scanJobId);
      const scanJob = devStore.snapshot().scanJobs.find((candidate) => candidate.id === scanJobId);
      if (scanJob) {
        await db
          .update(scanJobs)
          .set({
            status: scanJob.status,
            completedAt: scanJob.completedAt ? new Date(scanJob.completedAt) : null
          })
          .where(eq(scanJobs.id, scanJobId));
      }
      await persistNewSideEffects(before);
    },
    async saveFindings(input) {
      const before = getSideEffectCounts(devStore.snapshot());
      const records = await devStore.saveFindings(input);
      if (records.length) {
        await db.insert(findings).values(records.map(toFindingRow) as never).onConflictDoNothing();
      }
      await persistNewSideEffects(before);
      return records;
    },
    async saveFixProposal(input) {
      const before = getSideEffectCounts(devStore.snapshot());
      await devStore.saveFixProposal(input);
      const row = toFixProposalRow(input);
      await db
        .insert(fixProposals)
        .values(row as never)
        .onConflictDoUpdate({
          target: fixProposals.id,
          set: row as never
        });
      await persistNewSideEffects(before);
    },
    async saveVerificationResult(input) {
      const before = getSideEffectCounts(devStore.snapshot());
      await devStore.saveVerificationResult(input);
      await db.insert(verificationResults).values(toVerificationRow(input) as never).onConflictDoNothing();
      await persistNewSideEffects(before);
    },
    async savePullRequest(input) {
      const before = getSideEffectCounts(devStore.snapshot());
      await devStore.savePullRequest(input);
      await db.insert(pullRequests).values(toPullRequestRow(input) as never).onConflictDoNothing();
      await persistNewSideEffects(before);
    },
    async upsertRepoProfileMemory(repositoryId, profile) {
      const before = getSideEffectCounts(devStore.snapshot());
      await devStore.upsertRepoProfileMemory(repositoryId, profile);
      const memory = devStore.snapshot().securityMemories.find((candidate) => candidate.id === `mem_repo_profile_${repositoryId}`);
      if (memory) await db.insert(securityMemories).values(toMemoryRow(memory)).onConflictDoNothing();
      await persistNewSideEffects(before);
    },
    async writeAuditLog(action, targetType, targetId) {
      const before = getSideEffectCounts(devStore.snapshot());
      await devStore.writeAuditLog(action, targetType, targetId);
      await persistNewSideEffects(before);
    }
  };
}

function getSideEffectCounts(snapshot: PersistenceSnapshot): { securityMemoryCount: number; auditLogCount: number } {
  return {
    securityMemoryCount: snapshot.securityMemories.length,
    auditLogCount: snapshot.auditLogs.length
  };
}

function toRepositoryRow(repository: Repository) {
  return {
    ...repository,
    lastScannedAt: repository.lastScannedAt ? new Date(repository.lastScannedAt) : null,
    createdAt: new Date(repository.createdAt),
    updatedAt: new Date(repository.updatedAt)
  };
}

function toScanJobRow(scanJob: ScanJob) {
  return {
    ...scanJob,
    startedAt: scanJob.startedAt ? new Date(scanJob.startedAt) : null,
    completedAt: scanJob.completedAt ? new Date(scanJob.completedAt) : null
  };
}

function toFindingRow(finding: Finding) {
  return {
    ...finding,
    autofixAvailable: String(finding.autofixAvailable),
    createdAt: new Date(finding.createdAt),
    updatedAt: new Date(finding.updatedAt)
  };
}

function toFixProposalRow(proposal: FixProposal) {
  return {
    ...proposal,
    createdAt: new Date(proposal.createdAt),
    updatedAt: new Date(proposal.updatedAt)
  };
}

function toVerificationRow(result: VerificationResult) {
  return {
    ...result,
    createdAt: new Date(result.createdAt),
    updatedAt: new Date(result.updatedAt)
  };
}

function toPullRequestRow(pullRequest: PullRequestRecord) {
  return {
    ...pullRequest,
    createdAt: new Date(pullRequest.createdAt),
    updatedAt: new Date(pullRequest.updatedAt)
  };
}

function toMemoryRow(memory: SecurityMemory) {
  return {
    ...memory,
    teamId: memory.teamId ?? defaultTeamId,
    confidence: memory.confidence ?? "medium",
    createdAt: new Date(memory.createdAt),
    updatedAt: new Date(memory.updatedAt ?? memory.createdAt)
  };
}

function toAuditRow(log: AuditLog) {
  return {
    ...log,
    createdAt: new Date(log.createdAt)
  };
}

function upsertById<T extends { id: string }>(records: T[], input: T): void {
  const index = records.findIndex((record) => record.id === input.id);
  if (index === -1) records.push(input);
  else records[index] = input;
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function isoNow(): string {
  return new Date().toISOString();
}

declare global {
  var __autocyberPersistenceStore: PersistenceStore | undefined;
}
