import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type {
  AuditLog,
  Finding,
  FindingLifecycleSummary,
  FixDecisionMemory,
  FixDecisionMemoryContext,
  FixDecisionType,
  FixProposal,
  GitHubInstallation,
  Notification,
  PullRequestRecord,
  Repository,
  ScanJob,
  SecurityMemory,
  VerificationResult,
} from "@autocyber/core";
import type { NormalizedFinding, ProjectProfile } from "@autocyber/scanner";
import {
  auditLogs,
  findings,
  fixDecisionMemories,
  fixProposals,
  githubInstallations,
  notifications,
  pullRequests,
  repositories,
  scanJobs,
  securityMemories,
  verificationResults,
} from "../db/schema";
import {
  createFindingFingerprint,
  emptyFindingLifecycleSummary,
} from "../finding-lifecycle";
import {
  buildFixDecisionMemoryContext,
  getProposalPatchHash,
  getProposalRecommendedFixHash,
  hashDecisionValue,
  sanitizeDecisionNote,
} from "../fix-decision-memory";
import {
  dedupeRepositories,
  sameRepositoryIdentity,
} from "../repository-identity";

type FindingSummary = ScanJob["summary"];
type RepositoryInput = Pick<
  Repository,
  "projectId" | "provider" | "owner" | "name" | "defaultBranch" | "url"
> &
  Partial<
    Pick<
      Repository,
      | "installationId"
      | "isPrivate"
      | "connectionType"
      | "canScan"
      | "canMonitor"
      | "canOpenPr"
      | "permissionsSummary"
    >
  >;
type GitHubInstallationInput = Pick<
  GitHubInstallation,
  | "installationId"
  | "teamId"
  | "userId"
  | "accountLogin"
  | "accountType"
  | "repositorySelection"
  | "repositoryCount"
  | "permissionsSummary"
> &
  Partial<Pick<GitHubInstallation, "status">>;
type ScanJobInput = Pick<
  ScanJob,
  "repositoryId" | "source" | "branch" | "commitSha"
> &
  Partial<Pick<ScanJob, "status" | "webhookDeliveryId" | "pullRequestNumber">>;
type NotificationInput = Pick<
  Notification,
  "repositoryId" | "type" | "severity" | "title" | "message"
> &
  Partial<Pick<Notification, "teamId" | "scanJobId" | "findingId" | "status">>;
export interface FixDecisionMemoryInput {
  repositoryId: string;
  findingFingerprint: string;
  ruleId: string;
  decisionType: FixDecisionType;
  proposal?: FixProposal;
  proposalId?: string | null;
  findingId?: string | null;
  rationale?: string | null;
  patchHash?: string | null;
  recommendedFixHash?: string | null;
  actorUserId?: string | null;
}
export interface FixDecisionMemoryFilter {
  repositoryId: string;
  findingFingerprint?: string | null;
  ruleId?: string | null;
}
export interface FixDecisionMemoryContextInput extends FixDecisionMemoryFilter {
  patchHash?: string | null;
  recommendedFixHash?: string | null;
}
export interface SaveFixProposalOptions {
  decisionRationale?: string | null;
  actorUserId?: string | null;
}

const defaultTeamId = "team_dev";
const actor = "autocyber";
const emptySummary: FindingSummary = {
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  info: 0,
  lifecycle: emptyFindingLifecycleSummary(),
};

export interface PersistenceSnapshot {
  repositories: Repository[];
  githubInstallations: GitHubInstallation[];
  scanJobs: ScanJob[];
  findings: Finding[];
  fixProposals: FixProposal[];
  verificationResults: VerificationResult[];
  pullRequests: PullRequestRecord[];
  notifications: Notification[];
  securityMemories: SecurityMemory[];
  fixDecisionMemories: FixDecisionMemory[];
  auditLogs: AuditLog[];
}

export interface PersistenceStore {
  upsertRepository(input: RepositoryInput): Promise<Repository>;
  upsertGitHubInstallation(
    input: GitHubInstallationInput,
  ): Promise<GitHubInstallation>;
  getGitHubInstallation(
    installationId: string,
  ): Promise<GitHubInstallation | null>;
  listGitHubInstallations(): Promise<GitHubInstallation[]>;
  findGitHubRepository(owner: string, name: string): Promise<Repository | null>;
  getRepository(repositoryId: string): Promise<Repository | null>;
  listRepositories(): Promise<Repository[]>;
  getScanJob(scanJobId: string): Promise<ScanJob | null>;
  listScanJobs(): Promise<ScanJob[]>;
  hasWebhookDelivery(deliveryId: string): Promise<boolean>;
  createScanJob(input: ScanJobInput): Promise<ScanJob>;
  markScanJobRunning(scanJobId: string): Promise<void>;
  completeScanJob(scanJobId: string, summary: FindingSummary): Promise<void>;
  failScanJob(scanJobId: string, error?: string): Promise<void>;
  saveFindings(input: NormalizedFinding[]): Promise<Finding[]>;
  listFindings(): Promise<Finding[]>;
  markFindingFalsePositive(
    findingId: string,
    rationale?: string | null,
  ): Promise<Finding | null>;
  listFalsePositiveFingerprints(repositoryId: string): Promise<Set<string>>;
  saveFixProposal(
    input: FixProposal,
    options?: SaveFixProposalOptions,
  ): Promise<void>;
  listFixProposals(): Promise<FixProposal[]>;
  saveVerificationResult(input: VerificationResult): Promise<void>;
  listVerificationResults(): Promise<VerificationResult[]>;
  savePullRequest(input: PullRequestRecord): Promise<void>;
  createNotification(input: NotificationInput): Promise<Notification>;
  listNotifications(): Promise<Notification[]>;
  markNotificationRead(notificationId: string): Promise<Notification | null>;
  dismissNotification(notificationId: string): Promise<Notification | null>;
  listSecurityMemories(): Promise<SecurityMemory[]>;
  upsertRepoProfileMemory(
    repositoryId: string,
    profile: ProjectProfile,
  ): Promise<void>;
  recordFixDecisionMemory(
    input: FixDecisionMemoryInput,
  ): Promise<FixDecisionMemory>;
  listFixDecisionMemories(
    filter: FixDecisionMemoryFilter,
  ): Promise<FixDecisionMemory[]>;
  getFixDecisionMemoryContext(
    input: FixDecisionMemoryContextInput,
  ): Promise<FixDecisionMemoryContext>;
  writeAuditLog(
    action: string,
    targetType: string,
    targetId: string,
  ): Promise<void>;
  snapshot(): PersistenceSnapshot;
}

