import type {
  FindingLifecycleStatus,
  FindingMemoryStatus,
  FindingStatus,
  FixProposalStatus,
  IntegrationStatus,
  PriorityBand,
  PullRequestStatus,
  ScanStatus,
  Severity,
  VerificationStatus,
} from "@autocyber/core";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type BadgeTone = "red" | "orange" | "yellow" | "green" | "blue" | "gray";

const toneStyles: Record<BadgeTone, string> = {
  red: "border-red-200 bg-red-50 text-red-700",
  orange: "border-orange-200 bg-orange-50 text-orange-700",
  yellow: "border-yellow-200 bg-yellow-50 text-yellow-700",
  green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  blue: "border-sky-200 bg-sky-50 text-sky-700",
  gray: "border-slate-200 bg-slate-50 text-slate-700",
};

export function Badge({
  children,
  tone = "gray",
}: {
  children: ReactNode;
  tone?: BadgeTone;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium",
        toneStyles[tone],
      )}
    >
      {children}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const tone: Record<Severity, BadgeTone> = {
    critical: "red",
    high: "orange",
    medium: "yellow",
    low: "green",
    info: "blue",
  };

  return <Badge tone={tone[severity]}>{severity}</Badge>;
}

export function PriorityBadge({
  priorityBand,
}: {
  priorityBand: PriorityBand;
}) {
  const tone: Record<PriorityBand, BadgeTone> = {
    critical_action: "red",
    high_priority: "orange",
    review_needed: "yellow",
    monitor: "blue",
    resolved: "green",
  };

  return (
    <Badge tone={tone[priorityBand]}>{priorityBand.replaceAll("_", " ")}</Badge>
  );
}

type Status =
  | FindingStatus
  | FindingLifecycleStatus
  | FindingMemoryStatus
  | FixProposalStatus
  | IntegrationStatus
  | PullRequestStatus
  | ScanStatus
  | VerificationStatus;

export function StatusBadge({ status }: { status: Status }) {
  const greenStatuses: Status[] = [
    "completed",
    "passed",
    "connected",
    "approved",
    "merged",
    "resolved",
    "existing",
  ];
  const yellowStatuses: Status[] = [
    "running",
    "queued",
    "draft",
    "open",
    "triaged",
    "fix_proposed",
    "new",
    "reappeared",
  ];
  const redStatuses: Status[] = ["failed", "needs_attention", "rejected"];
  const tone = greenStatuses.includes(status)
    ? "green"
    : yellowStatuses.includes(status)
      ? "yellow"
      : redStatuses.includes(status)
        ? "red"
        : "gray";

  return <Badge tone={tone}>{status.replaceAll("_", " ")}</Badge>;
}
