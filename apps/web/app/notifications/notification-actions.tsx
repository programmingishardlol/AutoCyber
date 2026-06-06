"use client";

import { useState } from "react";

export function NotificationActions({ notificationId, status }: { notificationId: string; status: string }) {
  const [loadingAction, setLoadingAction] = useState<"read" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: "read" | "dismiss") {
    setLoadingAction(action);
    setError(null);
    const response = await fetch("/api/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notificationId, action })
    });

    if (!response.ok) {
      setError("Notification action failed.");
      setLoadingAction(null);
      return;
    }

    window.location.reload();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => submit("read")}
          disabled={status !== "unread" || loadingAction !== null}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          {loadingAction === "read" ? "Marking..." : "Mark read"}
        </button>
        <button
          type="button"
          onClick={() => submit("dismiss")}
          disabled={status === "dismissed" || loadingAction !== null}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          {loadingAction === "dismiss" ? "Dismissing..." : "Dismiss"}
        </button>
      </div>
      {error ? <p className="text-xs font-medium text-red-700">{error}</p> : null}
    </div>
  );
}