export function createDevPersistenceStore(): PersistenceStore {
  const state: PersistenceSnapshot = {
    repositories: [],
    githubInstallations: [],
    scanJobs: [],
    findings: [],
    fixProposals: [],
    verificationResults: [],
    pullRequests: [],
    notifications: [],
    securityMemories: [],
    fixDecisionMemories: [],
    auditLogs: [],
  };

  return {
    async upsertRepository(input) {
      const existing = state.repositories.find((repository) =>
        sameRepositoryIdentity(repository, input),
      );
      const now = isoNow();

      if (existing) {
        const preserveInstalledPrivateState =
          Boolean(existing.installationId) &&
          !input.installationId &&
          input.connectionType === "public_github";
        existing.projectId = input.projectId;
        existing.owner = input.owner;
        existing.name = input.name;
        existing.defaultBranch = input.defaultBranch;
        existing.url = input.url;
        existing.installationId =
          input.installationId ?? existing.installationId;
        existing.isPrivate = preserveInstalledPrivateState
          ? existing.isPrivate
          : (input.isPrivate ?? existing.isPrivate);
        existing.connectionType =
          input.connectionType ?? existing.connectionType;
        existing.canScan = input.canScan ?? existing.canScan;
        existing.canMonitor = input.canMonitor ?? existing.canMonitor;
        existing.canOpenPr = input.canOpenPr ?? existing.canOpenPr;
        existing.permissionsSummary =
          input.permissionsSummary ?? existing.permissionsSummary;
        existing.updatedAt = now;
        normalizeInstalledRepositoryCapabilities(existing);
        return existing;
      }

      const capabilityDefaults = getRepositoryCapabilityDefaults(input);
      const repository: Repository = {
        id: createId("repo"),
        installationId: input.installationId ?? null,
        isPrivate: input.isPrivate ?? false,
        connectionType:
          input.connectionType ?? capabilityDefaults.connectionType,
        canScan: input.canScan ?? capabilityDefaults.canScan,
        canMonitor: input.canMonitor ?? capabilityDefaults.canMonitor,
        canOpenPr: input.canOpenPr ?? capabilityDefaults.canOpenPr,
        permissionsSummary:
          input.permissionsSummary ?? capabilityDefaults.permissionsSummary,
        lastScannedAt: null,
        createdAt: now,
        updatedAt: now,
        ...input,
      };
      state.repositories.push(repository);
      normalizeInstalledRepositoryCapabilities(repository);
      await this.writeAuditLog("repo_created", "repository", repository.id);
      return repository;
    },

    async upsertGitHubInstallation(input) {
      const now = isoNow();
      const existing = state.githubInstallations.find(
        (installation) => installation.installationId === input.installationId,
      );
      if (existing) {
        existing.teamId = input.teamId;
        existing.userId = input.userId;
        existing.accountLogin = input.accountLogin;
        existing.accountType = input.accountType;
        existing.status = input.status ?? existing.status;
        existing.repositorySelection = input.repositorySelection;
        existing.repositoryCount = input.repositoryCount;
        existing.permissionsSummary = input.permissionsSummary;
        existing.updatedAt = now;
        await this.writeAuditLog(
          "github_installation_updated",
          "github_installation",
          existing.installationId,
        );
        return existing;
      }

      const installation: GitHubInstallation = {
        id: createId("ghinst"),
        installationId: input.installationId,
        teamId: input.teamId,
        userId: input.userId,
        accountLogin: input.accountLogin,
        accountType: input.accountType,
        status: input.status ?? "connected",
        repositorySelection: input.repositorySelection,
        repositoryCount: input.repositoryCount,
        permissionsSummary: input.permissionsSummary,
        createdAt: now,
        updatedAt: now,
      };
      state.githubInstallations.push(installation);
      await this.writeAuditLog(
        "github_installation_created",
        "github_installation",
        installation.installationId,
      );
      return installation;
    },

    async getGitHubInstallation(installationId) {
      return (
        state.githubInstallations.find(
          (installation) => installation.installationId === installationId,
        ) ?? null
      );
    },

    async listGitHubInstallations() {
      return [...state.githubInstallations];
    },

    async findGitHubRepository(owner, name) {
      return (
        state.repositories.find(
          (repository) =>
            repository.provider === "github" &&
            repository.owner.toLowerCase() === owner.toLowerCase() &&
            repository.name.toLowerCase() === name.toLowerCase(),
        ) ?? null
      );
    },

    async getRepository(repositoryId) {
      return (
        state.repositories.find(
          (repository) => repository.id === repositoryId,
        ) ?? null
      );
    },

    async listRepositories() {
      return dedupeRepositories(state.repositories);
    },

    async getScanJob(scanJobId) {
      return state.scanJobs.find((scanJob) => scanJob.id === scanJobId) ?? null;
    },

    async listScanJobs() {
      return [...state.scanJobs];
    },

    async hasWebhookDelivery(deliveryId) {
      return state.auditLogs.some(
        (log) =>
          log.action === "webhook_received" &&
          log.targetType === "github_delivery" &&
          log.targetId === deliveryId,
      );
    },

    async createScanJob(input) {
      const now = isoNow();
      const status = input.status ?? "running";
      const scanJob: ScanJob = {
        id: createId("scan"),
        status,
        repositoryId: input.repositoryId,
        source: input.source,
        branch: input.branch,
        commitSha: input.commitSha,
        startedAt: status === "queued" ? null : now,
        completedAt: null,
        summary: { ...emptySummary },
        webhookDeliveryId: input.webhookDeliveryId ?? null,
        pullRequestNumber: input.pullRequestNumber ?? null,
        error: null,
      };
      state.scanJobs.push(scanJob);
      await this.writeAuditLog(
        status === "queued" ? "scan_queued" : "scan_started",
        "scan_job",
        scanJob.id,
      );
      return scanJob;
    },

    async markScanJobRunning(scanJobId) {
      const scanJob = state.scanJobs.find(
        (candidate) => candidate.id === scanJobId,
      );
      if (scanJob) {
        scanJob.status = "running";
        scanJob.startedAt = isoNow();
        scanJob.completedAt = null;
        scanJob.error = null;
      }
      await this.writeAuditLog("scan_running", "scan_job", scanJobId);
    },

    async completeScanJob(scanJobId, summary) {
      const scanJob = state.scanJobs.find(
        (candidate) => candidate.id === scanJobId,
      );
      if (scanJob) {
        scanJob.status = "completed";
        scanJob.completedAt = isoNow();
        scanJob.summary = summary;
        scanJob.error = null;
        const repository = state.repositories.find(
          (candidate) => candidate.id === scanJob.repositoryId,
        );
        if (repository) repository.lastScannedAt = scanJob.completedAt;
      }
      await this.writeAuditLog("scan_completed", "scan_job", scanJobId);
    },

    async failScanJob(
      scanJobId,
      error = "AutoCyber could not complete the monitoring scan.",
    ) {
      const scanJob = state.scanJobs.find(
        (candidate) => candidate.id === scanJobId,
      );
      if (scanJob) {
        scanJob.status = "failed";
        scanJob.completedAt = isoNow();
        scanJob.error = error;
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
        lifecycleStatus: finding.lifecycleStatus ?? "new",
        firstSeenAt: finding.firstSeenAt ?? now,
        lastSeenAt: finding.lastSeenAt ?? now,
        resolvedAt: finding.resolvedAt ?? null,
        occurrenceCount: finding.occurrenceCount ?? 1,
        fingerprint: finding.fingerprint ?? createFindingFingerprint(finding),
        previousFindingId: finding.previousFindingId ?? null,
        memoryStatus: finding.memoryStatus ?? "none",
        stackTags: finding.stackTags,
        affectedFile: finding.affectedFile,
        evidence: finding.evidence,
        riskExplanation: finding.riskExplanation,
        remediationSummary: finding.remediationSummary,
        verificationStrategy: finding.verificationStrategy,
        autofixAvailable: finding.autofixAvailable,
        createdAt: now,
        updatedAt: now,
      }));
      state.findings.push(...records);
      for (const finding of records) {
        await this.writeAuditLog("finding_created", "finding", finding.id);
      }
      return records;
    },

    async listFindings() {
      return [...state.findings];
    },

    async markFindingFalsePositive(findingId, rationale = null) {
      const finding = state.findings.find(
        (candidate) => candidate.id === findingId,
      );
      if (!finding) return null;
      const now = isoNow();
      finding.status = "false_positive";
      finding.memoryStatus = "false_positive_suppressed";
      finding.updatedAt = now;
      const memory: SecurityMemory = {
        id: `mem_false_positive_${finding.repositoryId}_${finding.fingerprint}`,
        teamId: defaultTeamId,
        repositoryId: finding.repositoryId,
        kind: "false_positive",
        title: `False positive: ${finding.title}`,
        content: JSON.stringify({
          fingerprint: finding.fingerprint,
          ruleId: finding.ruleId,
          affectedFile: finding.affectedFile,
        }),
        source: "human",
        confidence: "high",
        createdAt: now,
        updatedAt: now,
      };
      upsertById(state.securityMemories, memory);
      await this.recordFixDecisionMemory({
        repositoryId: finding.repositoryId,
        findingFingerprint: finding.fingerprint,
        ruleId: finding.ruleId,
        decisionType: "false_positive",
        findingId: finding.id,
        rationale,
      });
      await this.writeAuditLog("false_positive_marked", "finding", finding.id);
      return finding;
    },

    async listFalsePositiveFingerprints(repositoryId) {
      const fingerprints = new Set<string>();
      for (const finding of state.findings) {
        if (
          finding.repositoryId === repositoryId &&
          finding.status === "false_positive"
        ) {
          fingerprints.add(finding.fingerprint);
        }
      }
      for (const memory of state.securityMemories) {
        if (
          memory.repositoryId !== repositoryId ||
          memory.kind !== "false_positive"
        )
          continue;
        const fingerprint = readFalsePositiveFingerprint(memory.content);
        if (fingerprint) fingerprints.add(fingerprint);
      }
      for (const memory of state.fixDecisionMemories) {
        if (
          memory.repositoryId === repositoryId &&
          memory.decisionType === "false_positive"
        ) {
          fingerprints.add(memory.findingFingerprint);
        }
      }
      return fingerprints;
    },

    async saveFixProposal(input, options = {}) {
      upsertById(state.fixProposals, input);
      await this.writeAuditLog(
        "fix_proposal_created",
        "fix_proposal",
        input.id,
      );
      if (input.status === "approved") {
        await this.recordFixDecisionMemory({
          repositoryId: input.repositoryId,
          findingFingerprint: input.findingFingerprint ?? input.findingId,
          ruleId: inferProposalRuleId(input),
          decisionType: "fix_accepted",
          proposal: input,
          rationale: options.decisionRationale,
          actorUserId: options.actorUserId,
        });
        await this.writeAuditLog("proposal_approved", "fix_proposal", input.id);
      }
      if (input.status === "rejected") {
        await this.recordFixDecisionMemory({
          repositoryId: input.repositoryId,
          findingFingerprint: input.findingFingerprint ?? input.findingId,
          ruleId: inferProposalRuleId(input),
          decisionType: "fix_rejected",
          proposal: input,
          rationale: options.decisionRationale,
          actorUserId: options.actorUserId,
        });
        await this.writeAuditLog("proposal_rejected", "fix_proposal", input.id);
      }
    },

    async listFixProposals() {
      return [...state.fixProposals];
    },

    async saveVerificationResult(input) {
      upsertById(state.verificationResults, input);
      await this.writeAuditLog(
        "local_remediation_completed",
        "verification_result",
        input.id,
      );
    },

    async listVerificationResults() {
      return [...state.verificationResults];
    },

    async savePullRequest(input) {
      upsertById(state.pullRequests, input);
      await this.writeAuditLog("github_pr_created", "pull_request", input.id);
    },

    async createNotification(input) {
      const now = isoNow();
      const notification: Notification = {
        id: createId("notification"),
        teamId: input.teamId ?? defaultTeamId,
        repositoryId: input.repositoryId,
        scanJobId: input.scanJobId ?? null,
        findingId: input.findingId ?? null,
        type: input.type,
        severity: input.severity,
        title: input.title,
        message: input.message,
        status: input.status ?? "unread",
        createdAt: now,
        updatedAt: now,
      };
      state.notifications.push(notification);
      await this.writeAuditLog(
        "notification_created",
        "notification",
        notification.id,
      );
      return notification;
    },

    async listNotifications() {
      return [...state.notifications].sort((first, second) =>
        second.createdAt.localeCompare(first.createdAt),
      );
    },

    async markNotificationRead(notificationId) {
      const notification = state.notifications.find(
        (candidate) => candidate.id === notificationId,
      );
      if (!notification) return null;
      notification.status = "read";
      notification.updatedAt = isoNow();
      await this.writeAuditLog(
        "notification_read",
        "notification",
        notification.id,
      );
      return notification;
    },

    async dismissNotification(notificationId) {
      const notification = state.notifications.find(
        (candidate) => candidate.id === notificationId,
      );
      if (!notification) return null;
      notification.status = "dismissed";
      notification.updatedAt = isoNow();
      await this.writeAuditLog(
        "notification_dismissed",
        "notification",
        notification.id,
      );
      return notification;
    },

    async listSecurityMemories() {
      return [...state.securityMemories];
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
        updatedAt: isoNow(),
      };
      upsertById(state.securityMemories, memory);
    },

    async recordFixDecisionMemory(input) {
      const now = isoNow();
      const proposal = input.proposal;
      const findingFingerprint =
        input.findingFingerprint ||
        proposal?.findingFingerprint ||
        proposal?.findingId ||
        "unknown";
      const ruleId =
        input.ruleId || (proposal ? inferProposalRuleId(proposal) : "unknown");
      const patchHash =
        input.patchHash ?? (proposal ? getProposalPatchHash(proposal) : null);
      const recommendedFixHash =
        input.recommendedFixHash ??
        (proposal ? getProposalRecommendedFixHash(proposal) : null);
      const memory: FixDecisionMemory = {
        id: createFixDecisionMemoryId({
          repositoryId: input.repositoryId,
          findingFingerprint,
          ruleId,
          decisionType: input.decisionType,
          proposalId: input.proposalId ?? proposal?.id ?? null,
          findingId: input.findingId ?? proposal?.findingId ?? null,
          patchHash,
          recommendedFixHash,
        }),
        teamId: defaultTeamId,
        repositoryId: input.repositoryId,
        findingFingerprint,
        ruleId,
        decisionType: input.decisionType,
        proposalId: input.proposalId ?? proposal?.id ?? null,
        findingId: input.findingId ?? proposal?.findingId ?? null,
        rationale: sanitizeDecisionNote(input.rationale),
        patchHash,
        recommendedFixHash,
        proposalKind: proposal?.kind ?? null,
        actorUserId: input.actorUserId ?? null,
        createdAt: now,
        updatedAt: now,
      };
      upsertById(state.fixDecisionMemories, memory);

      const coarseDecision =
        input.decisionType === "fix_accepted"
          ? "accepted_fix"
          : input.decisionType === "fix_rejected"
            ? "rejected_fix"
            : null;
      if (coarseDecision && proposal) {
        const legacyMemory: SecurityMemory = {
          id: createId("mem"),
          teamId: defaultTeamId,
          repositoryId: input.repositoryId,
          kind: coarseDecision,
          title: proposal.title,
          content: `User ${coarseDecision === "accepted_fix" ? "approved" : "rejected"} ${proposal.kind} proposal ${proposal.id}.`,
          source:
            coarseDecision === "accepted_fix"
              ? "user_approved"
              : "user_rejected",
          confidence: "high",
          createdAt: now,
          updatedAt: now,
        };
        state.securityMemories.push(legacyMemory);
      }
      await this.writeAuditLog(
        "fix_decision_memory_recorded",
        "fix_decision_memory",
        memory.id,
      );
      return memory;
    },

    async listFixDecisionMemories(filter) {
      return state.fixDecisionMemories.filter(
        (memory) =>
          memory.repositoryId === filter.repositoryId &&
          (!filter.findingFingerprint ||
            memory.findingFingerprint === filter.findingFingerprint) &&
          (!filter.ruleId || memory.ruleId === filter.ruleId),
      );
    },

    async getFixDecisionMemoryContext(input) {
      const memories = await this.listFixDecisionMemories(input);
      return buildFixDecisionMemoryContext(
        memories,
        input.patchHash,
        input.recommendedFixHash,
      );
    },

    async writeAuditLog(action, targetType, targetId) {
      state.auditLogs.push({
        id: createId("audit"),
        teamId: defaultTeamId,
        actor,
        action,
        targetType,
        targetId,
        createdAt: isoNow(),
      });
    },

    snapshot() {
      return state;
    },
  };
}

