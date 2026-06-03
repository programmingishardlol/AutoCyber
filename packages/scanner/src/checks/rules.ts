import { basename } from "node:path";
import { createEvidence, createFinding } from "../normalizers/finding";
import type { NormalizedFinding, RuleContext, ScannedFile, ScannerRule } from "../types";

function lineNumberForIndex(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function lineAt(content: string, lineNumber: number): string {
  return content.split("\n")[lineNumber - 1] ?? "";
}

function hasAny(content: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(content));
}

function firstMatchLine(file: ScannedFile, pattern: RegExp): { lineNumber: number; snippet: string } | null {
  const match = pattern.exec(file.content);
  if (!match || match.index === undefined) return null;

  const lineNumber = lineNumberForIndex(file.content, match.index);
  return { lineNumber, snippet: lineAt(file.content, lineNumber) };
}

function firstMatchLineAny(file: ScannedFile, patterns: RegExp[]): { lineNumber: number; snippet: string } | null {
  for (const pattern of patterns) {
    const match = firstMatchLine(file, pattern);
    if (match) return match;
  }

  return null;
}

function isNextApiRoute(file: ScannedFile): boolean {
  return /^app\/api\/.+\/route\.(ts|tsx|js|jsx)$/.test(file.relativePath);
}

function isWebhookRoute(file: ScannedFile): boolean {
  return /webhook/i.test(file.relativePath);
}

