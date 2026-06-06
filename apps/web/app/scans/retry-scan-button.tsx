"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";

export function RetryScanButton({ scanJobId }: { scanJobId: string }) {
  const [status, setStatus] = useState<"idle" | "retrying" | "queued" | "failed">("idle");

  async function retryScan() {
    setStatus("retrying");
    const response = await fetch("/api/scans/retry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scanJobId })
    });

    if (!response.ok) {
      setStatus("failed");
      return;
    }

    setStatus("queued");
    window.location.reload();
  }

  return (
    <button
      type="button"
      onClick={retryScan}
      disabled={status === "retrying" || status === "queued"}
      className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      title="Retry failed scan"
    >
      <RotateCcw className="h-4 w-4" aria-hidden="true" />
      {status === "retrying" ? "Retrying" : status === "queued" ? "Queued" : "Retry"}
    </button>
  );
}