export function getPersistenceStore(): PersistenceStore {
  if (!globalThis.__autocyberPersistenceStore) {
    globalThis.__autocyberPersistenceStore =
      process.env.AUTOCYBER_PERSISTENCE === "database" &&
      (process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL)
        ? createDatabasePersistenceStore(
            process.env.DATABASE_URL ?? process.env.SUPABASE_DATABASE_URL!,
          )
        : createDevPersistenceStore();
  }

  return globalThis.__autocyberPersistenceStore;
}

function createDatabasePersistenceStore(
  connectionString: string,
): PersistenceStore {
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);
  const devStore = createDevPersistenceStore();

  async function persistNewSideEffects(before: {
    securityMemoryCount: number;
    fixDecisionMemoryCount: number;
    auditLogCount: number;
  }): Promise<void> {
    const snapshot = devStore.snapshot();
    const newMemories = snapshot.securityMemories.slice(
      before.securityMemoryCount,
    );
    const newFixDecisionMemories = snapshot.fixDecisionMemories.slice(
      before.fixDecisionMemoryCount,
    );
    const newAuditLogs = snapshot.auditLogs.slice(before.auditLogCount);

    if (newMemories.length) {
      await db
        .insert(securityMemories)
        .values(newMemories.map(toMemoryRow))
        .onConflictDoNothing();
    }

    if (newFixDecisionMemories.length) {
      await db
        .insert(fixDecisionMemories)
        .values(newFixDecisionMemories.map(toFixDecisionMemoryRow))
        .onConflictDoNothing();
    }

    if (newAuditLogs.length) {
      await db
        .insert(auditLogs)
        .values(newAuditLogs.map(toAuditRow))
        .onConflictDoNothing();
    }
  }

  return {
    ...devStore,
    async upsertRepository(input) {
      const before = getSideEffectCounts(devStore.snapshot());
      const localRepository = devStore
        .snapshot()
        .repositories.find((repository) =>
          sameRepositoryIdentity(repository, input),
        );

      if (!localRepository) {
        const existingRows = await db
          .select()
          .from(repositories)
          .where(repositoryIdentityWhere(input))
          .limit(1);

        if (existingRows[0]) {
          const repository = applyRepositoryInput(
            fromRepositoryRow(existingRows[0]),
            input,
          );
          await db
            .update(repositories)
            .set(toRepositoryRow(repository))
            .where(eq(repositories.id, repository.id));
          await devStore.writeAuditLog(
            "repo_updated",
            "repository",
            repository.id,
          );
          await persistNewSideEffects(before);
          return repository;
        }
      }

      const repository = await devStore.upsertRepository(input);
      const row = toRepositoryRow(repository);
      await db.insert(repositories).values(row).onConflictDoUpdate({
        target: repositories.id,
        set: row,
      });
      await persistNewSideEffects(before);
      return repository;
    },
    async upsertGitHubInstallation(input) {
      const before = getSideEffectCounts(devStore.snapshot());
      const local = await devStore.upsertGitHubInstallation(input);
      const row = toGitHubInstallationRow(local);
      await db.insert(githubInstallations).values(row).onConflictDoUpdate({
        target: githubInstallations.installationId,
        set: row,
      });
      await persistNewSideEffects(before);
      return local;
    },
    async getGitHubInstallation(installationId) {
      const local = await devStore.getGitHubInstallation(installationId);
      if (local) return local;

      const rows = await db
        .select()
        .from(githubInstallations)
        .where(eq(githubInstallations.installationId, installationId))
        .limit(1);
      return rows[0] ? fromGitHubInstallationRow(rows[0]) : null;
    },
    async listGitHubInstallations() {
      const local = devStore.snapshot().githubInstallations;
      const rows = await db.select().from(githubInstallations);
      return mergeById(local, rows.map(fromGitHubInstallationRow));
    },
    async findGitHubRepository(owner, name) {
      const local = await devStore.findGitHubRepository(owner, name);
      if (local) return local;

      const rows = await db
        .select()
        .from(repositories)
        .where(
          and(
            eq(repositories.provider, "github"),
            sql`lower(${repositories.owner}) = ${owner.toLowerCase()}`,
            sql`lower(${repositories.name}) = ${name.toLowerCase()}`,
          ),
        )
        .limit(1);

      return rows[0] ? fromRepositoryRow(rows[0]) : null;
    },
    async getRepository(repositoryId) {
      const local = await devStore.getRepository(repositoryId);
      if (local) return local;

      const rows = await db
        .select()
        .from(repositories)
        .where(eq(repositories.id, repositoryId))
        .limit(1);
      return rows[0] ? fromRepositoryRow(rows[0]) : null;
    },
    async listRepositories() {
      const local = devStore.snapshot().repositories;
      const rows = await db.select().from(repositories);
      return dedupeRepositories(mergeById(local, rows.map(fromRepositoryRow)));
    },
    async getScanJob(scanJobId) {
      const local = await devStore.getScanJob(scanJobId);
      if (local) return local;

      const rows = await db
        .select()
        .from(scanJobs)
        .where(eq(scanJobs.id, scanJobId))
        .limit(1);
      return rows[0] ? fromScanJobRow(rows[0]) : null;
    },
    async listScanJobs() {
      const local = devStore.snapshot().scanJobs;
      const rows = await db.select().from(scanJobs);
      return mergeById(local, rows.map(fromScanJobRow));
    },
    async hasWebhookDelivery(deliveryId) {
      if (await devStore.hasWebhookDelivery(deliveryId)) return true;
      const rows = await db
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, "webhook_received"),
            eq(auditLogs.targetType, "github_delivery"),
            eq(auditLogs.targetId, deliveryId),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },
    async createScanJob(input) {
      const before = getSideEffectCounts(devStore.snapshot());
      const scanJob = await devStore.createScanJob(input);
      await db
        .insert(scanJobs)
        .values(toScanJobRow(scanJob))
        .onConflictDoNothing();
      await persistNewSideEffects(before);
      return scanJob;
    },
    async markScanJobRunning(scanJobId) {
      const before = getSideEffectCounts(devStore.snapshot());
      await devStore.markScanJobRunning(scanJobId);
      const scanJob = devStore
        .snapshot()
        .scanJobs.find((candidate) => candidate.id === scanJobId);
      await db
        .update(scanJobs)
        .set({
          status: "running",
          startedAt: scanJob?.startedAt
            ? new Date(scanJob.startedAt)
            : new Date(isoNow()),
          completedAt: null,
          error: null,
        })
        .where(eq(scanJobs.id, scanJobId));
      await persistNewSideEffects(before);
    },
    async completeScanJob(scanJobId, summary) {
      const before = getSideEffectCounts(devStore.snapshot());
      await devStore.completeScanJob(scanJobId, summary);
      const localScanJob = devStore
        .snapshot()
        .scanJobs.find((candidate) => candidate.id === scanJobId);
      const persistedScanJob =
        localScanJob ??
        (
          await db
            .select()
            .from(scanJobs)
            .where(eq(scanJobs.id, scanJobId))
            .limit(1)
        )[0];
      const completedAt = localScanJob?.completedAt ?? isoNow();
      await db
        .update(scanJobs)
        .set({
          status: "completed",
          completedAt: new Date(completedAt),
          summary,
          error: null,
        })
        .where(eq(scanJobs.id, scanJobId));

      if (persistedScanJob) {
        await db
          .update(repositories)
          .set({
            lastScannedAt: new Date(completedAt),
            updatedAt: new Date(isoNow()),
          })
          .where(eq(repositories.id, persistedScanJob.repositoryId));
      }
      await persistNewSideEffects(before);
    },
    async failScanJob(scanJobId, error) {
      const before = getSideEffectCounts(devStore.snapshot());
      await devStore.failScanJob(scanJobId, error);
      const scanJob = devStore
        .snapshot()
        .scanJobs.find((candidate) => candidate.id === scanJobId);
      await db
        .update(scanJobs)
        .set({
          status: "failed",
          completedAt: scanJob?.completedAt
            ? new Date(scanJob.completedAt)
            : new Date(isoNow()),
          error:
            error ??
            scanJob?.error ??
            "AutoCyber could not complete the monitoring scan.",
        })
        .where(eq(scanJobs.id, scanJobId));
      await persistNewSideEffects(before);
    },
    async saveFindings(input) {
      const before = getSideEffectCounts(devStore.snapshot());
      const records = await devStore.saveFindings(input);
      if (records.length) {
        await db
          .insert(findings)
          .values(records.map(toFindingRow) as never)
          .onConflictDoNothing();
      }
      await persistNewSideEffects(before);
      return records;
    },
    async listFindings() {
      const local = devStore.snapshot().findings;
      const rows = await db.select().from(findings);
      return mergeById(local, rows.map(fromFindingRow));
    },
    async markFindingFalsePositive(findingId, rationale = null) {
      const before = getSideEffectCounts(devStore.snapshot());
      let finding = await devStore.markFindingFalsePositive(
        findingId,
        rationale,
      );
      if (!finding) {
        const existing = (
          await db
            .select()
            .from(findings)
            .where(eq(findings.id, findingId))
            .limit(1)
        )[0];
        if (!existing) return null;
        finding = {
          ...fromFindingRow(existing),
          status: "false_positive",
          memoryStatus: "false_positive_suppressed",
          updatedAt: isoNow(),
        };
        await devStore.saveFindings([]);
        const memory: SecurityMemory = {
          id: `mem_false_positive_${finding.repositoryId}_${finding.fingerprint}`,
          teamId: defaultTeamId,
          repositoryId: finding.repositoryId,
          kind: "false_positive",
          title: `False positive: ${finding.title}`,
          content: JSON.stringify({
            fingerprint: finding.fingerprint,
            ruleId: finding.ruleId,
            affectedFile: finding.affectedFile,
          }),
          source: "human",
          confidence: "high",
          createdAt: finding.updatedAt,
          updatedAt: finding.updatedAt,
        };
        await db
          .insert(securityMemories)
          .values(toMemoryRow(memory))
          .onConflictDoNothing();
        await devStore.recordFixDecisionMemory({
          repositoryId: finding.repositoryId,
          findingFingerprint: finding.fingerprint,
          ruleId: finding.ruleId,
          decisionType: "false_positive",
          findingId: finding.id,
          rationale,
        });
        await devStore.writeAuditLog(
          "false_positive_marked",
          "finding",
          finding.id,
        );
      }
      await db
        .update(findings)
        .set({
          status: "false_positive",
          memoryStatus: "false_positive_suppressed",
          updatedAt: new Date(finding.updatedAt),
        })
        .where(eq(findings.id, findingId));
      await persistNewSideEffects(before);
      return finding;
    },
    async listFalsePositiveFingerprints(repositoryId) {
      const fingerprints =
        await devStore.listFalsePositiveFingerprints(repositoryId);
      const [findingRows, memoryRows] = await Promise.all([
        db
          .select()
          .from(findings)
          .where(
            and(
              eq(findings.repositoryId, repositoryId),
              eq(findings.status, "false_positive"),
            ),
          ),
        db
          .select()
          .from(securityMemories)
          .where(
            and(
              eq(securityMemories.repositoryId, repositoryId),
              eq(securityMemories.kind, "false_positive"),
            ),
          ),
      ]);
      const decisionRows = await db
        .select()
        .from(fixDecisionMemories)
        .where(
          and(
            eq(fixDecisionMemories.repositoryId, repositoryId),
            eq(fixDecisionMemories.decisionType, "false_positive"),
          ),
        );
      for (const finding of findingRows) {
        if (finding.fingerprint) fingerprints.add(finding.fingerprint);
      }
      for (const memory of memoryRows) {
        const fingerprint = readFalsePositiveFingerprint(memory.content);
        if (fingerprint) fingerprints.add(fingerprint);
      }
      for (const memory of decisionRows) {
        fingerprints.add(memory.findingFingerprint);
      }
      return fingerprints;
    },
    async saveFixProposal(input, options = {}) {
      const before = getSideEffectCounts(devStore.snapshot());
      await devStore.saveFixProposal(input, options);
      const row = toFixProposalRow(input);
      await db
        .insert(fixProposals)
        .values(row as never)
        .onConflictDoUpdate({
          target: fixProposals.id,
          set: row as never,
        });
      await persistNewSideEffects(before);
    },
    async listFixProposals() {
      const local = devStore.snapshot().fixProposals;
      const rows = await db.select().from(fixProposals);
      return mergeById(local, rows.map(fromFixProposalRow));
    },
    async recordFixDecisionMemory(input) {
      const before = getSideEffectCounts(devStore.snapshot());
      const memory = await devStore.recordFixDecisionMemory(input);
      await db
        .insert(fixDecisionMemories)
        .values(toFixDecisionMemoryRow(memory))
        .onConflictDoUpdate({
          target: fixDecisionMemories.id,
          set: toFixDecisionMemoryRow(memory),
        });
      await persistNewSideEffects(before);
      return memory;
    },
    async listFixDecisionMemories(filter) {
      const local = devStore.snapshot().fixDecisionMemories;
      const conditions = [
        eq(fixDecisionMemories.repositoryId, filter.repositoryId),
      ];
      if (filter.findingFingerprint)
        conditions.push(
          eq(fixDecisionMemories.findingFingerprint, filter.findingFingerprint),
        );
      if (filter.ruleId)
        conditions.push(eq(fixDecisionMemories.ruleId, filter.ruleId));
      const rows = await db
        .select()
        .from(fixDecisionMemories)
        .where(and(...conditions));
      return mergeById(local, rows.map(fromFixDecisionMemoryRow)).filter(
        (memory) =>
          memory.repositoryId === filter.repositoryId &&
          (!filter.findingFingerprint ||
            memory.findingFingerprint === filter.findingFingerprint) &&
          (!filter.ruleId || memory.ruleId === filter.ruleId),
      );
    },
    async getFixDecisionMemoryContext(input) {
      const memories = await this.listFixDecisionMemories(input);
      return buildFixDecisionMemoryContext(
        memories,
        input.patchHash,
        input.recommendedFixHash,
      );
    },
    async saveVerificationResult(input) {
      const before = getSideEffectCounts(devStore.snapshot());
      await devStore.saveVerificationResult(input);
      await db
        .insert(verificationResults)
        .values(toVerificationRow(input) as never)
        .onConflictDoNothing();
      await persistNewSideEffects(before);
    },
    async listVerificationResults() {
      const local = devStore.snapshot().verificationResults;
      const rows = await db.select().from(verificationResults);
      return mergeById(local, rows.map(fromVerificationRow));
    },
    async savePullRequest(input) {
      const before = getSideEffectCounts(devStore.snapshot());
      await devStore.savePullRequest(input);
      await db
        .insert(pullRequests)
        .values(toPullRequestRow(input) as never)
        .onConflictDoNothing();
      await persistNewSideEffects(before);
    },
    async createNotification(input) {
      const before = getSideEffectCounts(devStore.snapshot());
      const notification = await devStore.createNotification(input);
      await db
        .insert(notifications)
        .values(toNotificationRow(notification))
        .onConflictDoNothing();
      await persistNewSideEffects(before);
      return notification;
    },
    async listNotifications() {
      const local = devStore.snapshot().notifications;
      const rows = await db.select().from(notifications);
      return mergeById(local, rows.map(fromNotificationRow)).sort(
        (first, second) => second.createdAt.localeCompare(first.createdAt),
      );
    },
    async markNotificationRead(notificationId) {
      const before = getSideEffectCounts(devStore.snapshot());
      const local = await devStore.markNotificationRead(notificationId);
      let notification = local;
      if (!notification) {
        const existing = (
          await db
            .select()
            .from(notifications)
            .where(eq(notifications.id, notificationId))
            .limit(1)
        )[0];
        if (!existing) return null;
        notification = {
          ...fromNotificationRow(existing),
          status: "read",
          updatedAt: isoNow(),
        };
      }
      await db
        .update(notifications)
        .set({
          status: "read",
          updatedAt: new Date(notification.updatedAt),
        })
        .where(eq(notifications.id, notificationId));
      if (!local)
        await devStore.writeAuditLog(
          "notification_read",
          "notification",
          notificationId,
        );
      await persistNewSideEffects(before);
      return notification;
    },
    async dismissNotification(notificationId) {
      const before = getSideEffectCounts(devStore.snapshot());
      const local = await devStore.dismissNotification(notificationId);
      let notification = local;
      if (!notification) {
        const existing = (
          await db
            .select()
            .from(notifications)
            .where(eq(notifications.id, notificationId))
            .limit(1)
        )[0];
        if (!existing) return null;
        notification = {
          ...fromNotificationRow(existing),
          status: "dismissed",
          updatedAt: isoNow(),
        };
      }
      await db
        .update(notifications)
        .set({
          status: "dismissed",
          updatedAt: new Date(notification.updatedAt),
        })
        .where(eq(notifications.id, notificationId));
      if (!local)
        await devStore.writeAuditLog(
          "notification_dismissed",
          "notification",
          notificationId,
        );
      await persistNewSideEffects(before);
      return notification;
    },
    async listSecurityMemories() {
      const local = devStore.snapshot().securityMemories;
      const rows = await db.select().from(securityMemories);
      return mergeById(local, rows.map(fromMemoryRow));
    },
    async upsertRepoProfileMemory(repositoryId, profile) {
      const before = getSideEffectCounts(devStore.snapshot());
      await devStore.upsertRepoProfileMemory(repositoryId, profile);
      const memory = devStore
        .snapshot()
        .securityMemories.find(
          (candidate) => candidate.id === `mem_repo_profile_${repositoryId}`,
        );
      if (memory)
        await db
          .insert(securityMemories)
          .values(toMemoryRow(memory))
          .onConflictDoNothing();
      await persistNewSideEffects(before);
    },
    async writeAuditLog(action, targetType, targetId) {
      const before = getSideEffectCounts(devStore.snapshot());
      await devStore.writeAuditLog(action, targetType, targetId);
      await persistNewSideEffects(before);
    },
  };
}

