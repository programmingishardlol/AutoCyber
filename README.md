# AutoCyber

AutoCyber is an AI security engineer for AI-built startup stacks. It helps small teams detect practical security issues, understand the risk, propose fixes, verify remediation, and create trustworthy pull requests after human approval.

The product loop is:

```txt
Detect -> Explain -> Fix -> Verify -> PR -> Remember -> Monitor
```

AutoCyber is not a generic scanner dashboard. The goal is to become a practical security teammate for AI-built startups using tools like GitHub, Next.js, Node.js, Supabase, Vercel, Clerk, Stripe, OpenAI, and Anthropic.

## Current Progress

**Current product stage: Stage 7 Security Memory is complete and QA-passed.**

AutoCyber is an early full-stack prototype with the complete development loop working:

```txt
Detect -> Explain -> Fix -> Verify -> PR -> Remember -> Monitor
```

The next product stage is Stage 8 Opinionated Workflows. The next platform milestone is production deployment with Docker, GitHub Actions, and AWS. Docker and AWS infrastructure are not part of the current checkpoint yet.

Implemented:

- Product shell with dashboard, projects, repositories, scans, findings, finding detail, fix proposals, verification, pull requests, integrations, security memory, workflows, settings, and notifications pages
- Shared domain models for repositories, scan jobs, findings, fix proposals, verification results, pull requests, integrations, memories, workflow playbooks, audit logs, repository monitoring metadata, and notifications
- Local repository scan flow
- Public GitHub repository scan flow
- Private GitHub repository ingestion boundary through GitHub App installation metadata
- Project detection for common startup stacks
- Normalized findings with severity, confidence, evidence, risk explanation, remediation summary, verification strategy, and autofix availability
- Scanner rules and fixtures for Next.js, Node.js, Supabase, Vercel, Clerk, Stripe, OpenAI, and Anthropic risks
- Findings dashboard and finding detail workflow
- Rule-based fix proposal generation for supported findings
- Local remediation and verification helpers
- Token-mode GitHub PR prototype for approved and verified remediation executions
- GitHub App callback route that records installation repositories and capabilities
- GitHub webhook route with HMAC signature validation for push and pull request events
- Queued scan job model for monitoring scans
- Retry flow for failed scans
- Monitoring history and notification UI
- Repository-scoped finding fingerprints and lifecycle states: new, existing, resolved, reappeared, and false-positive-suppressed
- Durable security memory for accepted fixes, rejected fixes, manual-fix preferences, false positives, and verified remediations
- Memory-aware priority scoring and notification de-duplication
- Copyable, redacted security evidence packs
- Drizzle schema and migrations for the current product data model

Prototype or planned:

- Production GitHub App installation UX
- Production background worker for queued scans
- Production-grade private repository fetching and PR creation through GitHub App tokens
- Full security-memory management UI and richer repository profiles
- Docker image, CI/CD workflows, and AWS infrastructure
- Team onboarding, billing, usage limits, and production auth policy
- Full setup flows for Vercel, Supabase, Clerk, Stripe, Firebase, Railway, Render, OpenAI, and Anthropic
- Autonomous remediation beyond human-approved flows

Stage status:

- Stage 0 Product Foundation: complete
- Stage 1 Repo Scanner: implemented for local and public GitHub development flows
- Stage 2 Findings Dashboard: implemented
- Stage 3 Fix Proposal Engine: implemented for rule-based proposals
- Stage 4 Verified PR Remediation: implemented as a guarded local/token-mode prototype
- Stage 5 Startup-Stack Integrations: scanner checks implemented for key startup-stack risks
- Stage 6 Continuous Monitoring: complete for the development prototype with GitHub App metadata, signed webhooks, queued scan jobs, retries, history, and notifications
- Stage 7 Security Memory: complete and QA-passed with finding lifecycle, decision memory, priority scoring, suppression, and evidence packs
- Stage 8 Opinionated Workflows: next

Known validation boundary: locally signed GitHub webhook handling is tested, but a webhook delivered by a real GitHub App has not been verified because a public callback URL and production GitHub credentials were not available in the test environment.

## How AutoCyber Works

