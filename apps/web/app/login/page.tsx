import { SignInButton } from "@clerk/nextjs";
import { PageHeader } from "@/components/page-header";

export default function LoginPage() {
  const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Log in" description="Clerk-backed authentication for AutoCyber product routes." />
      <section className="rounded-lg border border-border bg-white p-6 shadow-surface">
        {clerkConfigured ? (
          <>
            <p className="text-sm leading-6 text-slate-600">Use Clerk to sign in before accessing protected AutoCyber routes.</p>
            <SignInButton mode="modal">
              <button className="mt-4 rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Open Clerk login</button>
            </SignInButton>
          </>
        ) : (
          <p className="text-sm leading-6 text-slate-600">
            Clerk environment variables are not configured. AutoCyber is running in development fallback auth mode.
          </p>
        )}
      </section>
    </div>
  );
}