function getSideEffectCounts(snapshot: PersistenceSnapshot): {
  securityMemoryCount: number;
  fixDecisionMemoryCount: number;
  auditLogCount: number;
} {
  return {
    securityMemoryCount: snapshot.securityMemories.length,
    fixDecisionMemoryCount: snapshot.fixDecisionMemories.length,
    auditLogCount: snapshot.auditLogs.length,
  };
}

function repositoryIdentityWhere(input: RepositoryInput) {
  if (input.provider === "github") {
    return and(
      eq(repositories.provider, "github"),
      sql`lower(${repositories.owner}) = ${input.owner.toLowerCase()}`,
      sql`lower(${repositories.name}) = ${input.name.toLowerCase()}`,
    );
  }

  return and(
    eq(repositories.provider, input.provider),
    eq(repositories.url, input.url),
  );
}

function fromRepositoryRow(
  repository: typeof repositories.$inferSelect,
): Repository {
  return {
    id: repository.id,
    projectId: repository.projectId,
    provider: repository.provider === "github" ? "github" : "local",
    owner: repository.owner,
    name: repository.name,
    defaultBranch: repository.defaultBranch,
    url: repository.url,
    installationId: repository.installationId,
    isPrivate: repository.isPrivate === "true",
    connectionType: normalizeConnectionType(repository.connectionType),
    canScan: repository.canScan !== "false",
    canMonitor: repository.canMonitor === "true",
    canOpenPr: repository.canOpenPr === "true",
    permissionsSummary: repository.permissionsSummary ?? {},
    lastScannedAt: repository.lastScannedAt
      ? repository.lastScannedAt.toISOString()
      : null,
    createdAt: repository.createdAt.toISOString(),
    updatedAt: repository.updatedAt.toISOString(),
  };
}

