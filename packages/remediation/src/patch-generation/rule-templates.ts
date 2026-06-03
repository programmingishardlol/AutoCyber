import type { FixProposalTemplate, RemediationFinding, RemediationRuleId } from "../types";

function advisoryTemplate(input: {
  title(finding: RemediationFinding): string;
  explanation: string;
  action: string;
  risk: string;
  verificationPlan(finding: RemediationFinding): string[];
}): FixProposalTemplate {
  return {
    title: input.title,
    explanation: () => input.explanation,
    proposedPatch: () => `Manual remediation required: ${input.action}`,
    diff: (finding) => `# Advisory only: no automatic patch is safe for ${finding.ruleId ?? finding.category}.
# Affected file: ${finding.affectedFile}
# Recommended action: ${input.action}`,
    risk: () => input.risk,
    filesChanged: (finding) => [finding.affectedFile],
    verificationPlan: input.verificationPlan
  };
}

function firstEvidenceSnippet(finding: RemediationFinding): string {
  return finding.evidence[0]?.snippet.trimEnd() ?? "";
}

function isEnvLikeFile(filePath: string): boolean {
  const fileName = filePath.split("/").pop() ?? filePath;
  return fileName === ".env" || fileName.startsWith(".env.") || fileName.endsWith(".env") || fileName.includes(".env.");
}

function envPublicNameReplacement(snippet: string): { oldLine: string; newLine: string } | null {
  if (snippet.includes("[REDACTED]")) return null;

  const match = snippet.match(/^(\s*(?:export\s+)?)(NEXT_PUBLIC_[A-Z0-9_]*(?:SECRET|API_KEY|SERVICE_ROLE|PRIVATE|TOKEN)[A-Z0-9_]*)(\s*=).*$/i);
  if (!match) return null;

  const [, prefix, publicName, separator] = match;
  const serverOnlyName = publicName.replace(/^NEXT_PUBLIC_/, "");
  return {
    oldLine: snippet,
    newLine: `${prefix}${serverOnlyName}${separator}`
  };
}

