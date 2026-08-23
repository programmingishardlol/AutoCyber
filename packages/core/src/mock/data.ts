import type {
  AuditLog,
  DashboardSummary,
  Finding,
  FixProposal,
  Integration,
  Project,
  PullRequestRecord,
  Repository,
  ScanJob,
  SecurityMemory,
  Team,
  VerificationResult,
  WorkflowPlaybook,
} from "../types/domain";
import { sortFindingsByRisk } from "../utils/severity";

const now = "2026-05-26T09:00:00.000Z";

export const mockTeam: Team = {
  id: "team_earlybyte",
  name: "EarlyByte Labs",
  slug: "earlybyte",
  createdAt: now,
  updatedAt: now,
};

export const mockProjects: Project[] = [
  {
    id: "proj_launchpad",
    teamId: mockTeam.id,
    name: "Launchpad SaaS",
    slug: "launchpad-saas",
    description:
      "Next.js, Clerk, Stripe, and Supabase app preparing for launch.",
    riskScore: 72,
    stage: "stage-0-foundation",
    stack: ["nextjs", "clerk", "stripe", "supabase", "vercel"],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "proj_agentdesk",
    teamId: mockTeam.id,
    name: "AgentDesk",
    slug: "agentdesk",
    description: "AI support tooling with OpenAI and Anthropic API usage.",
    riskScore: 48,
    stage: "stage-0-foundation",
    stack: ["nextjs", "node", "openai", "anthropic", "railway"],
    createdAt: now,
    updatedAt: now,
  },
];

export const mockRepositories: Repository[] = [
  {
    id: "repo_launchpad_web",
    projectId: "proj_launchpad",
    provider: "github",
    owner: "earlybyte",
    name: "launchpad-web",
    defaultBranch: "main",
    url: "https://github.com/earlybyte/launchpad-web",
    installationId: "123456",
    isPrivate: true,
    connectionType: "github_app",
    canScan: true,
    canMonitor: true,
    canOpenPr: false,
    permissionsSummary: {
      contents: "write",
      pullRequests: "write",
      pullRequestWriteGranted: true,
      githubAppPrCreationImplemented: false,
    },
    lastScannedAt: "2026-05-26T08:30:00.000Z",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "repo_agentdesk_api",
    projectId: "proj_agentdesk",
    provider: "github",
    owner: "earlybyte",
    name: "agentdesk-api",
    defaultBranch: "main",
    url: "https://github.com/earlybyte/agentdesk-api",
    installationId: null,
    isPrivate: false,
    connectionType: "public_github",
    canScan: true,
    canMonitor: false,
    canOpenPr: false,
    permissionsSummary: {
      contents: "public_read",
      pullRequests: "none",
    },
    lastScannedAt: "2026-05-25T18:15:00.000Z",
    createdAt: now,
    updatedAt: now,
  },
];

export const mockScanJobs: ScanJob[] = [
  {
    id: "scan_001",
    repositoryId: "repo_launchpad_web",
    status: "completed",
    source: "manual",
    branch: "main",
    commitSha: "9f83a2c",
    webhookDeliveryId: null,
    pullRequestNumber: null,
    error: null,
    startedAt: "2026-05-26T08:25:00.000Z",
    completedAt: "2026-05-26T08:30:00.000Z",
    summary: {
      critical: 0,
      high: 2,
      medium: 3,
      low: 1,
      info: 2,
      lifecycle: { new: 2, existing: 4, resolved: 1, reappeared: 1 },
    },
  },
  {
    id: "scan_002",
    repositoryId: "repo_agentdesk_api",
    status: "completed",
    source: "manual",
    branch: "main",
    commitSha: "1ca92bf",
    webhookDeliveryId: null,
    pullRequestNumber: null,
    error: null,
    startedAt: "2026-05-25T18:10:00.000Z",
    completedAt: "2026-05-25T18:15:00.000Z",
    summary: {
      critical: 0,
      high: 1,
      medium: 2,
      low: 0,
      info: 1,
      lifecycle: { new: 1, existing: 2, resolved: 1, reappeared: 0 },
    },
  },
];