function fromGitHubInstallationRow(
  installation: typeof githubInstallations.$inferSelect,
): GitHubInstallation {
  return {
    id: installation.id,
    installationId: installation.installationId,
    teamId: installation.teamId,
    userId: installation.userId,
    accountLogin: installation.accountLogin,
    accountType: installation.accountType,
    status: normalizeGitHubInstallationStatus(installation.status),
    repositorySelection: installation.repositorySelection,
    repositoryCount: installation.repositoryCount,
    permissionsSummary: installation.permissionsSummary ?? {},
    createdAt: installation.createdAt.toISOString(),
    updatedAt: installation.updatedAt.toISOString(),
  };
}

function fromScanJobRow(scanJob: typeof scanJobs.$inferSelect): ScanJob {
  return {
    id: scanJob.id,
    repositoryId: scanJob.repositoryId,
    status: scanJob.status as ScanJob["status"],
    source: scanJob.source as ScanJob["source"],
    branch: scanJob.branch,
    commitSha: scanJob.commitSha,
    webhookDeliveryId: scanJob.webhookDeliveryId,
    pullRequestNumber: scanJob.pullRequestNumber,
    error: scanJob.error,
    startedAt: scanJob.startedAt ? scanJob.startedAt.toISOString() : null,
    completedAt: scanJob.completedAt ? scanJob.completedAt.toISOString() : null,
    summary: {
      critical: Number(scanJob.summary.critical ?? 0),
      high: Number(scanJob.summary.high ?? 0),
      medium: Number(scanJob.summary.medium ?? 0),
      low: Number(scanJob.summary.low ?? 0),
      info: Number(scanJob.summary.info ?? 0),
      lifecycle: normalizeLifecycleSummary(scanJob.summary.lifecycle),
    },
  };
}