1. A user adds a local repository path, public GitHub URL, or connected GitHub App repository.
2. AutoCyber ingests files with scanner limits and treats repository contents as untrusted input.
3. The scanner detects project type and runs security rules.
4. Findings are normalized with affected files, evidence, severity, confidence, risk explanation, and remediation guidance.
5. The dashboard presents findings in a review workflow.
6. Supported findings can generate a human-reviewable fix proposal with a patch, risk note, and verification plan.
7. Approved proposals can be applied to a temporary copy and verified.
8. Verified remediation can create a GitHub pull request in the current token-mode prototype.
9. GitHub webhooks can queue monitoring scans for push and pull request events.
10. Finding lifecycle and remediation decisions are remembered per repository.
11. Memory affects future proposal context, priority ranking, suppression, and notifications.
12. Evidence packs summarize current risk, decisions, remediation history, limitations, and next actions without exposing secrets.

## Tech Stack

Frontend:

- Next.js 15 App Router
- React 19
- TypeScript
- Tailwind CSS
- lucide-react icons
- Clerk-ready auth boundary

Backend and app services:

- Next.js route handlers
- TypeScript service modules
- Drizzle ORM schema for Supabase Postgres-ready persistence
- Development persistence abstraction for prototype flows
- GitHub webhook signature validation
- Queued scan-job abstraction for continuous monitoring
- Finding lifecycle and repository-scoped decision memory
- Deterministic priority scoring and redacted evidence-pack generation

Security and remediation:

- Custom TypeScript scanner rules
- Local file ingestion with size and path controls
- Normalized finding model
- Rule-based fix proposal templates
- Local remediation verification helpers
- Octokit-based GitHub PR prototype
- GitHub App installation metadata and private repository ingestion boundary

Tooling:

- pnpm workspaces
- Turbo
- Vitest
- TypeScript
- Prettier

## Repository Structure

```txt
apps/
  web/        Next.js product shell, API routes, UI, persistence, scanner wiring
  api/        Reserved service/worker boundary for future scanner and job workloads

packages/
  core/             Shared types, constants, utilities, mock data
  scanner/          Project detection, scanner runners, rules, fixtures, tests
  remediation/      Fix proposals, validation, local verification, GitHub PR prototype
  integrations/     Startup-stack integration boundary
  security-memory/  Repo memory boundary
  workflows/        Opinionated playbook boundary
  sandbox/          Future isolated execution and file access boundary
```

## Step-By-Step Guide

### 1. Clone The Repo

```bash
git clone https://github.com/programmingishardlol/AutoCyber.git
cd AutoCyber
```

### 2. Install Dependencies

Use pnpm 9.15.0.

```bash
pnpm install
```

### 3. Create Local Environment Config

Copy the safe template:

```bash
cp .env.example .env.local
```

Put real local secrets only in `.env.local`. Do not put real secrets in `README.md`, `.env.example`, source files, tests, screenshots, issues, commits, or pull requests.

For basic local demo usage, most values can stay empty. Add real values only when you use the related feature:

- `DATABASE_URL` or `SUPABASE_DATABASE_URL`: database-backed persistence
- `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`: Clerk auth
- `GITHUB_TOKEN` or `GITHUB_FINE_GRAINED_TOKEN`: local token-mode PR prototype against a test repository
- `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_INSTALL_URL`: GitHub App connection experiments
- `GITHUB_WEBHOOK_SECRET`: signed GitHub webhook testing
- `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`: future AI-assisted flows

For scanner fixture development, generate fake secret-shaped values inside tests. Do not commit `.env` fixture files, even when the values are fake.

### 4. Run The App

```bash
pnpm dev
```

Open `http://localhost:3000`.

### 5. Run A Local Scan

Open the scanner page and use the built-in vulnerable fixture path shown in the UI, or scan another local development repository path.

The scanner will return normalized findings and persist them into the development store.

### 6. Run A Public GitHub Scan

On the scanner page, choose GitHub URL and enter a public repository URL such as:

```txt
https://github.com/owner/repo
```

Private repository scans require the GitHub App flow and are still prototype-level.

### 7. Review Findings

Use:

- `/findings` for the findings dashboard
- `/findings/[id]` for evidence, risk explanation, affected file, confidence, and remediation guidance
- filters for severity, status, category, stack, and autofix availability

### 8. Generate A Fix Proposal

From a supported finding, generate a proposal to review:

- explanation of the fix
- proposed patch or diff
- risk of the change
- verification plan
- approval/rejection status

AutoCyber should never modify user code without human approval.

### 9. Verify Remediation

Approved proposals can be applied to a temporary working copy and verified with scanner reruns and relevant checks where available.

Do not treat a fix as verified unless the verification command actually ran.

### 10. Create A GitHub PR Prototype

For local testing only:

1. Create a dedicated test repository.
2. Add a fine-grained GitHub token to `.env.local`.
3. Scope the token to the test repository.
4. Grant only contents and pull request permissions needed for the prototype.
5. Approve and verify a remediation proposal.
6. Use the PR flow to create a branch and pull request.

Do not use a broad personal token or a production repository for early prototype testing.

### 11. Try Monitoring Flows

The Stage 6 development monitoring flow includes:

- GitHub App callback route: `/api/github-app/callback`
- GitHub webhook route: `/api/webhooks/github`
- Retry route: `/api/scans/retry`
- Queue worker route: `/api/scans/process-queue`
- Notifications route: `/api/notifications`
- Monitoring history page: `/scans`
- Notifications page: `/notifications`

For webhook testing:

1. Set `GITHUB_WEBHOOK_SECRET` in `.env.local`.
2. Connect or seed a GitHub repository record.
3. Send a signed `push` or `pull_request` webhook payload.
4. Leave `AUTOCYBER_WEBHOOK_EXECUTION_MODE` unset or set it to `auto` for push webhooks to scan immediately in the current prototype.
5. Use `AUTOCYBER_WEBHOOK_EXECUTION_MODE=queued` and call `POST /api/scans/process-queue` with `X-AutoCyber-Worker-Secret` only when testing the explicit queue-worker path.
6. Review monitoring history and notifications in the UI.

### 12. Use Security Memory

After a scan:

1. Review a finding and its lifecycle information, including first seen, last seen, and occurrence count.
2. Mark a confirmed false positive when appropriate. Matching findings in the same repository will be suppressed in later scans.
3. Approve, reject, or choose a manual fix for a proposal. AutoCyber records the decision for future proposal and priority context.
4. Run and verify an approved remediation to record the successful remediation result.
5. Review the findings and scan-history pages to see memory-aware priority and notification behavior.
6. Generate an evidence pack from the scan-history workflow for a redacted, copyable status summary.

Memory is repository-scoped. A decision made for one repository must not silently suppress or change findings in another repository.

## API Routes

Current app routes include:

- `GET /api/health`: health check
- `GET /api/mock/summary`: demo summary data
- `POST /api/scans`: local or public GitHub scan
- `POST /api/scans/retry`: retry a failed scan job
- `POST /api/scans/process-queue`: process queued monitoring scan jobs behind a worker secret
- `POST /api/fix-proposals`: generate a fix proposal from a normalized finding
- `POST /api/fix-proposals/decision`: record an accepted, rejected, advisory, or manual-fix decision
- `POST /api/findings/false-positive`: mark and remember a repository-scoped false positive
- `POST /api/evidence-pack`: generate a redacted security evidence pack
- `POST /api/remediations`: apply and verify an approved proposal in a local remediation flow
- `POST /api/github-prs`: create a PR from an approved and verified remediation execution
- `GET /api/github-app/callback`: record GitHub App installation repositories
- `POST /api/webhooks/github`: validate and process GitHub push or pull request webhooks
- `POST /api/notifications`: mark notifications read or dismissed

## Docker, CI/CD, And AWS Plan

The recommended first production architecture is:

```txt
Developer -> GitHub -> GitHub Actions -> Amazon ECR -> Amazon ECS Fargate
                                                        |
                                         ALB + HTTPS + CloudWatch
                                                        |
                                  Supabase Postgres + Secrets Manager
```

Use one immutable container image for both staging and production. Inject environment-specific configuration at runtime; never bake `.env.local`, API keys, database URLs, GitHub private keys, or webhook secrets into the image.

### Phase 1: Dockerize AutoCyber

1. Enable Next.js standalone output so the runtime image contains only traced production files.
2. Add a multi-stage `Dockerfile` with dependency, build, and non-root runtime stages.
3. Add `.dockerignore` entries for Git history, local environment files, private Markdown, dependencies, build caches, test output, and local scanner data.
4. Copy `public` and `.next/static` into the standalone runtime image.
5. Expose port `3000` and use `GET /api/health` for the container health check.
6. Mount or allocate writable temporary storage for `SCANNER_WORKDIR`; repository clones and remediation working copies must remain temporary.
7. Build and run the image locally with explicit environment variables, then test health, a public GitHub scan, findings, fix proposals, verification, monitoring, memory, and evidence packs.

Docker should package the app consistently. It does not replace Supabase, GitHub credentials, webhook delivery, or durable background-job processing.

### Phase 2: Add Continuous Integration

Create `.github/workflows/ci.yml` for pull requests and pushes:

1. Check out the repository.
2. Install the pinned Node.js and pnpm versions.
3. Run `pnpm install --frozen-lockfile`.
4. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.
5. Build the production Docker image to catch packaging failures.
6. Add a container vulnerability scan and fail on the agreed severity threshold.
7. Require the CI workflow before a pull request can merge.

CI must use fake or isolated test values. It must never receive production application secrets merely to compile or run unit tests.

### Phase 3: Create AWS Infrastructure

Use AWS CDK with TypeScript in an `infra/aws` workspace so infrastructure changes are reviewed with application code.

1. Create separate staging and production environments.
2. Create an Amazon ECR repository for immutable AutoCyber images tagged with the Git commit SHA.
3. Create an ECS cluster and Fargate service for the Next.js web container.
4. Put an Application Load Balancer in front of the service and connect `/api/health` to its target-group health check.
5. Add an ACM TLS certificate and Route 53 DNS record for HTTPS.
6. Store runtime secrets in AWS Secrets Manager and grant the ECS task role access only to the secrets it needs.
7. Send application logs to CloudWatch and add alarms for unhealthy tasks, repeated restarts, high error rates, CPU, and memory.
8. Keep Supabase Postgres as the first production database to avoid migrating the database and application platform at the same time.
9. Give scanner tasks Fargate ephemeral storage for temporary repository clones. Do not use container storage as durable application state.
10. Split queue processing into a dedicated ECS worker service before relying on continuous production monitoring. The current protected HTTP worker route is a prototype boundary, not the final worker architecture.

Start staging with one web task and one worker task. Add multi-instance caching or shared cache coordination before scaling the Next.js service horizontally if the application begins relying on server-side revalidation caches.

### Phase 4: Add Continuous Deployment

Create a deployment workflow with this sequence:

```txt
Pull request -> CI checks
Merge to main -> Build image -> Push commit-SHA tag to ECR
              -> Deploy staging ECS task definition
              -> Health and smoke checks
              -> Manual production approval
              -> Deploy the same image digest to production
```

1. Connect GitHub Actions to AWS using OpenID Connect and short-lived role credentials. Do not create long-lived AWS access keys in GitHub.
2. Restrict the AWS role trust policy to this GitHub organization, repository, branch, and protected deployment environment.
3. Give the CI role ECR push permission and only the ECS deployment permissions it needs.
4. Deploy a new task definition revision and wait for ECS service stability.
5. Run smoke checks against `/api/health` and a safe, non-customer test flow.
6. Protect production with GitHub Environment approval.
7. Roll back by redeploying the previous healthy task definition and image digest.

### What A Fresh Clone Can Do

A fresh clone can run the same code and local development functions after dependencies are installed and the operator supplies their own environment values. It cannot inherit this developer's secrets, GitHub App installation, Supabase data, webhook URL, or AWS resources. Production-equivalent behavior also requires:

- applying the included database migrations to a Supabase Postgres database
- configuring Clerk and GitHub App credentials
- configuring signed GitHub webhook delivery
- providing durable queue processing
- deploying the web and worker containers with sufficient temporary scanner storage

This separation is intentional: source code is public and reproducible, while credentials, customer data, and deployed infrastructure remain private.

## Scanner Coverage

Current scanner rules focus on practical issues common in AI-built startup applications:

- Exposed secrets and unsafe environment variable handling
- Missing `.env.example`
- Wildcard CORS
- Missing authentication in Next.js API routes
- Missing authorization for privileged routes
- Missing baseline security headers
- Dangerous `NEXT_PUBLIC_*` usage
- Insecure webhook handlers
- Dependency risk placeholders
- Supabase service-role and RLS risks
- Vercel risky config
- Clerk auth and organization authorization gaps
- Stripe webhook and payment-state risks
- AI route rate-limit, prompt logging, and client-side key risks

This is not full security coverage. Findings should be treated as practical review signals, not a guarantee that an app is secure.

## Checks

Run focused checks during development:

```bash
pnpm scanner:test
pnpm test
pnpm typecheck
pnpm build
```

## Publishing Safety

This repository intentionally ignores private local Markdown and environment files:

- `README.md` is public.
- Other `*.md` files are treated as private local notes by default.
- `.superpowers/` is local brainstorming/session output and is not required to run AutoCyber.
- `.env.example` is public because it contains empty placeholders.
- `.env`, `.env.local`, and `.env.*` files are private and ignored.

Before publishing, check what will be committed:

```bash
git status --short
git status --ignored --short
```

Never commit real API keys, GitHub tokens, database URLs, private keys, webhook secrets, service-role keys, or local customer/repository notes.