function promptLoggingReplacement(snippet: string): { oldLine: string; newLine: string } | null {
  if (!/console\.(log|info|debug)\s*\(/i.test(snippet) || !/(prompt|messages|input|OPENAI_API_KEY|ANTHROPIC_API_KEY)/i.test(snippet)) {
    return null;
  }

  const indent = snippet.match(/^\s*/)?.[0] ?? "";
  return {
    oldLine: snippet,
    newLine: `${indent}// AutoCyber: removed raw prompt logging.`
  };
}

function promptLoggingReplacements(finding: RemediationFinding): { oldLine: string; newLine: string }[] {
  return finding.evidence.map((evidence) => promptLoggingReplacement(evidence.snippet)).filter((replacement): replacement is { oldLine: string; newLine: string } => Boolean(replacement));
}

function stripeJsonParseReplacement(snippet: string): { oldLine: string; newLines: string[] } | null {
  const match = snippet.match(/await\s+([A-Za-z_$][A-Za-z0-9_$]*)\.json\s*\(\s*\)/);
  if (!match) return null;

  const requestName = match[1];
  const indent = snippet.match(/^\s*/)?.[0] ?? "";
  return {
    oldLine: snippet,
    newLines: [
      `${indent}const signature = ${requestName}.headers.get("stripe-signature");`,
      `${indent}const body = await ${requestName}.text();`,
      `${indent}if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {`,
      `${indent}  return new Response("Webhook signature required", { status: 400 });`,
      `${indent}}`,
      `${indent}const event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET);`
    ]
  };
}

export const ruleBasedFixProposalTemplates: Partial<Record<RemediationRuleId, FixProposalTemplate>> = {
  "missing-api-auth": {
    title: (finding) => `Require server-side auth for ${finding.affectedFile}`,
    explanation: () =>
      "This proposal adds a server-side authentication guard before the API route performs sensitive work. It keeps the change narrow and leaves the exact role model for human review.",
    proposedPatch: () => "Import the server auth helper, check for a signed-in user, and return 401 before executing the route body.",
    diff: (finding) => `--- a/${finding.affectedFile}
+++ b/${finding.affectedFile}
@@
+import { auth } from "@clerk/nextjs/server";
+
 export async function GET(request: Request) {
+  const { userId } = await auth();
+  if (!userId) {
+    return new Response("Unauthorized", { status: 401 });
+  }
+
   // existing handler logic
 }`,
    risk: () => "Low to medium. The route becomes stricter, but existing unauthenticated consumers will start receiving 401 responses.",
    filesChanged: (finding) => [finding.affectedFile],
    verificationPlan: (finding) => [
      "Rerun the missing-api-auth scanner rule for the affected route.",
      "Call the route without a session and confirm it returns 401.",
      "Call the route with an authenticated session and confirm the intended response still works.",
      finding.verificationStrategy ?? "Run the app typecheck and relevant route tests."
    ]
  },
  "unsafe-cors-wildcard": {
    title: (finding) => `Restrict CORS origins in ${finding.affectedFile}`,
    explanation: () =>
      "This proposal replaces the wildcard browser origin with an allowlist loaded from environment configuration so only trusted frontend origins can read API responses.",
    proposedPatch: () => "Introduce an allowed origins list and replace `origin: \"*\"` with a runtime origin check.",
    diff: (finding) => `--- a/${finding.affectedFile}
+++ b/${finding.affectedFile}
@@
-app.use(cors({ origin: "*" }));
+const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
+  .split(",")
+  .map((origin) => origin.trim())
+  .filter(Boolean);
+
+app.use(
+  cors({
+    origin(origin, callback) {
+      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
+      return callback(new Error("CORS origin not allowed"));
+    }
+  })
+);`,
    risk: () => "Medium. Misconfigured ALLOWED_ORIGINS can block legitimate browser clients until the deployment environment is updated.",
    filesChanged: (finding) => [finding.affectedFile],
    verificationPlan: (finding) => [
      "Rerun the unsafe-cors-wildcard scanner rule.",
      "Set ALLOWED_ORIGINS to the trusted app URL in local or preview configuration.",
      "Confirm an allowed origin receives CORS headers and an unlisted origin does not.",
      finding.verificationStrategy ?? "Run the relevant API integration tests."
    ]
  },
  "missing-security-headers": {
    title: (finding) => `Add baseline security headers in ${finding.affectedFile}`,
    explanation: () =>
      "This proposal adds standard browser hardening headers through the Next.js headers configuration without changing application logic.",
    proposedPatch: () => "Add a `headers()` export with frame, MIME sniffing, referrer, and permissions policy protections.",
    diff: (finding) => `--- a/${finding.affectedFile}
+++ b/${finding.affectedFile}
@@
 const nextConfig = {
+  async headers() {
+    return [
+      {
+        source: "/(.*)",
+        headers: [
+          { key: "X-Frame-Options", value: "DENY" },
+          { key: "X-Content-Type-Options", value: "nosniff" },
+          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
+          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
+        ]
+      }
+    ];
+  }
`,
    risk: () => "Low. These headers are conservative, but embedded iframe workflows may need a different frame policy.",
    filesChanged: (finding) => [finding.affectedFile],
    verificationPlan: (finding) => [
      "Rerun the missing-security-headers scanner rule.",
      "Run `pnpm typecheck` or the app build to validate the Next.js config.",
      "Inspect a local response and confirm the baseline headers are present.",
      finding.verificationStrategy ?? "Run the app build."
    ]
  },
  "insecure-webhook-handler": {
    title: (finding) => `Verify webhook signatures in ${finding.affectedFile}`,
    explanation: () =>
      "This proposal changes the webhook handler to verify provider signatures against the raw request body before processing the event.",
    proposedPatch: () => "Read the raw body, validate the signature header, and reject unsigned or invalid webhook events.",
    diff: (finding) => `--- a/${finding.affectedFile}
+++ b/${finding.affectedFile}
@@
-const event = await request.json();
+const signature = request.headers.get("stripe-signature");
+const body = await request.text();
+if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
+  return new Response("Webhook signature required", { status: 400 });
+}
+const event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET);
 await handleWebhookEvent(event);`,
    risk: () => "Medium. The handler will reject events until the webhook signing secret is configured in every deployment environment.",
    filesChanged: (finding) => [finding.affectedFile],
    verificationPlan: (finding) => [
      "Rerun the insecure-webhook-handler scanner rule.",
      "Send a webhook fixture with a valid signature and confirm it is accepted.",
      "Send the same payload without the signature and confirm it is rejected.",
      finding.verificationStrategy ?? "Run webhook route tests if available."
    ]
  },
  "dangerous-public-env": {
    title: (finding) => `Move sensitive public environment usage out of ${finding.affectedFile}`,
    explanation: () =>
      "This proposal removes sensitive values from client-exposed environment variables and keeps server-only credentials behind non-public environment names.",
    proposedPatch: () => "Replace `NEXT_PUBLIC_*` usage for sensitive values with server-only environment variables and avoid exposing them to client bundles.",
    diff: (finding) => `--- a/${finding.affectedFile}
+++ b/${finding.affectedFile}
@@
-const apiKey = process.env.NEXT_PUBLIC_API_KEY;
+const apiKey = process.env.API_KEY;
+if (!apiKey) {
+  throw new Error("API_KEY is required");
+}`,
    risk: () => "Medium. Code that currently runs in the browser may need to move behind a server route before it can access server-only configuration.",
    filesChanged: (finding) => [finding.affectedFile],
    verificationPlan: (finding) => [
      "Rerun the dangerous-public-env scanner rule.",
      "Confirm sensitive keys are no longer referenced through NEXT_PUBLIC_* names.",
      "Run the affected app flow and confirm server-side configuration is available.",
      finding.verificationStrategy ?? "Run typecheck and relevant tests."
    ]
  },
  "next-public-sensitive-env": {
    title: (finding) => `Move sensitive public environment name out of ${finding.affectedFile}`,
    explanation: (finding) =>
      isEnvLikeFile(finding.affectedFile)
        ? "This proposal renames a sensitive `NEXT_PUBLIC_*` environment variable to a server-only placeholder. It does not rotate or fetch any provider secret; a human still needs to configure the runtime environment safely."
        : "This is a client/code reference to a sensitive public environment name. Moving it safely usually requires introducing a server route or server action, so AutoCyber provides an advisory plan instead of inventing an app-specific rewrite.",
    proposedPatch: (finding) =>
      isEnvLikeFile(finding.affectedFile) && envPublicNameReplacement(firstEvidenceSnippet(finding))
        ? "Rename the sensitive public environment variable to a server-only placeholder and keep any real value in the environment manager."
        : "Manual remediation required: move the secret-dependent behavior behind server-side code and remove the sensitive `NEXT_PUBLIC_*` reference from browser code.",
    diff: (finding) => {
      const replacement = envPublicNameReplacement(firstEvidenceSnippet(finding));
      if (!isEnvLikeFile(finding.affectedFile) || !replacement) {
        return advisoryTemplate({
          title: () => "",
          explanation: "",
          action: "Move secret-dependent behavior to a server route or server action, then expose only non-sensitive derived values to client code.",
          risk: "",
          verificationPlan: () => []
        }).diff(finding);
      }

      return `--- a/${finding.affectedFile}
+++ b/${finding.affectedFile}
@@
-${replacement.oldLine}
+${replacement.newLine}`;
    },
    risk: (finding) =>
      isEnvLikeFile(finding.affectedFile)
        ? "Medium. Renaming the variable is safe in committed examples, but deployments must be updated so server-only code receives the new value."
        : "Medium to high. Moving client behavior server-side can affect data flow, caching, or rendering, so a human must review the app architecture.",
    filesChanged: (finding) => [finding.affectedFile],
    verificationPlan: (finding) => [
      "Rerun the next-public-sensitive-env scanner rule.",
      "Confirm sensitive values are not referenced through NEXT_PUBLIC_* names.",
      "Inspect browser/client code to confirm the secret is not bundled.",
      finding.verificationStrategy ?? "Run typecheck and the affected app flow."
    ]
  },
  "ai-unsafe-prompt-logging": {
    title: (finding) => `Remove raw AI prompt logging in ${finding.affectedFile}`,
    explanation: () =>
      "This proposal removes an obvious raw prompt or message logging statement while leaving the model request and response flow unchanged. It avoids logging customer prompts, messages, or provider keys to ordinary application logs.",
    proposedPatch: () => "Remove the raw prompt/message log line and keep the route behavior unchanged.",
    diff: (finding) => {
      const replacements = promptLoggingReplacements(finding);
      if (replacements.length === 0) {
        return advisoryTemplate({
          title: () => "",
          explanation: "",
          action: "Review AI route logging manually and remove raw prompt, message, input, or key logging.",
          risk: "",
          verificationPlan: () => []
        }).diff(finding);
      }

      return `--- a/${finding.affectedFile}
+++ b/${finding.affectedFile}
${replacements.map((replacement) => `@@
-${replacement.oldLine}
+${replacement.newLine}`).join("\n")}`;
    },
    risk: () => "Low. Removing raw prompt logging should not change request handling, but teams may need replacement redacted telemetry for debugging.",
    filesChanged: (finding) => [finding.affectedFile],
    verificationPlan: (finding) => [
      "Rerun the ai-unsafe-prompt-logging scanner rule.",
      "Exercise the AI route and confirm prompts/messages are not printed in application logs.",
      "Run relevant route tests or typecheck if available.",
      finding.verificationStrategy ?? "Rerun the scanner after removing raw logging."
    ]
  },
  "ai-route-missing-rate-limit": advisoryTemplate({
    title: (finding) => `Add rate limiting to AI route ${finding.affectedFile}`,
    explanation:
      "This finding needs an app-specific rate-limit or quota design. AutoCyber will not invent a dependency, storage backend, identity model, or billing limit in a generic patch.",
    action: "Add authenticated user or IP-based rate limits and quota checks before calling OpenAI or Anthropic providers.",
    risk: "Manual review required. Incorrect rate limits can block legitimate users, fail open, or miss abuse paths.",
    verificationPlan: (finding) => [
      "Rerun the ai-route-missing-rate-limit scanner rule.",
      "Exercise the route until the configured limit is exceeded and confirm it rejects the request.",
      "Confirm normal authenticated usage remains allowed under the configured quota.",
      finding.verificationStrategy ?? "Run route tests or a manual API smoke test."
    ]
  }),
  "stripe-webhook-missing-construct-event": {
    title: (finding) => `Verify Stripe webhook signatures in ${finding.affectedFile}`,
    explanation: (finding) =>
      stripeJsonParseReplacement(firstEvidenceSnippet(finding))
        ? "This proposal changes a simple parsed-JSON Stripe webhook handler to read the raw body and call `stripe.webhooks.constructEvent` before processing the event."
        : "The webhook shape is not simple enough for a deterministic patch. AutoCyber provides an advisory plan so a human can preserve the existing payment flow while adding signature verification.",
    proposedPatch: (finding) =>
      stripeJsonParseReplacement(firstEvidenceSnippet(finding))
        ? "Replace parsed JSON webhook input with raw body signature verification using `stripe.webhooks.constructEvent`."
        : "Manual remediation required: read the raw body, validate the Stripe signature, and process only verified events.",
    diff: (finding) => {
      const replacement = stripeJsonParseReplacement(firstEvidenceSnippet(finding));
      if (!replacement) {
        return advisoryTemplate({
          title: () => "",
          explanation: "",
          action: "Add raw-body Stripe webhook signature verification without changing payment fulfillment semantics.",
          risk: "",
          verificationPlan: () => []
        }).diff(finding);
      }

      return `--- a/${finding.affectedFile}
+++ b/${finding.affectedFile}
@@
-${replacement.oldLine}
+${replacement.newLines.join("\n+")}`;
    },
    risk: () =>
      "Medium. The handler will reject Stripe events until STRIPE_WEBHOOK_SECRET is configured, and existing tests may need signed webhook fixtures.",
    filesChanged: (finding) => [finding.affectedFile],
    verificationPlan: (finding) => [
      "Rerun the stripe-webhook-missing-construct-event scanner rule.",
      "Confirm an unsigned webhook payload is rejected.",
      "Confirm a signed webhook fixture is accepted and reaches the existing event handling path.",
      finding.verificationStrategy ?? "Run webhook route tests if available."
    ]
  },
  "supabase-service-role-in-client": advisoryTemplate({
    title: (finding) => `Move Supabase service-role usage out of ${finding.affectedFile}`,
    explanation:
      "Supabase service-role credentials bypass RLS and must stay server-only. AutoCyber does not rewrite this automatically because the correct server route, job boundary, and authorization checks depend on the app architecture.",
    action: "Move service-role operations to server-only routes or jobs, keep browser code on the anon key, and rotate any exposed service-role key manually if it was leaked.",
    risk: "Manual review required. Moving data access across client/server boundaries can change authorization, caching, and user-visible behavior.",
    verificationPlan: (finding) => [
      "Rerun the supabase-service-role-in-client scanner rule.",
      "Confirm client bundles no longer reference SUPABASE_SERVICE_ROLE_KEY or service_role.",
      "Confirm server-only code enforces user, organization, or role authorization before privileged Supabase operations.",
      finding.verificationStrategy ?? "Run the affected app flow with a non-admin user."
    ]
  }),
  "clerk-missing-org-authorization": advisoryTemplate({
    title: (finding) => `Add Clerk organization authorization in ${finding.affectedFile}`,
    explanation:
      "The scanner can identify a likely missing organization check, but it does not know the correct tenant parameter, Clerk org context, role, or permission for this app. AutoCyber therefore provides an advisory plan instead of a generic auth rewrite.",
    action: "Compare Clerk organization context to the requested organization/team/admin scope, then require the appropriate role or permission before returning data.",
    risk: "Manual review required. A generic org check can either block valid users or leave cross-tenant access open.",
    verificationPlan: (finding) => [
      "Rerun the clerk-missing-org-authorization scanner rule.",
      "Test with a user from a different organization and confirm access is rejected.",
      "Test with an authorized org member or admin and confirm expected access still works.",
      finding.verificationStrategy ?? "Run route authorization tests if available."
    ]
  }),
  "supabase-permissive-rls-policy": advisoryTemplate({
    title: (finding) => `Replace permissive Supabase RLS policy in ${finding.affectedFile}`,
    explanation:
      "The scanner found a broad RLS predicate such as `using (true)`, but it cannot infer the correct tenant, owner, or role predicate from SQL alone. AutoCyber will not invent a policy that could silently expose or block data.",
    action: "Replace broad RLS predicates with owner, organization, or role-scoped policies that match the application data model.",
    risk: "Manual review required. Incorrect RLS predicates can create data leaks or production access outages.",
    verificationPlan: (finding) => [
      "Rerun the supabase-permissive-rls-policy scanner rule.",
      "Test anon and authenticated Supabase roles against the affected table.",
      "Confirm users can only read or write rows matching the intended owner, organization, or role predicate.",
      finding.verificationStrategy ?? "Review the migration and run Supabase policy tests if available."
    ]
  }),
  "missing-env-example": {
    title: () => "Add a safe .env.example template",
    explanation: () =>
      "This proposal documents required environment variables with placeholders so real secrets do not need to be shared or committed.",
    proposedPatch: () => "Create or update `.env.example` with placeholder values for required configuration keys.",
    diff: () => `--- /dev/null
+++ b/.env.example
@@
+# Safe placeholders only. Do not commit real secrets.
+OPENAI_API_KEY=
+ALLOWED_ORIGINS=http://localhost:3000`,
    risk: () => "Low. The change is documentation/configuration only, but placeholders should match the app's real required variables.",
    filesChanged: () => [".env.example"],
    verificationPlan: (finding) => [
      "Rerun the missing-env-example scanner rule.",
      "Confirm `.env.example` exists and contains placeholders only.",
      "Confirm no real secret values were copied into `.env.example`.",
      finding.verificationStrategy ?? "Rerun the local scanner."
    ]
  },
  "exposed-secret": {
    title: (finding) => `Remove committed secret from ${finding.affectedFile}`,
    explanation: () =>
      "This proposal removes the committed secret value, moves runtime configuration to an environment manager, asks a human to rotate the leaked key manually, and adds a safe placeholder to `.env.example`. AutoCyber does not rotate secrets automatically in Stage 3.",
    proposedPatch: () => "Remove the real secret from the committed file and document a placeholder in `.env.example`.",
    diff: (finding) => `--- a/${finding.affectedFile}
+++ b/${finding.affectedFile}
@@
-OPENAI_API_KEY=sk-proj-[REDACTED]
+OPENAI_API_KEY=
--- a/.env.example
+++ b/.env.example
@@
+OPENAI_API_KEY=`,
    risk: () =>
      "Medium. Removing the committed value is safe, but deployments will fail until the secret is configured in the environment manager and the leaked key is rotated manually.",
    filesChanged: (finding) => Array.from(new Set([finding.affectedFile, ".env.example"])),
    verificationPlan: () => [
      "Rerun the exposed-secret scanner rule.",
      "Confirm the committed file no longer contains a real secret.",
      "Confirm `.env.example` contains only placeholders.",
      "Rotate the leaked key manually in the provider dashboard and update the deployment environment manager."
    ]
  }
};

export function getRuleBasedTemplate(ruleId: string | undefined): FixProposalTemplate | null {
  if (!ruleId) return null;
  return ruleBasedFixProposalTemplates[ruleId] ?? null;
}