function fromFindingRow(finding: typeof findings.$inferSelect): Finding {
  return {
    id: finding.id,
    scanJobId: finding.scanJobId,
    repositoryId: finding.repositoryId,
    ruleId: finding.ruleId,
    title: finding.title,
    category: finding.category,
    severity: finding.severity as Finding["severity"],
    confidence: finding.confidence,
    status: finding.status as Finding["status"],
    lifecycleStatus: normalizeFindingLifecycleStatus(finding.lifecycleStatus),
    firstSeenAt: finding.firstSeenAt
      ? finding.firstSeenAt.toISOString()
      : finding.createdAt.toISOString(),
    lastSeenAt: finding.lastSeenAt
      ? finding.lastSeenAt.toISOString()
      : finding.createdAt.toISOString(),
    resolvedAt: finding.resolvedAt ? finding.resolvedAt.toISOString() : null,
    occurrenceCount: finding.occurrenceCount,
    fingerprint:
      finding.fingerprint ??
      createFindingFingerprint({
        repositoryId: finding.repositoryId,
        ruleId: finding.ruleId as NormalizedFinding["ruleId"],
        affectedFile: finding.affectedFile,
        evidence: finding.evidence as NormalizedFinding["evidence"],
      }),
    previousFindingId: finding.previousFindingId,
    memoryStatus: normalizeFindingMemoryStatus(finding.memoryStatus),
    stackTags: finding.stackTags as Finding["stackTags"],
    affectedFile: finding.affectedFile,
    evidence: finding.evidence as Finding["evidence"],
    riskExplanation: finding.riskExplanation,
    remediationSummary: finding.remediationSummary,
    verificationStrategy: finding.verificationStrategy,
    autofixAvailable: finding.autofixAvailable === "true",
    createdAt: finding.createdAt.toISOString(),
    updatedAt: finding.updatedAt.toISOString(),
  };
}