function isClientComponent(file: ScannedFile): boolean {
  return /^["']use client["'];?/m.test(file.content.slice(0, 200));
}

function isClientReachableSurface(file: ScannedFile): boolean {
  return (
    isClientComponent(file) ||
    file.relativePath.startsWith("components/") ||
    /(^|\/)[A-Za-z0-9_-]*client[A-Za-z0-9_-]*\.(ts|tsx|js|jsx)$/i.test(file.relativePath) ||
    /NEXT_PUBLIC_[A-Z0-9_]+/.test(file.content)
  );
}

function stripCodeComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasIntegration(context: RuleContext, dependencyNames: string[]): boolean {
  return dependencyNames.some((dependencyName) => hasPackageDependency(context, dependencyName));
}

function hasPackageDependency(context: RuleContext, dependencyName: string): boolean {
  const packageFile = context.files.find((file) => file.relativePath === "package.json");
  return packageFile ? packageFile.content.includes(`"${dependencyName}"`) : false;
}

export const exposedSecretRule: ScannerRule = {
  id: "exposed-secret",
  run(context) {
    const findings: NormalizedFinding[] = [];
    const assignmentPattern =
      /^(?!NEXT_PUBLIC_)([A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PRIVATE_KEY)[A-Z0-9_]*)\s*=\s*["']?([A-Za-z0-9_./+=-]{24,})["']?/gm;

    for (const file of context.files) {
      if (file.relativePath.endsWith(".example")) continue;

      const match = assignmentPattern.exec(file.content);
      assignmentPattern.lastIndex = 0;
      if (!match || match.index === undefined) continue;

      const lineNumber = lineNumberForIndex(file.content, match.index);
      findings.push(
        createFinding({
          repositoryId: context.repositoryId,
          scanJobId: context.scanJobId,
          ruleId: "exposed-secret",
          title: "Potential secret committed to repository",
          category: "exposed-secrets",
          severity: "high",
          confidence: 0.88,
          stackTags: ["openai"],
          affectedFile: file.relativePath,
          evidence: [createEvidence(file.relativePath, lineNumber, lineAt(file.content, lineNumber))],
          riskExplanation: "Committed API keys or service tokens can be copied by anyone with repository access and used outside the intended application boundary.",
          remediationSummary: "Revoke the exposed value, remove it from git history if necessary, and keep only empty placeholders in `.env.example`.",
          autofixAvailable: false
        })
      );
    }

    return findings.slice(0, 1);
  }
};

export const missingEnvExampleRule: ScannerRule = {
  id: "missing-env-example",
  run(context) {
    const hasEnvFile = context.files.some((file) => basename(file.relativePath).startsWith(".env") && file.relativePath !== ".env.example");
    if (!hasEnvFile || context.hasFile(".env.example")) return [];

    return [
      createFinding({
        repositoryId: context.repositoryId,
        scanJobId: context.scanJobId,
        ruleId: "missing-env-example",
        title: "Repository has environment variables but no .env.example",
        category: "environment-hygiene",
        severity: "medium",
        confidence: 0.8,
        stackTags: ["nextjs", "node"],
        affectedFile: ".env",
        evidence: [createEvidence(".env", 1, "Environment file found without a safe .env.example template.")],
        riskExplanation: "Without a committed example file, teams are more likely to share real secrets directly or miss required configuration during deployment.",
        remediationSummary: "Add a `.env.example` file with required variable names and empty placeholder values.",
        autofixAvailable: true
      })
    ];
  }
};

export const unsafeCorsWildcardRule: ScannerRule = {
  id: "unsafe-cors-wildcard",
  run(context) {
    const findings: NormalizedFinding[] = [];
    const corsPatterns = [
      /cors\s*\(\s*\{[^}]*origin\s*:\s*["']\*["']/s,
      /Access-Control-Allow-Origin["']?\s*,\s*["']\*["']/,
      /["']key["']\s*:\s*["']Access-Control-Allow-Origin["'][\s\S]{0,160}["']value["']\s*:\s*["']\*["']/i
    ];

    for (const file of context.files) {
      const match = firstMatchLineAny(file, corsPatterns);
      if (!match) continue;

      findings.push(
        createFinding({
          repositoryId: context.repositoryId,
          scanJobId: context.scanJobId,
          ruleId: "unsafe-cors-wildcard",
          title: "CORS allows requests from any origin",
          category: "unsafe-cors",
          severity: "medium",
          confidence: 0.82,
          stackTags: ["node"],
          affectedFile: file.relativePath,
          evidence: [createEvidence(file.relativePath, match.lineNumber, match.snippet)],
          riskExplanation: "Wildcard CORS can allow untrusted browser origins to read API responses when paired with permissive auth or credential handling.",
          remediationSummary: "Restrict CORS origins to configured application domains and avoid using `*` for authenticated APIs.",
          autofixAvailable: false
        })
      );
    }

    return findings.slice(0, 1);
  }
};

export const missingApiAuthRule: ScannerRule = {
  id: "missing-api-auth",
  run(context) {
    const authPatterns = [/auth\s*\(/, /getServerSession\s*\(/, /currentUser\s*\(/, /requireAuth\s*\(/, /getUser\s*\(/, /verifyAuth\s*\(/];
    const methodPattern = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/;

    return context.files
      .filter((file) => isNextApiRoute(file) && !isWebhookRoute(file))
      .filter((file) => methodPattern.test(file.content) && !hasAny(file.content, authPatterns))
      .slice(0, 1)
      .map((file) =>
        createFinding({
          repositoryId: context.repositoryId,
          scanJobId: context.scanJobId,
          ruleId: "missing-api-auth",
          title: "API route does not enforce authentication",
          category: "missing-auth",
          severity: "high",
          confidence: 0.84,
          stackTags: ["nextjs", "clerk"],
          affectedFile: file.relativePath,
          evidence: [createEvidence(file.relativePath, 1, lineAt(file.content, 1))],
          riskExplanation: "Sensitive API routes without a server-side user check can expose application data or actions to unauthenticated callers.",
          remediationSummary: "Require server-side authentication and add explicit authorization checks before returning sensitive data.",
          autofixAvailable: true
        })
      );
  }
};

export const missingSecurityHeadersRule: ScannerRule = {
  id: "missing-security-headers",
  run(context) {
    if (!hasPackageDependency(context, "next")) return [];

    const securityHeaderPatterns = [/X-Frame-Options/i, /Content-Security-Policy/i, /X-Content-Type-Options/i, /Referrer-Policy/i, /headers\s*\(/];
    const configFiles = context.files.filter((file) => /^(next\.config\.(js|mjs|ts)|vercel\.json|middleware\.(ts|js))$/.test(file.relativePath));
    const hasSecurityHeaders = configFiles.some((file) => hasAny(file.content, securityHeaderPatterns));
    if (hasSecurityHeaders) return [];

    const affectedFile = configFiles[0]?.relativePath ?? "next.config.mjs";

    return [
      createFinding({
        repositoryId: context.repositoryId,
        scanJobId: context.scanJobId,
        ruleId: "missing-security-headers",
        title: "Next.js app does not configure baseline security headers",
        category: "missing-security-headers",
        severity: "medium",
        confidence: 0.72,
        stackTags: ["nextjs", "vercel"],
        affectedFile,
        evidence: [createEvidence(affectedFile, 1, "No baseline security headers found in Next.js config, middleware, or Vercel config.")],
        riskExplanation: "Missing browser security headers leaves the app with weaker default protection against clickjacking, MIME sniffing, and referrer leakage.",
        remediationSummary: "Add baseline headers such as X-Frame-Options, X-Content-Type-Options, Referrer-Policy, and a staged Content-Security-Policy.",
        autofixAvailable: true
      })
    ];
  }
};

export const missingAuthorizationRule: ScannerRule = {
  id: "missing-authorization",
  run(context) {
    const authPatterns = [/auth\s*\(/, /getServerSession\s*\(/, /currentUser\s*\(/, /requireAuth\s*\(/];
    const authorizationPatterns = [/role/i, /permission/i, /organization/i, /orgId/, /isAdmin/, /admin/, /hasAccess/, /authorize\s*\(/];

    return context.files
      .filter((file) => isNextApiRoute(file) && /\/admin\//.test(file.relativePath))
      .filter((file) => hasAny(file.content, authPatterns) && !hasAny(file.content, authorizationPatterns))
      .slice(0, 1)
      .map((file) =>
        createFinding({
          repositoryId: context.repositoryId,
          scanJobId: context.scanJobId,
          ruleId: "missing-authorization",
          title: "Privileged API route authenticates users but does not check authorization",
          category: "missing-authorization",
          severity: "high",
          confidence: 0.78,
          stackTags: ["nextjs", "clerk"],
          affectedFile: file.relativePath,
          evidence: [createEvidence(file.relativePath, 1, lineAt(file.content, 1))],
          riskExplanation: "Authenticated users may still be unprivileged; admin routes need explicit role, permission, or organization checks.",
          remediationSummary: "Add a server-side authorization check for the required role, permission, or organization before returning privileged data.",
          autofixAvailable: false
        })
      );
  }
};

export const dangerousPublicEnvRule: ScannerRule = {
  id: "dangerous-public-env",
  run(context) {
    const pattern = /^NEXT_PUBLIC_[A-Z0-9_]*(SECRET|SERVICE_ROLE|PRIVATE|TOKEN|API_KEY)[A-Z0-9_]*\s*=/gm;

    for (const file of context.files) {
      const match = pattern.exec(file.content);
      pattern.lastIndex = 0;
      if (!match || match.index === undefined) continue;

      const lineNumber = lineNumberForIndex(file.content, match.index);
      return [
        createFinding({
          repositoryId: context.repositoryId,
          scanJobId: context.scanJobId,
          ruleId: "dangerous-public-env",
          title: "Sensitive value is exposed through a public environment variable",
          category: "public-env-secret",
          severity: "high",
          confidence: 0.9,
          stackTags: ["nextjs", "supabase"],
          affectedFile: file.relativePath,
          evidence: [createEvidence(file.relativePath, lineNumber, lineAt(file.content, lineNumber))],
          riskExplanation: "Next.js exposes `NEXT_PUBLIC_` variables to the browser bundle, so secrets or service-role credentials become visible to users.",
          remediationSummary: "Move sensitive values to server-only environment variables and expose only non-sensitive public configuration.",
          autofixAvailable: false
        })
      ];
    }

    return [];
  }
};

export const insecureWebhookHandlerRule: ScannerRule = {
  id: "insecure-webhook-handler",
  run(context) {
    const verificationPatterns = [/constructEvent\s*\(/, /stripe-signature/i, /svix/i, /verifySignature\s*\(/, /x-hub-signature/i, /webhooks\.verify/i];
    const insecureBodyPatterns = [/request\.json\s*\(/, /req\.body/, /await\s+request\.json/];

    return context.files
      .filter((file) => isWebhookRoute(file))
      .filter((file) => hasAny(file.content, insecureBodyPatterns) && !hasAny(file.content, verificationPatterns))
      .slice(0, 1)
      .map((file) => {
        const match = firstMatchLine(file, /request\.json\s*\(/) ?? { lineNumber: 1, snippet: lineAt(file.content, 1) };

        return createFinding({
          repositoryId: context.repositoryId,
          scanJobId: context.scanJobId,
          ruleId: "insecure-webhook-handler",
          title: "Webhook handler does not verify signatures",
          category: "insecure-webhook",
          severity: "high",
          confidence: 0.86,
          stackTags: ["nextjs", "stripe"],
          affectedFile: file.relativePath,
          evidence: [createEvidence(file.relativePath, match.lineNumber, match.snippet)],
          riskExplanation: "Webhook handlers that trust parsed JSON without provider signature verification can accept forged payment or lifecycle events.",
          remediationSummary: "Verify the provider signature against the raw request body before processing the webhook event.",
          autofixAvailable: true
        });
      });
  }
};

export const dependencyRiskPlaceholderRule: ScannerRule = {
  id: "dependency-risk-placeholder",
  run(context) {
    const packageFile = context.files.find((file) => file.relativePath === "package.json");
    const hasLockfile = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"].some((path) => context.hasFile(path));
    if (!packageFile || hasLockfile) return [];

    return [
      createFinding({
        repositoryId: context.repositoryId,
        scanJobId: context.scanJobId,
        ruleId: "dependency-risk-placeholder",
        title: "Dependency risk audit has not been run",
        category: "dependency-risk",
        severity: "info",
        confidence: 0.65,
        stackTags: ["node"],
        affectedFile: packageFile.relativePath,
        evidence: [createEvidence(packageFile.relativePath, 1, "package.json found; dependency vulnerability audit integration is pending.")],
        riskExplanation: "Known vulnerable dependencies are a common startup-stack risk, but this scanner does not yet run package-manager audit tools.",
        remediationSummary: "Run the appropriate dependency audit command in CI and wire its output into AutoCyber as a normalized dependency finding source.",
        autofixAvailable: false
      })
    ];
  }
};

export const unsafeSupabaseUsageRule: ScannerRule = {
  id: "unsafe-supabase-usage",
  run(context) {
    const serviceRolePattern = /SUPABASE_SERVICE_ROLE_KEY|service_role/i;
    const broadSelectPattern = /\.from\s*\([^)]*\)\.select\s*\(\s*["']\*["']\s*\)/s;

    return context.files
      .filter((file) => !file.relativePath.endsWith(".example"))
      .filter((file) => /supabase/i.test(file.content))
      .filter((file) => serviceRolePattern.test(file.content) || broadSelectPattern.test(file.content))
      .slice(0, 1)
      .map((file) => {
        const match = firstMatchLine(file, /SUPABASE_SERVICE_ROLE_KEY|select\s*\(\s*["']\*["']\s*\)/i) ?? { lineNumber: 1, snippet: lineAt(file.content, 1) };

        return createFinding({
          repositoryId: context.repositoryId,
          scanJobId: context.scanJobId,
          ruleId: "unsafe-supabase-usage",
          title: "Supabase usage may bypass safe client boundaries",
          category: "unsafe-supabase",
          severity: "high",
          confidence: 0.82,
          stackTags: ["supabase", "nextjs"],
          affectedFile: file.relativePath,
          evidence: [createEvidence(file.relativePath, match.lineNumber, match.snippet)],
          riskExplanation: "Using service-role credentials or broad table selects in app routes can bypass row-level protections or expose more data than intended.",
          remediationSummary: "Keep service-role keys server-only for narrow admin tasks, prefer user-scoped clients, and select only required columns with authorization checks.",
          autofixAvailable: false
        });
      });
  }
};

export const unsafeStripePaymentStateRule: ScannerRule = {
  id: "unsafe-stripe-payment-state",
  run(context) {
    const clientTrustedPaymentPatterns = [/markOrderPaid\s*\(/, /payment_status/, /checkout.*success/i, /body\.orderId/];
    const serverVerificationPatterns = [/checkout\.sessions\.retrieve\s*\(/, /paymentIntents\.retrieve\s*\(/, /constructEvent\s*\(/];

    return context.files
      .filter((file) => /stripe|checkout|payment/i.test(file.relativePath + file.content))
      .filter((file) => hasAny(file.content, clientTrustedPaymentPatterns) && !hasAny(file.content, serverVerificationPatterns))
      .slice(0, 1)
      .map((file) =>
        createFinding({
          repositoryId: context.repositoryId,
          scanJobId: context.scanJobId,
          ruleId: "unsafe-stripe-payment-state",
          title: "Payment success appears to trust client-controlled state",
          category: "unsafe-stripe",
          severity: "high",
          confidence: 0.78,
          stackTags: ["stripe", "nextjs"],
          affectedFile: file.relativePath,
          evidence: [createEvidence(file.relativePath, 1, lineAt(file.content, 1))],
          riskExplanation: "Client-provided order or checkout state can be forged; fulfillment should rely on Stripe server-side retrieval or verified webhooks.",
          remediationSummary: "Retrieve the Checkout Session or PaymentIntent from Stripe server-side and fulfill only after confirmed paid status.",
          autofixAvailable: false
        })
      );
  }
};

export const unsafeAiApiUsageRule: ScannerRule = {
  id: "unsafe-ai-api-usage",
  run(context) {
    const hardcodedKeyPattern = /apiKey\s*:\s*["']sk-[A-Za-z0-9_-]{12,}/;
    const promptLoggingPattern = /console\.(log|info|debug)\s*\([^)]*(prompt|OPENAI_API_KEY|ANTHROPIC_API_KEY)/is;

    return context.files
      .filter((file) => /openai|anthropic|prompt|OPENAI_API_KEY|ANTHROPIC_API_KEY/.test(file.content))
      .filter((file) => hardcodedKeyPattern.test(file.content) || promptLoggingPattern.test(file.content))
      .slice(0, 1)
      .map((file) => {
        const match = firstMatchLine(file, /apiKey\s*:\s*["']sk-[A-Za-z0-9_-]{12,}|console\.(log|info|debug)/i) ?? { lineNumber: 1, snippet: lineAt(file.content, 1) };

        return createFinding({
          repositoryId: context.repositoryId,
          scanJobId: context.scanJobId,
          ruleId: "unsafe-ai-api-usage",
          title: "AI API usage may expose keys or sensitive prompts",
          category: "unsafe-ai-api-usage",
          severity: "high",
          confidence: 0.84,
          stackTags: ["openai", "anthropic"],
          affectedFile: file.relativePath,
          evidence: [createEvidence(file.relativePath, match.lineNumber, match.snippet)],
          riskExplanation: "Hardcoded AI provider keys and prompt logging can expose credentials or sensitive user input through source control and logs.",
          remediationSummary: "Load provider keys from server-only environment variables and avoid logging raw prompts, API keys, or sensitive model inputs.",
          autofixAvailable: false
        });
      });
  }
};

export const supabaseExposedServiceRoleKeyRule: ScannerRule = {
  id: "supabase-exposed-service-role-key",
  run(context) {
    const pattern = /SUPABASE_SERVICE_ROLE_KEY\s*=\s*["']?[A-Za-z0-9_./+=-]{24,}["']?/i;

    return context.files
      .filter((file) => !file.relativePath.endsWith(".example"))
      .map((file) => ({ file, match: firstMatchLine(file, pattern) }))
      .filter((item): item is { file: ScannedFile; match: { lineNumber: number; snippet: string } } => Boolean(item.match))
      .slice(0, 1)
      .map(({ file, match }) =>
        createFinding({
          repositoryId: context.repositoryId,
          scanJobId: context.scanJobId,
          ruleId: "supabase-exposed-service-role-key",
          title: "Supabase service role key appears committed",
          category: "supabase-secrets",
          severity: "critical",
          confidence: 0.92,
          stackTags: ["supabase"],
          affectedFile: file.relativePath,
          evidence: [createEvidence(file.relativePath, match.lineNumber, match.snippet)],
          riskExplanation: "Supabase service role keys bypass row-level security and can read or modify all project data if copied from source control.",
          remediationSummary: "Remove the committed key, rotate it in Supabase, and keep service role credentials only in server-side environment managers.",
          verificationStrategy: "Rerun the scanner and confirm no Supabase service role key value is present in committed files.",
          autofixAvailable: false
        })
      );
  }
};

export const supabaseServiceRoleInClientRule: ScannerRule = {
  id: "supabase-service-role-in-client",
  run(context) {
    const pattern = /NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY|service_role/i;

    return context.files
      .filter((file) => /\.(ts|tsx|js|jsx)$/.test(file.relativePath))
      .filter((file) => isClientReachableSurface(file) && /supabase|createClient/i.test(file.content) && pattern.test(file.content))
      .slice(0, 1)
      .map((file) => {
        const match = firstMatchLine(file, pattern) ?? { lineNumber: 1, snippet: lineAt(file.content, 1) };
        return createFinding({
          repositoryId: context.repositoryId,
          scanJobId: context.scanJobId,
          ruleId: "supabase-service-role-in-client",
          title: "Supabase service role key is referenced in client code",
          category: "supabase-client-secret",
          severity: "critical",
          confidence: 0.9,
          stackTags: ["supabase", "nextjs"],
          affectedFile: file.relativePath,
          evidence: [createEvidence(file.relativePath, match.lineNumber, match.snippet)],
          riskExplanation: "Client components are bundled for browsers, so service role credentials referenced there can be exposed to users and bypass RLS.",
          remediationSummary: "Move service-role Supabase operations to server-only routes or jobs and use anon keys only in browser code.",
          verificationStrategy: "Confirm the client bundle no longer references service role variables and rerun the local scanner.",
          autofixAvailable: false
        });
      });
  }
};

export const supabasePermissiveRlsPolicyRule: ScannerRule = {
  id: "supabase-permissive-rls-policy",
  run(context) {
    const policyPattern = /create\s+policy[\s\S]{0,240}(using|with\s+check)\s*\(\s*(true|auth\.role\(\)\s*=\s*['"]anon['"])\s*\)/i;

    return context.files
      .filter((file) => file.relativePath.startsWith("supabase/migrations/") && policyPattern.test(file.content))
      .slice(0, 1)
      .map((file) => {
        const match = firstMatchLine(file, /(using|with\s+check)\s*\(\s*(true|auth\.role\(\)\s*=\s*['"]anon['"])\s*\)/i) ?? {
          lineNumber: 1,
          snippet: lineAt(file.content, 1)
        };
        return createFinding({
          repositoryId: context.repositoryId,
          scanJobId: context.scanJobId,
          ruleId: "supabase-permissive-rls-policy",
          title: "Supabase migration contains an overly permissive RLS policy",
          category: "supabase-rls",
          severity: "high",
          confidence: 0.82,
          stackTags: ["supabase"],
          affectedFile: file.relativePath,
          evidence: [createEvidence(file.relativePath, match.lineNumber, match.snippet)],
          riskExplanation: "Policies that allow `true` or anonymous access can expose tenant or user data even when RLS is enabled.",
          remediationSummary: "Replace broad policies with owner, organization, or role-scoped predicates and test with anon and authenticated roles.",
          verificationStrategy: "Review Supabase migrations and rerun the scanner after replacing permissive policy predicates.",
          autofixAvailable: false
        });
      });
  }
};

export const supabaseMissingRlsRule: ScannerRule = {
  id: "supabase-missing-rls",
  run(context) {
    const migrationFiles = context.files.filter((file) => file.relativePath.startsWith("supabase/migrations/"));
    const allMigrations = migrationFiles.map((file) => file.content).join("\n");

    for (const tableFile of migrationFiles) {
      const tablePattern = /create\s+table(?:\s+if\s+not\s+exists)?\s+public\.([a-zA-Z0-9_]+)/gi;
      for (const match of tableFile.content.matchAll(tablePattern)) {
        const tableName = match[1];
        const tableRlsPattern = new RegExp(`alter\\s+table\\s+public\\.${escapeRegex(tableName)}\\s+enable\\s+row\\s+level\\s+security`, "i");
        if (tableRlsPattern.test(allMigrations)) continue;

        const lineNumber = match.index === undefined ? 1 : lineNumberForIndex(tableFile.content, match.index);
        return [
          createFinding({
            repositoryId: context.repositoryId,
            scanJobId: context.scanJobId,
            ruleId: "supabase-missing-rls",
            title: "Supabase migration creates public tables without enabling RLS",
            category: "supabase-rls",
            severity: "medium",
            confidence: 0.7,
            stackTags: ["supabase"],
            affectedFile: tableFile.relativePath,
            evidence: [createEvidence(tableFile.relativePath, lineNumber, lineAt(tableFile.content, lineNumber))],
            riskExplanation: "Public Supabase tables without RLS indicators may allow broader data access than intended, especially in startup apps using anon clients.",
            remediationSummary: "Enable row-level security on public tables and add scoped policies for expected user or organization access.",
            verificationStrategy: "Rerun the scanner and inspect migrations for `alter table ... enable row level security` plus scoped policies.",
            autofixAvailable: false
          })
        ];
      }
    }

    return [];
  }
};

export const nextPublicSensitiveEnvRule: ScannerRule = {
  id: "next-public-sensitive-env",
  run(context) {
    const pattern = /NEXT_PUBLIC_[A-Z0-9_]*(SECRET|SERVICE_ROLE|PRIVATE|TOKEN|API_KEY|STRIPE|OPENAI|ANTHROPIC)[A-Z0-9_]*(\s*=|["'])/i;

    return context.files
      .map((file) => ({ file, match: firstMatchLine(file, pattern) }))
      .filter((item): item is { file: ScannedFile; match: { lineNumber: number; snippet: string } } => Boolean(item.match))
      .slice(0, 1)
      .map(({ file, match }) =>
        createFinding({
          repositoryId: context.repositoryId,
          scanJobId: context.scanJobId,
          ruleId: "next-public-sensitive-env",
          title: "Sensitive-looking value uses a NEXT_PUBLIC environment name",
          category: "next-public-env",
          severity: "high",
          confidence: 0.86,
          stackTags: ["nextjs", "vercel"],
          affectedFile: file.relativePath,
          evidence: [createEvidence(file.relativePath, match.lineNumber, match.snippet)],
          riskExplanation: "Next.js exposes `NEXT_PUBLIC_*` variables to browser bundles, so secret-like names can leak credentials or create unsafe deployment habits.",
          remediationSummary: "Rename sensitive values to server-only environment variables and expose only non-sensitive public configuration.",
          verificationStrategy: "Rerun the scanner and search client bundles for the removed public environment variable name.",
          autofixAvailable: false
        })
      );
  }
};

export const nextClientSecretReferenceRule: ScannerRule = {
  id: "next-client-secret-reference",
  run(context) {
    const pattern = /process\.env\.(OPENAI_API_KEY|ANTHROPIC_API_KEY|STRIPE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL)/;

    return context.files
      .filter((file) => isClientComponent(file) && pattern.test(file.content))
      .slice(0, 1)
      .map((file) => {
        const match = firstMatchLine(file, pattern) ?? { lineNumber: 1, snippet: lineAt(file.content, 1) };
        return createFinding({
          repositoryId: context.repositoryId,
          scanJobId: context.scanJobId,
          ruleId: "next-client-secret-reference",
          title: "Client component references server-only secrets",
          category: "next-client-secret",
          severity: "high",
          confidence: 0.84,
          stackTags: ["nextjs"],
          affectedFile: file.relativePath,
          evidence: [createEvidence(file.relativePath, match.lineNumber, match.snippet)],
          riskExplanation: "Client components execute in browser contexts; server-only secret references indicate credentials may be bundled or misused.",
          remediationSummary: "Move secret-dependent logic into server components, route handlers, or server actions and pass only safe derived values to the client.",
          verificationStrategy: "Rerun the scanner and confirm client components no longer reference server-only environment variables.",
          autofixAvailable: false
        });
      });
  }
};

export const vercelRiskyConfigRule: ScannerRule = {
  id: "vercel-risky-config",
  run(context) {
    const vercelFile = context.files.find((file) => file.relativePath === "vercel.json");
    if (!vercelFile) return [];
    const riskyPattern = /Access-Control-Allow-Origin["']?\s*,?\s*["']?value["']?\s*:\s*["']\*["']|public["']?\s*:\s*true/i;
    if (!riskyPattern.test(vercelFile.content)) return [];
    const match = firstMatchLine(vercelFile, /Access-Control-Allow-Origin|public["']?\s*:\s*true/i) ?? { lineNumber: 1, snippet: lineAt(vercelFile.content, 1) };

    return [
      createFinding({
        repositoryId: context.repositoryId,
        scanJobId: context.scanJobId,
        ruleId: "vercel-risky-config",
        title: "Vercel configuration contains an obvious risky setting",
        category: "vercel-config",
        severity: "medium",
        confidence: 0.72,
        stackTags: ["vercel", "nextjs"],
        affectedFile: vercelFile.relativePath,
        evidence: [createEvidence(vercelFile.relativePath, match.lineNumber, match.snippet)],
        riskExplanation: "Permissive deployment headers or public settings can weaken browser isolation or expose API responses to untrusted origins.",
        remediationSummary: "Restrict deployment headers to trusted origins and review Vercel configuration before production rollout.",
        verificationStrategy: "Rerun the scanner and inspect deployed response headers for the intended restricted configuration.",
        autofixAvailable: false
      })
    ];
  }
};

export const clerkApiMissingAuthRule: ScannerRule = {
  id: "clerk-api-missing-auth",
  run(context) {
    if (!hasIntegration(context, ["@clerk/nextjs"])) return [];
    const authPatterns = [/auth\s*\(/, /currentUser\s*\(/, /clerkClient/, /getAuth\s*\(/];

    return context.files
      .filter((file) => isNextApiRoute(file) && /\/(admin|orgs?|teams?|billing|settings|users?|account|profile)\//.test(file.relativePath))
      .filter((file) => !hasAny(file.content, authPatterns))
      .slice(0, 1)
      .map((file) =>
        createFinding({
          repositoryId: context.repositoryId,
          scanJobId: context.scanJobId,
          ruleId: "clerk-api-missing-auth",
          title: "Clerk-backed API route is missing an auth check",
          category: "clerk-auth",
          severity: "high",
          confidence: 0.82,
          stackTags: ["clerk", "nextjs"],
          affectedFile: file.relativePath,
          evidence: [createEvidence(file.relativePath, 1, lineAt(file.content, 1))],
          riskExplanation: "Sensitive API routes in Clerk apps should verify the signed-in user before returning data or performing actions.",
          remediationSummary: "Call Clerk `auth()` or an equivalent server-side helper at the top of the route and reject unauthenticated requests.",
          verificationStrategy: "Rerun the scanner and call the route without a session to confirm it returns 401.",
          autofixAvailable: true
        })
      );
  }
};

export const clerkMissingOrgAuthorizationRule: ScannerRule = {
  id: "clerk-missing-org-authorization",
  run(context) {
    if (!hasIntegration(context, ["@clerk/nextjs"])) return [];
    const orgRoutePattern = /\/(orgs?|teams?)\/|orgId|organizationId/;
    const orgAuthorizationPatterns = [/orgId\s*[!=]=/, /organizationId\s*[!=]=/, /orgRole/, /orgSlug/, /has\s*\(\s*\{/, /protect\s*\(/];

    return context.files
      .filter((file) => isNextApiRoute(file) && orgRoutePattern.test(file.relativePath + file.content))
      .filter((file) => /auth\s*\(/.test(file.content) && !hasAny(file.content, orgAuthorizationPatterns))
      .slice(0, 1)
      .map((file) =>
        createFinding({
          repositoryId: context.repositoryId,
          scanJobId: context.scanJobId,
          ruleId: "clerk-missing-org-authorization",
          title: "Organization-scoped Clerk route lacks org authorization",
          category: "clerk-authorization",
          severity: "medium",
          confidence: 0.68,
          stackTags: ["clerk", "nextjs"],
          affectedFile: file.relativePath,
          evidence: [createEvidence(file.relativePath, 1, lineAt(file.content, 1))],
          riskExplanation: "User authentication alone does not prove membership in the requested organization or team, so cross-tenant access may be possible.",
          remediationSummary: "Compare Clerk organization context to route parameters or require an org role/permission before returning tenant data.",
          verificationStrategy: "Rerun the scanner and test the route with a user from a different organization.",
          autofixAvailable: false
        })
      );
  }
};

export const clerkMiddlewareGapRule: ScannerRule = {
  id: "clerk-middleware-gap",
  run(context) {
    if (!hasIntegration(context, ["@clerk/nextjs"])) return [];
    const hasSensitiveApiRoutes = context.files.some((file) => isNextApiRoute(file) && /\/(admin|orgs?|teams?|billing|settings)\//.test(file.relativePath));
    if (!hasSensitiveApiRoutes) return [];
    const middleware = context.files.find((file) => /^middleware\.(ts|js)$/.test(file.relativePath));
    if (!middleware || !/clerkMiddleware|authMiddleware/.test(middleware.content) || !/\/api/.test(middleware.content)) {
      return [
        createFinding({
          repositoryId: context.repositoryId,
          scanJobId: context.scanJobId,
          ruleId: "clerk-middleware-gap",
          title: "Clerk middleware may not cover sensitive API routes",
          category: "clerk-middleware",
          severity: "medium",
          confidence: 0.68,
          stackTags: ["clerk", "nextjs"],
          affectedFile: middleware?.relativePath ?? "middleware.ts",
          evidence: [createEvidence(middleware?.relativePath ?? "middleware.ts", 1, "Sensitive API routes found without an obvious Clerk middleware `/api` matcher.")],
          riskExplanation: "Middleware gaps can leave sensitive API routes outside expected authentication or session handling boundaries.",
          remediationSummary: "Configure Clerk middleware matchers to cover sensitive API routes and keep route-level auth checks for defense in depth.",
          verificationStrategy: "Rerun the scanner and confirm middleware matchers include `/api/:path*` or equivalent sensitive API coverage.",
          autofixAvailable: false
        })
      ];
    }

    return [];
  }
};

export const stripeWebhookMissingConstructEventRule: ScannerRule = {
  id: "stripe-webhook-missing-construct-event",
  run(context) {
    if (!hasIntegration(context, ["stripe"])) return [];

    return context.files
      .filter((file) => isWebhookRoute(file) && /stripe|payment|checkout/i.test(file.relativePath + file.content))
      .filter((file) => !/stripe\.webhooks\.constructEvent\s*\(/.test(file.content))
      .slice(0, 1)
      .map((file) => {
        const match = firstMatchLine(file, /(request|req)\.json\s*\(|req\.body/i) ?? { lineNumber: 1, snippet: lineAt(file.content, 1) };
        return createFinding({
          repositoryId: context.repositoryId,
          scanJobId: context.scanJobId,
          ruleId: "stripe-webhook-missing-construct-event",
          title: "Stripe webhook route does not verify with constructEvent",
          category: "stripe-webhook",
          severity: "high",
          confidence: 0.88,
          stackTags: ["stripe", "nextjs"],
          affectedFile: file.relativePath,
          evidence: [createEvidence(file.relativePath, match.lineNumber, match.snippet)],
          riskExplanation: "Stripe webhooks must verify signatures against the raw body; parsed JSON can be forged by attackers.",
          remediationSummary: "Read the raw request body and call `stripe.webhooks.constructEvent` with the Stripe signature header before processing events.",
          verificationStrategy: "Rerun the scanner and send signed and unsigned webhook fixtures to confirm only signed events are accepted.",
          autofixAvailable: true
        });
      });
  }
};

export const stripeClientTrustedPaymentStateRule: ScannerRule = {
  id: "stripe-client-trusted-payment-state",
  run(context) {
    const clientTrustedPaymentPatterns = [/payment_status\s*={0,2}\s*["']paid["']/, /body\.payment_status/, /markOrderPaid\s*\(\s*body\./, /checkout.*success/i];
    const serverVerificationPatterns = [/checkout\.sessions\.retrieve\s*\(/, /paymentIntents\.retrieve\s*\(/, /webhooks\.constructEvent\s*\(/];

    return context.files
      .filter((file) => /stripe|checkout|payment/i.test(file.relativePath + file.content))
      .filter((file) => hasAny(file.content, clientTrustedPaymentPatterns) && !hasAny(file.content, serverVerificationPatterns))
      .slice(0, 1)
      .map((file) =>
        createFinding({
          repositoryId: context.repositoryId,
          scanJobId: context.scanJobId,
          ruleId: "stripe-client-trusted-payment-state",
          title: "Stripe payment flow trusts client-controlled payment state",
          category: "stripe-payment-state",
          severity: "high",
          confidence: 0.8,
          stackTags: ["stripe", "nextjs"],
          affectedFile: file.relativePath,
          evidence: [createEvidence(file.relativePath, 1, lineAt(file.content, 1))],
          riskExplanation: "Fulfillment based on client-provided payment status or order IDs can be forged without server-side Stripe verification.",
          remediationSummary: "Retrieve Checkout Sessions or PaymentIntents from Stripe server-side, or fulfill from verified webhook events only.",
          verificationStrategy: "Rerun the scanner and test that client-modified payment state cannot mark orders paid.",
          autofixAvailable: false
        })
      );
  }
};

export const stripeExposedSecretKeyRule: ScannerRule = {
  id: "stripe-exposed-secret-key",
  run(context) {
    const pattern = /STRIPE_SECRET_KEY\s*=\s*["']?sk_(live|test)_[A-Za-z0-9_./+=-]{12,}["']?/i;

    return context.files
      .filter((file) => !file.relativePath.endsWith(".example"))
      .map((file) => ({ file, match: firstMatchLine(file, pattern) }))
      .filter((item): item is { file: ScannedFile; match: { lineNumber: number; snippet: string } } => Boolean(item.match))
      .slice(0, 1)
      .map(({ file, match }) =>
        createFinding({
          repositoryId: context.repositoryId,
          scanJobId: context.scanJobId,
          ruleId: "stripe-exposed-secret-key",
          title: "Stripe secret key appears committed",
          category: "stripe-secrets",
          severity: "critical",
          confidence: 0.9,
          stackTags: ["stripe"],
          affectedFile: file.relativePath,
          evidence: [createEvidence(file.relativePath, match.lineNumber, match.snippet)],
          riskExplanation: "Committed Stripe secret keys can create charges, read customer data, or modify billing resources outside the app.",
          remediationSummary: "Rotate the Stripe key, remove it from committed files, and keep only placeholders in `.env.example`.",
          verificationStrategy: "Rerun the scanner and confirm no Stripe secret key value remains in committed files.",
          autofixAvailable: false
        })
      );
  }
};

export const aiRouteMissingRateLimitRule: ScannerRule = {
  id: "ai-route-missing-rate-limit",
  run(context) {
    const aiProviderPattern = /OpenAI|Anthropic|OPENAI_API_KEY|ANTHROPIC_API_KEY|responses\.create|messages\.create/;
    const rateLimitPatterns = [/rateLimit/i, /ratelimit/i, /upstash/i, /quota/i, /throttle/i];

    return context.files
      .filter((file) => isNextApiRoute(file) && aiProviderPattern.test(stripCodeComments(file.content)))
      .filter((file) => !hasAny(stripCodeComments(file.content), rateLimitPatterns))
      .slice(0, 1)
      .map((file) =>
        createFinding({
          repositoryId: context.repositoryId,
          scanJobId: context.scanJobId,
          ruleId: "ai-route-missing-rate-limit",
          title: "AI API route lacks an obvious rate limit",
          category: "ai-rate-limit",
          severity: "medium",
          confidence: 0.68,
          stackTags: ["openai", "anthropic", "nextjs"],
          affectedFile: file.relativePath,
          evidence: [createEvidence(file.relativePath, 1, lineAt(file.content, 1))],
          riskExplanation: "Unauthenticated or unthrottled AI routes can be abused to generate large provider bills or degrade service availability.",
          remediationSummary: "Add per-user or per-IP rate limits and quota checks before calling AI providers.",
          verificationStrategy: "Rerun the scanner and exercise the route until rate limits return the expected rejection response.",
          autofixAvailable: false
        })
      );
  }
};

export const aiUnsafePromptLoggingRule: ScannerRule = {
  id: "ai-unsafe-prompt-logging",
  run(context) {
    const pattern = /console\.(log|info|debug)\s*\([^)]*(prompt|messages|input|OPENAI_API_KEY|ANTHROPIC_API_KEY)/is;
    const linePattern = /^.*console\.(log|info|debug)\s*\([^)]*(prompt|messages|input|OPENAI_API_KEY|ANTHROPIC_API_KEY).*$/gim;

    return context.files
      .filter((file) => /prompt|messages|input|OPENAI_API_KEY|ANTHROPIC_API_KEY/.test(file.content) && pattern.test(file.content))
      .slice(0, 1)
      .map((file) => {
        const match = firstMatchLine(file, /console\.(log|info|debug)/i) ?? { lineNumber: 1, snippet: lineAt(file.content, 1) };
        const evidence = Array.from(file.content.matchAll(linePattern))
          .map((lineMatch) => {
            const index = lineMatch.index ?? 0;
            const lineNumber = lineNumberForIndex(file.content, index);
            return createEvidence(file.relativePath, lineNumber, lineAt(file.content, lineNumber));
          })
          .slice(0, 5);
        return createFinding({
          repositoryId: context.repositoryId,
          scanJobId: context.scanJobId,
          ruleId: "ai-unsafe-prompt-logging",
          title: "AI route logs raw prompts or sensitive model inputs",
          category: "ai-logging",
          severity: "medium",
          confidence: 0.76,
          stackTags: ["openai", "anthropic"],
          affectedFile: file.relativePath,
          evidence: evidence.length > 0 ? evidence : [createEvidence(file.relativePath, match.lineNumber, match.snippet)],
          riskExplanation: "Raw prompt and message logs can contain customer data, secrets, or proprietary context that should not enter ordinary logs.",
          remediationSummary: "Remove raw prompt logging or replace it with structured, redacted telemetry that excludes sensitive content.",
          verificationStrategy: "Rerun the scanner and inspect logs from the AI route to confirm prompts are not emitted.",
          autofixAvailable: false
        });
      });
  }
};

export const aiClientSideKeyUsageRule: ScannerRule = {
  id: "ai-client-side-key-usage",
  run(context) {
    const pattern = /OPENAI_API_KEY|ANTHROPIC_API_KEY|new\s+OpenAI|new\s+Anthropic/i;

    return context.files
      .filter((file) => isClientComponent(file) && pattern.test(file.content))
      .slice(0, 1)
      .map((file) => {
        const match = firstMatchLine(file, pattern) ?? { lineNumber: 1, snippet: lineAt(file.content, 1) };
        return createFinding({
          repositoryId: context.repositoryId,
          scanJobId: context.scanJobId,
          ruleId: "ai-client-side-key-usage",
          title: "AI provider key or client is referenced in browser code",
          category: "ai-client-secret",
          severity: "high",
          confidence: 0.86,
          stackTags: ["openai", "anthropic", "nextjs"],
          affectedFile: file.relativePath,
          evidence: [createEvidence(file.relativePath, match.lineNumber, match.snippet)],
          riskExplanation: "AI provider keys used from client components can be extracted by users and abused directly against provider APIs.",
          remediationSummary: "Move AI provider calls behind authenticated server routes with rate limits and keep provider keys server-only.",
          verificationStrategy: "Rerun the scanner and inspect browser bundles to confirm provider keys and SDK clients are absent.",
          autofixAvailable: false
        });
      });
  }
};

export const initialScannerRules: ScannerRule[] = [
  exposedSecretRule,
  missingEnvExampleRule,
  unsafeCorsWildcardRule,
  missingApiAuthRule,
  missingAuthorizationRule,
  missingSecurityHeadersRule,
  dangerousPublicEnvRule,
  insecureWebhookHandlerRule,
  dependencyRiskPlaceholderRule,
  unsafeSupabaseUsageRule,
  unsafeStripePaymentStateRule,
  unsafeAiApiUsageRule,
  supabaseExposedServiceRoleKeyRule,
  supabaseServiceRoleInClientRule,
  supabasePermissiveRlsPolicyRule,
  supabaseMissingRlsRule,
  nextPublicSensitiveEnvRule,
  nextClientSecretReferenceRule,
  vercelRiskyConfigRule,
  clerkApiMissingAuthRule,
  clerkMissingOrgAuthorizationRule,
  clerkMiddlewareGapRule,
  stripeWebhookMissingConstructEventRule,
  stripeClientTrustedPaymentStateRule,
  stripeExposedSecretKeyRule,
  aiRouteMissingRateLimitRule,
  aiUnsafePromptLoggingRule,
  aiClientSideKeyUsageRule
];
