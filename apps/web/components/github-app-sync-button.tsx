"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type SyncState =
  | { status: "idle"; message: null }
  | { status: "syncing"; message: null }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

interface GitHubAppSyncButtonProps {
  className?: string;
}

export function GitHubAppSyncButton({ className }: GitHubAppSyncButtonProps) {
  const router = useRouter();
  const [state, setState] = useState<SyncState>({ status: "idle", message: null });

  async function syncRepositories() {
    setState({ status: "syncing", message: null });

    try {
      const response = await fetch("/api/github-app/sync", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        body: JSON.stringify({})
      });
      const body = (await response.json().catch(() => ({}))) as {
        message?: unknown;
        repositoriesConnected?: unknown;
        repositoriesDisconnected?: unknown;
      };

      if (!response.ok) {
        setState({
          status: "error",
          message: safeMessage(body.message) ?? "GitHub App repository sync failed. Check GitHub App credentials and try again."
        });
        return;
      }

      const connected = Number(body.repositoriesConnected ?? 0);
      const disconnected = Number(body.repositoriesDisconnected ?? 0);
      setState({
        status: "success",
        message: `GitHub App repositories synced. ${connected} connected, ${disconnected} disconnected.`
      });
      router.refresh();
    } catch {
      setState({
        status: "error",
        message: "GitHub App repository sync failed. Check GitHub App credentials and try again."
      });
    }
  }

  return (
    <div className="space-y-2">
      <button
        className={className ?? "inline-flex rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"}
        type="button"
        onClick={syncRepositories}
        disabled={state.status === "syncing"}
      >
        {state.status === "syncing" ? "Syncing..." : "Sync GitHub App repositories"}
      </button>
      {state.message ? (
        <p
          className={`max-w-md text-xs font-medium ${state.status === "error" ? "text-red-700" : "text-emerald-700"}`}
          role="status"
          aria-live="polite"
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

function safeMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.length > 180 ? `${value.slice(0, 180)}...` : value;
}