function fromNotificationRow(
  notification: typeof notifications.$inferSelect,
): Notification {
  return {
    id: notification.id,
    teamId: notification.teamId,
    repositoryId: notification.repositoryId,
    scanJobId: notification.scanJobId,
    findingId: notification.findingId,
    type: notification.type as Notification["type"],
    severity: notification.severity as Notification["severity"],
    title: notification.title,
    message: notification.message,
    status: notification.status as Notification["status"],
    createdAt: notification.createdAt.toISOString(),
    updatedAt: notification.updatedAt.toISOString(),
  };
}

function fromMemoryRow(
  memory: typeof securityMemories.$inferSelect,
): SecurityMemory {
  return {
    id: memory.id,
    teamId: memory.teamId,
    repositoryId: memory.repositoryId,
    kind: normalizeSecurityMemoryKind(memory.kind),
    title: memory.title,
    content: memory.content,
    source: normalizeSecurityMemorySource(memory.source),
    confidence: normalizeSecurityMemoryConfidence(memory.confidence),
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
  };
}

function fromFixDecisionMemoryRow(
  memory: typeof fixDecisionMemories.$inferSelect,
): FixDecisionMemory {
  return {
    id: memory.id,
    teamId: memory.teamId,
    repositoryId: memory.repositoryId,
    findingFingerprint: memory.findingFingerprint,
    ruleId: memory.ruleId,
    decisionType: normalizeFixDecisionType(memory.decisionType),
    proposalId: memory.proposalId,
    findingId: memory.findingId,
    rationale: memory.rationale,
    patchHash: memory.patchHash,
    recommendedFixHash: memory.recommendedFixHash,
    proposalKind: normalizeFixProposalKind(memory.proposalKind),
    actorUserId: memory.actorUserId,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
  };
}

function fromFixProposalRow(
  proposal: typeof fixProposals.$inferSelect,
): FixProposal {
  return {
    id: proposal.id,
    findingId: proposal.findingId,
    repositoryId: proposal.repositoryId,
    status: proposal.status as FixProposal["status"],
    kind: proposal.kind as FixProposal["kind"],
    title: proposal.title,
    explanation: proposal.explanation,
    proposedPatch: proposal.proposedPatch,
    diff: proposal.diff,
    risk: proposal.risk,
    verificationPlan: proposal.verificationPlan,
    filesChanged: proposal.filesChanged,
    createdAt: proposal.createdAt.toISOString(),
    updatedAt: proposal.updatedAt.toISOString(),
  };
}

function fromVerificationRow(
  result: typeof verificationResults.$inferSelect,
): VerificationResult {
  return {
    id: result.id,
    fixProposalId: result.fixProposalId,
    status: result.status as VerificationResult["status"],
    scannerRerunStatus:
      result.scannerRerunStatus as VerificationResult["scannerRerunStatus"],
    testCommand: result.testCommand,
    testOutputSummary: result.testOutputSummary,
    evidence: result.evidence,
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
  };
}

function toRepositoryRow(repository: Repository) {
  return {
    ...repository,
    isPrivate: String(repository.isPrivate),
    canScan: String(repository.canScan),
    canMonitor: String(repository.canMonitor),
    canOpenPr: String(repository.canOpenPr),
    lastScannedAt: repository.lastScannedAt
      ? new Date(repository.lastScannedAt)
      : null,
    createdAt: new Date(repository.createdAt),
    updatedAt: new Date(repository.updatedAt),
  };
}

function toGitHubInstallationRow(installation: GitHubInstallation) {
  return {
    ...installation,
    createdAt: new Date(installation.createdAt),
    updatedAt: new Date(installation.updatedAt),
  };
}

function toScanJobRow(scanJob: ScanJob) {
  return {
    ...scanJob,
    startedAt: scanJob.startedAt ? new Date(scanJob.startedAt) : null,
    completedAt: scanJob.completedAt ? new Date(scanJob.completedAt) : null,
  };
}

function toFindingRow(finding: Finding) {
  return {
    ...finding,
    autofixAvailable: String(finding.autofixAvailable),
    firstSeenAt: new Date(finding.firstSeenAt),
    lastSeenAt: new Date(finding.lastSeenAt),
    resolvedAt: finding.resolvedAt ? new Date(finding.resolvedAt) : null,
    createdAt: new Date(finding.createdAt),
    updatedAt: new Date(finding.updatedAt),
  };
}

function toFixProposalRow(proposal: FixProposal) {
  return {
    id: proposal.id,
    findingId: proposal.findingId,
    repositoryId: proposal.repositoryId,
    status: proposal.status,
    kind: proposal.kind,
    title: proposal.title,
    explanation: proposal.explanation,
    proposedPatch: proposal.proposedPatch,
    diff: proposal.diff,
    risk: proposal.risk,
    verificationPlan: proposal.verificationPlan,
    filesChanged: proposal.filesChanged,
    createdAt: new Date(proposal.createdAt),
    updatedAt: new Date(proposal.updatedAt),
  };
}

function toFixDecisionMemoryRow(memory: FixDecisionMemory) {
  return {
    id: memory.id,
    teamId: memory.teamId,
    repositoryId: memory.repositoryId,
    findingFingerprint: memory.findingFingerprint,
    ruleId: memory.ruleId,
    decisionType: memory.decisionType,
    proposalId: memory.proposalId,
    findingId: memory.findingId,
    rationale: memory.rationale,
    patchHash: memory.patchHash,
    recommendedFixHash: memory.recommendedFixHash,
    proposalKind: memory.proposalKind,
    actorUserId: memory.actorUserId,
    createdAt: new Date(memory.createdAt),
    updatedAt: new Date(memory.updatedAt),
  };
}

function toVerificationRow(result: VerificationResult) {
  return {
    ...result,
    createdAt: new Date(result.createdAt),
    updatedAt: new Date(result.updatedAt),
  };
}

function toPullRequestRow(pullRequest: PullRequestRecord) {
  return {
    ...pullRequest,
    createdAt: new Date(pullRequest.createdAt),
    updatedAt: new Date(pullRequest.updatedAt),
  };
}