export const mockFindings: Finding[] = sortFindingsByRisk([
  {
    id: "finding_api_auth",
    scanJobId: "scan_001",
    repositoryId: "repo_launchpad_web",
    ruleId: "missing-api-auth",
    title: "API route does not enforce user authentication",
    category: "missing-auth",
    severity: "high",
    confidence: 0.86,
    status: "fix_proposed",
    lifecycleStatus: "existing",
    firstSeenAt: "2026-05-24T08:30:00.000Z",
    lastSeenAt: "2026-05-26T08:30:00.000Z",
    resolvedAt: null,
    occurrenceCount: 3,
    fingerprint: "fp_mock_api_auth",
    previousFindingId: null,
    memoryStatus: "none",
    stackTags: ["nextjs", "clerk"],
    affectedFile: "app/api/admin/users/route.ts",
    evidence: [
      {
        filePath: "app/api/admin/users/route.ts",
        startLine: 12,
        endLine: 25,
        snippet:
          "export async function GET() { return NextResponse.json(await listUsers()); }",
      },
    ],
    riskExplanation:
      "An unauthenticated caller could enumerate admin user data if this route is deployed as-is.",
    remediationSummary:
      "Require Clerk auth and check the caller has the admin role before returning user data.",
    verificationStrategy:
      "Rerun the missing-api-auth scanner rule and verify unauthenticated requests are rejected.",
    autofixAvailable: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "finding_stripe_webhook",
    scanJobId: "scan_001",
    repositoryId: "repo_launchpad_web",
    ruleId: "stripe-webhook-missing-construct-event",
    title: "Stripe webhook handler missing signature verification",
    category: "insecure-webhook",
    severity: "high",
    confidence: 0.82,
    status: "open",
    lifecycleStatus: "new",
    firstSeenAt: "2026-05-26T08:30:00.000Z",
    lastSeenAt: "2026-05-26T08:30:00.000Z",
    resolvedAt: null,
    occurrenceCount: 1,
    fingerprint: "fp_mock_stripe_webhook",
    previousFindingId: null,
    memoryStatus: "none",
    stackTags: ["nextjs", "stripe"],
    affectedFile: "app/api/stripe/webhook/route.ts",
    evidence: [
      {
        filePath: "app/api/stripe/webhook/route.ts",
        startLine: 7,
        endLine: 18,
        snippet:
          "const event = await request.json(); await handleStripeEvent(event);",
      },
    ],
    riskExplanation:
      "Unsigned webhook events let attackers forge payment lifecycle events.",
    remediationSummary:
      "Use Stripe constructEvent with the raw request body and webhook signing secret.",
    verificationStrategy:
      "Rerun the Stripe webhook scanner rule and test unsigned webhook payload rejection.",
    autofixAvailable: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "finding_cors",
    scanJobId: "scan_002",
    repositoryId: "repo_agentdesk_api",
    ruleId: "unsafe-cors-wildcard",
    title: "CORS allows all origins on API responses",
    category: "unsafe-cors",
    severity: "medium",
    confidence: 0.74,
    status: "triaged",
    lifecycleStatus: "reappeared",
    firstSeenAt: "2026-05-20T18:15:00.000Z",
    lastSeenAt: "2026-05-25T18:15:00.000Z",
    resolvedAt: null,
    occurrenceCount: 2,
    fingerprint: "fp_mock_cors",
    previousFindingId: "finding_cors_resolved",
    memoryStatus: "none",
    stackTags: ["node", "railway"],
    affectedFile: "src/server.ts",
    evidence: [
      {
        filePath: "src/server.ts",
        startLine: 31,
        endLine: 31,
        snippet: "app.use(cors({ origin: '*' }));",
      },
    ],
    riskExplanation:
      "Wildcard CORS can expose authenticated browser requests to untrusted origins.",
    remediationSummary: "Restrict CORS to configured application origins.",
    verificationStrategy:
      "Rerun the unsafe-cors-wildcard scanner rule and verify allowed origins are explicit.",
    autofixAvailable: false,
    createdAt: now,
    updatedAt: now,
  },
]);

