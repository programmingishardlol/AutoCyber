# AutoCyber

AutoCyber is an AI security engineer for AI-built startup stacks. It helps small teams detect practical security issues, understand the risk, propose fixes, verify remediation, and create trustworthy pull requests after human approval.

The product is built around one loop:

```txt
Detect -> Explain -> Fix -> Verify -> PR -> Remember -> Monitor
```

AutoCyber is not intended to be a generic scanner dashboard. The goal is to become a practical security teammate for AI-built startups using tools like GitHub, Next.js, Node.js, Supabase, Vercel, Clerk, Stripe, OpenAI, and Anthropic.

## Current Prototype Status

This repo is an early full-stack prototype with the core security workflow partially implemented.

Implemented:

- Next.js App Router product shell
- Dashboard, projects, repositories, scans, findings, finding detail, fix proposals, verification, pull requests, integrations, security memory, workflows, and settings pages
- Shared domain models for projects, repositories, scan jobs, findings, fix proposals, verification results, pull requests, integrations, security memory, workflows, and audit logs
- Local repository scanner wiring through the web app API
- Public GitHub repository scan flow for development use
- Project detection for modern startup stacks
- Normalized security findings with severity, confidence, evidence, risk explanation, remediation summary, and autofix availability
- Scanner fixtures and tests
- Rule-based fix proposal generation for supported findings
- Local remediation and verification helpers
- Token-mode GitHub pull request remediation prototype guarded by approval and verification checks
- Drizzle schema and migrations for the product data model
- Mock data for demo and empty-state development

Still prototype or planned:

- Production GitHub App installation flow
- Continuous monitoring on push and pull request events
- Production background job system
- Real team onboarding and billing
- Full integration setup for Vercel, Supabase, Clerk, Stripe, Firebase, Railway, Render, OpenAI, and Anthropic
- Autonomous remediation beyond guarded human-approved flows

## How It Works

1. A user adds a local repository path or public GitHub repository URL.
2. AutoCyber ingests files with scanner limits and treats repository contents as untrusted input.
3. The scanner detects project type and runs security rules.
4. Findings are normalized with affected files, evidence, severity, confidence, risk explanation, and remediation guidance.
5. The dashboard presents findings in a security-review workflow.
6. For supported findings, AutoCyber generates a human-reviewable fix proposal with a patch, risk note, and verification plan.
7. Approved proposals can be applied to a temporary copy and verified.
8. Verified remediations can create a GitHub pull request in local token-mode prototype flows.
9. Repository profile and decision context are shaped for future security memory.

## Scanner Coverage

The current scanner focuses on practical issues common in AI-built startup applications:

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

Security and remediation:

- Custom TypeScript scanner rules
- Local file ingestion with size and path controls
- Normalized finding model
- Rule-based fix proposal templates
- Local remediation verification helpers
- Octokit-based GitHub PR prototype

Tooling:

- pnpm workspaces
- Turbo
- Vitest
- TypeScript strict-mode-oriented package setup
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

## Getting Started

Prerequisites:

- Node.js 22 or compatible current LTS
- pnpm 9.15.0

Install dependencies:

```bash
pnpm install
```

Run the app:

```bash
pnpm dev
```

The web app runs from `apps/web`. By default, Next.js serves it on `http://localhost:3000`.

Run checks:

```bash
pnpm typecheck
pnpm test
pnpm scanner:test
pnpm build
```

## Environment

Copy the safe template and fill in only the values needed for your local flow:

```bash
cp .env.example .env.local
```

Put real local secrets, such as Clerk keys, Supabase URLs, API keys, or a GitHub test token, in `.env.local`. Do not put real secrets in `README.md`, `.env.example`, source files, tests, screenshots, issues, commits, or pull requests. `.env.example` contains empty placeholders and is safe to publish.

Common local settings:

- `NEXT_PUBLIC_APP_URL`: local app URL
- `AUTOCYBER_PERSISTENCE`: persistence mode for development flows
- `DATABASE_URL` or `SUPABASE_DATABASE_URL`: database connection, when using Postgres-backed persistence
- `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`: auth configuration, when enabling Clerk
- `GITHUB_TOKEN` or `GITHUB_FINE_GRAINED_TOKEN`: local-only token-mode PR prototype
- `SCANNER_WORKDIR`, `SCANNER_MAX_FILE_SIZE_MB`, `SCANNER_TIMEOUT_SECONDS`: scanner safety controls

For GitHub token-mode testing, use a fine-grained token scoped to one test repository with only the permissions needed for contents and pull requests.

For scanner fixture development, use fake secret-shaped values generated inside tests. Do not commit `.env` fixture files, even when the values are fake.

## Development Workflow

Use the product loop as the development loop:

1. Add or update a scanner rule.
2. Add fixtures that show vulnerable and secure examples.
3. Return normalized findings with evidence and remediation guidance.
4. Add UI/API wiring so the scanner can be triggered from the app.
5. Add or update fix proposal templates when a safe deterministic fix exists.
6. Verify remediation with scanner reruns and relevant tests.
7. Only create PRs after explicit human approval.
8. Record decisions for future security memory.

Security rules for development:

- Treat scanned repositories as untrusted input.
- Do not execute arbitrary repository code by default.
- Do not expose secrets in logs, UI, tests, errors, or findings.
- Redact sensitive values before display or storage.
- Never claim remediation is verified unless verification actually ran.
- Prefer small, reviewable remediation pull requests.

## API Routes

Current app routes include:

- `POST /api/scans`: run a local or public GitHub repository scan
- `GET /api/mock/summary`: return demo summary data
- `GET /api/health`: health check
- `POST /api/fix-proposals`: generate a fix proposal from a normalized finding
- `POST /api/remediations`: apply and verify an approved proposal in a local remediation flow
- `POST /api/github-prs`: create a GitHub PR from an approved and verified remediation execution

## Publishing Safety

This repository intentionally ignores private local Markdown and environment files:

- `README.md` is public.
- Other `*.md` files are treated as private local notes by default.
- `.env.example` is public because it contains empty placeholders.
- `.env`, `.env.local`, and `.env.*` files are private and ignored.

Before publishing, check what will be committed:

```bash
git status --short
git status --ignored --short
```

## Roadmap

The long-term roadmap is:

1. Product foundation
2. Repo scanner
3. Findings dashboard
4. Fix proposal engine
5. Verified PR remediation
6. Startup-stack integrations
7. Continuous monitoring
8. Security memory
9. Opinionated workflows
10. Customer-ready SaaS
11. Autonomous remediation layer

The near-term priority is strengthening the core loop: scan a real repo, explain a real finding, propose a safe fix, verify it, and create a trustworthy PR after approval.
