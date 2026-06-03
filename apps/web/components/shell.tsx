import {
  Brain,
  CheckCircle2,
  FileWarning,
  GitPullRequest,
  Home,
  KeyRound,
  ListChecks,
  Puzzle,
  Radar,
  ScanSearch,
  Settings,
  ShieldCheck,
  Workflow
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { AuthControls } from "@/components/auth-controls";

const navItems = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/projects", label: "Projects", icon: ShieldCheck },
  { href: "/repositories", label: "Repositories", icon: Radar },
  { href: "/scanner", label: "Repo scanner", icon: ScanSearch },
  { href: "/scans", label: "Scans", icon: ScanSearch },
  { href: "/findings", label: "Findings", icon: FileWarning },
  { href: "/fix-proposals", label: "Fix proposals", icon: ListChecks },
  { href: "/verification", label: "Verification", icon: CheckCircle2 },
  { href: "/pull-requests", label: "Pull requests", icon: GitPullRequest },
  { href: "/integrations", label: "Integrations", icon: Puzzle },
  { href: "/memory", label: "Security memory", icon: Brain },
  { href: "/workflows", label: "Workflows", icon: Workflow },
  { href: "/settings", label: "Settings", icon: Settings }
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-border bg-white lg:block">
        <div className="border-b border-border px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-950 text-white">
              <KeyRound className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <div className="font-semibold text-slate-950">AutoCyber</div>
              <div className="text-xs text-slate-500">Stage 5D infrastructure</div>
            </div>
          </div>
          <div className="mt-4">
            <AuthControls />
          </div>
        </div>
        <nav className="space-y-1 px-3 py-4">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-950"
            >
              <item.icon className="h-4 w-4" aria-hidden="true" />
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 border-b border-border bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
          <div className="font-semibold text-slate-950">AutoCyber</div>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