export const mockFixProposals: FixProposal[] = [
  {
    id: "fix_auth_admin_users",
    findingId: "finding_api_auth",
    repositoryId: "repo_launchpad_web",
    status: "draft",
    kind: "patch",
    title: "Gate admin user API with Clerk session and role check",
    explanation:
      "The patch adds server-side authentication and denies access unless the session contains the admin role.",
    proposedPatch:
      "Add Clerk server auth to the route handler before returning user data.",
    risk: "Low. The route becomes stricter and may require tests or seed data for current admin flows.",
    verificationPlan: [
      "Rerun missing-auth scanner rule",
      "Run route handler unit tests",
      "Manually confirm unauthorized requests return 401",
    ],
    filesChanged: ["app/api/admin/users/route.ts"],
    diff: "- export async function GET() {\n+ export async function GET() {\n+   const session = await auth();\n+   if (!session.userId) return new Response('Unauthorized', { status: 401 });",
    createdAt: now,
    updatedAt: now,
  },
];

export const mockVerificationResults: VerificationResult[] = [
  {
    id: "verify_auth_admin_users",
    fixProposalId: "fix_auth_admin_users",
    status: "not_started",
    scannerRerunStatus: "not_started",
    testCommand: "pnpm test --filter launchpad-web",
    testOutputSummary:
      "Verification is pending human approval of the fix proposal.",
    evidence: [
      "Scanner rerun will confirm the missing-auth finding is resolved.",
    ],
    createdAt: now,
    updatedAt: now,
  },
];

export const mockPullRequests: PullRequestRecord[] = [
  {
    id: "pr_auth_admin_users",
    fixProposalId: "fix_auth_admin_users",
    repositoryId: "repo_launchpad_web",
    status: "not_created",
    branchName: "autocyber/fix-admin-users-auth",
    title: "Require auth for admin user API",
    summary:
      "Draft PR metadata only. Real branch creation and PR creation starts in Stage 4.",
    url: null,
    createdAt: now,
    updatedAt: now,
  },
];

export const mockIntegrations: Integration[] = [
  {
    id: "int_github",
    teamId: mockTeam.id,
    provider: "github",
    status: "not_connected",
    displayName: "GitHub",
    description:
      "Token-mode remediation PR prototype for user-owned test repositories. GitHub App installation and URL scanning are not implemented.",
    lastCheckedAt: null,
  },
  {
    id: "int_vercel",
    teamId: mockTeam.id,
    provider: "vercel",
    status: "not_connected",
    displayName: "Vercel",
    description:
      "Scanner checks cover risky deployment headers and public environment configuration.",
    lastCheckedAt: null,
  },
  {
    id: "int_supabase",
    teamId: mockTeam.id,
    provider: "supabase",
    status: "not_connected",
    displayName: "Supabase",
    description:
      "Scanner checks cover service-role exposure, client usage, permissive RLS policies, and missing RLS indicators.",
    lastCheckedAt: null,
  },
  {
    id: "int_clerk",
    teamId: mockTeam.id,
    provider: "clerk",
    status: "not_connected",
    displayName: "Clerk",
    description:
      "Scanner checks cover missing route auth, organization authorization gaps, and middleware coverage.",
    lastCheckedAt: null,
  },
  {
    id: "int_stripe",
    teamId: mockTeam.id,
    provider: "stripe",
    status: "not_connected",
    displayName: "Stripe",
    description:
      "Scanner checks cover webhook signature verification, exposed secrets, and client-trusted payment state.",
    lastCheckedAt: null,
  },
  {
    id: "int_firebase",
    teamId: mockTeam.id,
    provider: "firebase",
    status: "not_connected",
    displayName: "Firebase",
    description:
      "Provider-specific checks are planned; no live connection exists yet.",
    lastCheckedAt: null,
  },
  {
    id: "int_railway",
    teamId: mockTeam.id,
    provider: "railway",
    status: "not_connected",
    displayName: "Railway",
    description:
      "Provider-specific deployment checks are planned; no live connection exists yet.",
    lastCheckedAt: null,
  },
  {
    id: "int_render",
    teamId: mockTeam.id,
    provider: "render",
    status: "not_connected",
    displayName: "Render",
    description:
      "Provider-specific deployment checks are planned; no live connection exists yet.",
    lastCheckedAt: null,
  },
  {
    id: "int_openai",
    teamId: mockTeam.id,
    provider: "openai",
    status: "not_connected",
    displayName: "OpenAI",
    description:
      "Scanner checks cover exposed keys, client-side usage, missing rate limits, and unsafe prompt logging.",
    lastCheckedAt: null,
  },
  {
    id: "int_anthropic",
    teamId: mockTeam.id,
    provider: "anthropic",
    status: "not_connected",
    displayName: "Anthropic",
    description:
      "Scanner checks cover exposed keys, client-side usage, missing rate limits, and unsafe prompt logging.",
    lastCheckedAt: null,
  },
];

