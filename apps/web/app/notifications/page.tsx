import Link from "next/link";
import type { ReactNode } from "react";
import type { Notification, Repository } from "@autocyber/core";
import { PageHeader } from "@/components/page-header";
import { getPersistenceStore } from "@/lib/persistence/store";
import { formatDateTime } from "@/lib/utils";
import { NotificationActions } from "./notification-actions";

export const dynamic = "force-dynamic";

const severityClass = {
  critical: "border-red-300 bg-red-50 text-red-800",
  high: "border-orange-300 bg-orange-50 text-orange-800",
  medium: "border-amber-300 bg-amber-50 text-amber-800",
  low: "border-blue-200 bg-blue-50 text-blue-700",
  info: "border-slate-200 bg-slate-50 text-slate-700"
};

const statusClass = {
  unread: "border-slate-950 bg-slate-950 text-white",
  read: "border-slate-200 bg-slate-50 text-slate-700",
  dismissed: "border-slate-200 bg-white text-slate-400"
};

export default async function NotificationsPage() {
  const store = getPersistenceStore();
  const [notifications, repositories] = await Promise.all([store.listNotifications(), store.listRepositories()]);
  const repositoriesById = new Map(repositories.map((repository) => [repository.id, repository]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Internal monitoring notifications for failed scans, important findings, and completed webhook or pull request scans."
      />

      {notifications.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-white p-8 text-sm text-slate-600">
          No monitoring notifications have been created yet. Push and pull request scans will create notifications when important events occur.
        </div>
      ) : (
        <div className="space-y-4">
          {notifications.map((notification) => (
            <NotificationCard
              key={notification.id}
              notification={notification}
              repository={repositoriesById.get(notification.repositoryId) ?? null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NotificationCard({ notification, repository }: { notification: Notification; repository: Repository | null }) {
  return (
    <article className="rounded-lg border border-border bg-white p-5 shadow-surface">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${severityClass[notification.severity]}`}>
              {notification.severity}
            </span>
            <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${statusClass[notification.status]}`}>
              {notification.status}
            </span>
            <span className="font-mono text-xs text-slate-500">{notification.type}</span>
          </div>
          <h2 className="mt-3 text-base font-semibold text-slate-950">{notification.title}</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">{notification.message}</p>
        </div>

        <div className="flex items-start xl:justify-end">
          <NotificationActions notificationId={notification.id} status={notification.status} />
        </div>
      </div>

      <dl className="mt-5 grid gap-3 border-t border-border pt-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <Detail label="Repository" value={repository ? `${repository.owner}/${repository.name}` : notification.repositoryId} />
        <Detail
          label="Scan"
          value={
            notification.scanJobId ? (
              <Link href="/scans" className="break-all font-mono text-xs font-semibold text-slate-800 underline-offset-2 hover:underline">
                {notification.scanJobId}
              </Link>
            ) : (
              "None"
            )
          }
        />
        <Detail label="Finding" value={notification.findingId ?? "None"} />
        <Detail label="Created" value={formatDateTime(notification.createdAt)} />
        <Detail label="Updated" value={formatDateTime(notification.updatedAt)} />
      </dl>
    </article>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-slate-700">{value}</dd>
    </div>
  );
}