function toNotificationRow(notification: Notification) {
  return {
    ...notification,
    createdAt: new Date(notification.createdAt),
    updatedAt: new Date(notification.updatedAt),
  };
}

function toMemoryRow(memory: SecurityMemory) {
  return {
    ...memory,
    teamId: memory.teamId ?? defaultTeamId,
    confidence: memory.confidence ?? "medium",
    createdAt: new Date(memory.createdAt),
    updatedAt: new Date(memory.updatedAt ?? memory.createdAt),
  };
}

function toAuditRow(log: AuditLog) {
  return {
    ...log,
    createdAt: new Date(log.createdAt),
  };
}

function upsertById<T extends { id: string }>(records: T[], input: T): void {
  const index = records.findIndex((record) => record.id === input.id);
  if (index === -1) records.push(input);
  else records[index] = input;
}

function mergeById<T extends { id: string }>(first: T[], second: T[]): T[] {
  const records = new Map<string, T>();
  for (const record of first) records.set(record.id, record);
  for (const record of second) records.set(record.id, record);
  return Array.from(records.values());
}

function getRepositoryCapabilityDefaults(
  input: RepositoryInput,
): Pick<
  Repository,
  | "connectionType"
  | "canScan"
  | "canMonitor"
  | "canOpenPr"
  | "permissionsSummary"
> {
  if (input.provider === "local") {
    return {
      connectionType: "local",
      canScan: true,
      canMonitor: false,
      canOpenPr: false,
      permissionsSummary: {
        mode: "local_development",
      },
    };
  }

  if (input.installationId) {
    return {
      connectionType: "github_app",
      canScan: true,
      canMonitor: true,
      canOpenPr: false,
      permissionsSummary: {
        contents: "read",
        pullRequests: "unknown",
      },
    };
  }

  return {
    connectionType: "public_github",
    canScan: true,
    canMonitor: false,
    canOpenPr: false,
    permissionsSummary: {
      contents: "public_read",
      pullRequests: "none",
    },
  };
}

function applyRepositoryInput(
  repository: Repository,
  input: RepositoryInput,
): Repository {
  const defaults = getRepositoryCapabilityDefaults(input);
  const preserveInstalledPrivateState =
    Boolean(repository.installationId) &&
    !input.installationId &&
    input.connectionType === "public_github";
  const updatedRepository: Repository = {
    ...repository,
    projectId: input.projectId,
    defaultBranch: input.defaultBranch,
    url: input.url,
    installationId: input.installationId ?? repository.installationId,
    isPrivate: preserveInstalledPrivateState
      ? repository.isPrivate
      : (input.isPrivate ?? repository.isPrivate),
    connectionType:
      input.connectionType ??
      repository.connectionType ??
      defaults.connectionType,
    canScan: input.canScan ?? repository.canScan ?? defaults.canScan,
    canMonitor:
      input.canMonitor ?? repository.canMonitor ?? defaults.canMonitor,
    canOpenPr: input.canOpenPr ?? repository.canOpenPr ?? defaults.canOpenPr,
    permissionsSummary:
      input.permissionsSummary ??
      repository.permissionsSummary ??
      defaults.permissionsSummary,
    updatedAt: isoNow(),
  };
  normalizeInstalledRepositoryCapabilities(updatedRepository);
  return updatedRepository;
}

function normalizeInstalledRepositoryCapabilities(
  repository: Repository,
): void {
  if (!repository.installationId) return;
  if (
    repository.permissionsSummary.connectionStatus === "disconnected" ||
    repository.permissionsSummary.accessRemovedFromInstallation === true
  )
    return;

  repository.connectionType = "github_app";
  repository.canScan = true;
  repository.canMonitor = true;
  repository.canOpenPr = false;
  repository.permissionsSummary = {
    ...repository.permissionsSummary,
    connectionStatus: "connected",
    githubAppPrCreationImplemented: false,
  };
}

function normalizeConnectionType(value: string): Repository["connectionType"] {
  if (
    value === "github_app" ||
    value === "public_github" ||
    value === "token_dev"
  )
    return value;
  return "local";
}

function normalizeGitHubInstallationStatus(
  value: string,
): GitHubInstallation["status"] {
  if (
    value === "connected" ||
    value === "disconnected" ||
    value === "revoked" ||
    value === "error"
  )
    return value;
  return "error";
}

function normalizeSecurityMemoryKind(value: string): SecurityMemory["kind"] {
  if (
    value === "architecture" ||
    value === "repo_profile" ||
    value === "accepted_fix" ||
    value === "rejected_fix" ||
    value === "false_positive" ||
    value === "preference"
  ) {
    return value;
  }
  return "preference";
}

function normalizeSecurityMemorySource(
  value: string,
): SecurityMemory["source"] {
  if (
    value === "human" ||
    value === "autocyber" ||
    value === "scanner_observed" ||
    value === "user_approved" ||
    value === "user_rejected"
  ) {
    return value;
  }
  return "autocyber";
}

function normalizeSecurityMemoryConfidence(
  value: string,
): SecurityMemory["confidence"] {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "medium";
}

function normalizeFixDecisionType(value: string): FixDecisionType {
  if (
    value === "fix_accepted" ||
    value === "fix_rejected" ||
    value === "remediation_applied" ||
    value === "advisory_acknowledged" ||
    value === "false_positive" ||
    value === "manual_fix_preferred"
  ) {
    return value;
  }
  return "advisory_acknowledged";
}

function normalizeFixProposalKind(
  value: string | null,
): FixProposal["kind"] | null {
  if (value === "patch" || value === "advisory") return value;
  return null;
}

function normalizeFindingLifecycleStatus(
  value: string | null,
): Finding["lifecycleStatus"] {
  if (
    value === "new" ||
    value === "existing" ||
    value === "resolved" ||
    value === "reappeared"
  )
    return value;
  return "new";
}

function normalizeFindingMemoryStatus(
  value: string | null,
): Finding["memoryStatus"] {
  if (value === "false_positive_suppressed") return value;
  return "none";
}

function normalizeLifecycleSummary(value: unknown): FindingLifecycleSummary {
  if (!isRecord(value)) return emptyFindingLifecycleSummary();
  return {
    new: Number(value.new ?? 0),
    existing: Number(value.existing ?? 0),
    resolved: Number(value.resolved ?? 0),
    reappeared: Number(value.reappeared ?? 0),
  };
}

function readFalsePositiveFingerprint(content: string): string | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (
      isRecord(parsed) &&
      typeof parsed.fingerprint === "string" &&
      parsed.fingerprint
    ) {
      return parsed.fingerprint;
    }
  } catch {
    return null;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function createFixDecisionMemoryId(input: {
  repositoryId: string;
  findingFingerprint: string;
  ruleId: string;
  decisionType: FixDecisionType;
  proposalId: string | null;
  findingId: string | null;
  patchHash: string | null;
  recommendedFixHash: string | null;
}): string {
  return `fixmem_${hashDecisionValue(
    [
      input.repositoryId,
      input.findingFingerprint,
      input.ruleId,
      input.decisionType,
      input.proposalId ?? "",
      input.findingId ?? "",
      input.patchHash ?? "",
      input.recommendedFixHash ?? "",
    ].join(":"),
  ).replace("hash_", "")}`;
}

function inferProposalRuleId(proposal: FixProposal): string {
  if (proposal.ruleId) return proposal.ruleId;
  if (proposal.decisionMemory?.latestDecisionType === "false_positive")
    return "false_positive";
  return "unknown";
}

function isoNow(): string {
  return new Date().toISOString();
}

declare global {
  var __autocyberPersistenceStore: PersistenceStore | undefined;
}