export const mockSecurityMemories: SecurityMemory[] = [
  {
    id: "mem_clerk_auth",
    repositoryId: "repo_launchpad_web",
    kind: "architecture",
    title: "Launchpad uses Clerk for auth",
    content:
      "API routes under app/api/admin should require a Clerk session and admin role.",
    source: "human",
    createdAt: now,
  },
  {
    id: "mem_csp_rejected",
    repositoryId: "repo_launchpad_web",
    kind: "rejected_fix",
    title: "Strict CSP postponed",
    content:
      "Team postponed strict CSP until third-party analytics dependencies are audited.",
    source: "human",
    createdAt: now,
  },
];

export const mockWorkflowPlaybooks: WorkflowPlaybook[] = [
  {
    id: "playbook_secure_api_route",
    name: "Secure New API Route",
    slug: "secure-new-api-route",
    description:
      "Check authentication, authorization, input validation, rate limits, and response leakage.",
    stackTags: ["nextjs", "clerk"],
    detectionLogic:
      "Flag route handlers with sensitive data access and no server-side auth call.",
    fixStrategy:
      "Add authentication, explicit authorization checks, and narrow response fields.",
    verificationCheck:
      "Unauthenticated request returns 401 and scanner no longer reports missing auth.",
  },
  {
    id: "playbook_stripe_webhook",
    name: "Secure Stripe Webhook",
    slug: "secure-stripe-webhook",
    description:
      "Verify webhook signatures and avoid trusting client payment state.",
    stackTags: ["stripe", "nextjs"],
    detectionLogic:
      "Flag webhook handlers that parse JSON directly instead of using constructEvent.",
    fixStrategy:
      "Use raw request body, Stripe signature header, and server-side fulfillment checks.",
    verificationCheck:
      "Unsigned payload is rejected and signed fixture is accepted.",
  },
];

export const mockAuditLogs: AuditLog[] = [
  {
    id: "audit_scan_started",
    teamId: mockTeam.id,
    actor: "mira@earlybyte.test",
    action: "started_mock_scan",
    targetType: "repository",
    targetId: "repo_launchpad_web",
    createdAt: "2026-05-26T08:25:00.000Z",
  },
];

export const mockDashboardSummary: DashboardSummary = {
  openFindings: mockFindings.filter(
    (finding) =>
      finding.status !== "resolved" && finding.status !== "false_positive",
  ).length,
  verifiedFixes: mockVerificationResults.filter(
    (result) => result.status === "passed",
  ).length,
  connectedRepositories: mockRepositories.length,
  integrationsNeedingAttention: mockIntegrations.filter(
    (integration) => integration.status === "needs_attention",
  ).length,
};
