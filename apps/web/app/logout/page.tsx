import { SignOutButton } from "@clerk/nextjs";
import { PageHeader } from "@/components/page-header";

export default function LogoutPage() {
  const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Log out" description="End the current Clerk session." />
      <section className="rounded-lg border border-border bg-white p-6 shadow-surface">
        {clerkConfigured ? (
          <SignOutButton>
            <button className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Log out</button>
          </SignOutButton>
        ) : (
          <p className="text-sm leading-6 text-slate-600">Development fallback auth mode does not create a Clerk session.</p>
        )}
      </section>
    </div>
  );
}
