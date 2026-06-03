import { SignInButton, SignOutButton, UserButton } from "@clerk/nextjs";

export function AuthControls() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">Dev user</div>;
  }

  return (
    <div className="flex items-center gap-2">
      <SignInButton mode="modal">
        <button className="rounded-md border border-border px-3 py-2 text-xs font-semibold text-slate-700">Log in</button>
      </SignInButton>
      <UserButton />
      <SignOutButton>
        <button className="rounded-md border border-border px-3 py-2 text-xs font-semibold text-slate-700">Log out</button>
      </SignOutButton>
    </div>
  );
}
