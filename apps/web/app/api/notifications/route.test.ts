import { beforeEach, describe, expect, it } from "vitest";
import { getPersistenceStore } from "../../../lib/persistence/store";
import { POST } from "./route";

describe("notifications API route", () => {
  beforeEach(() => {
    globalThis.__autocyberPersistenceStore = undefined;
  });

  it("marks a notification read through a safe direct API call", async () => {
    const notification = await getPersistenceStore().createNotification({
      repositoryId: "repo_demo",
      scanJobId: "scan_demo",
      findingId: null,
      type: "scan_failed",
      severity: "high",
      title: "Scan failed",
      message: "AutoCyber could not complete the monitoring scan."
    });

    const response = await POST(
      new Request("http://localhost/api/notifications", {
        method: "POST",
        body: JSON.stringify({ notificationId: notification.id, action: "read" })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.notification.status).toBe("read");
    expect(getPersistenceStore().snapshot().auditLogs.map((log) => log.action)).toContain("notification_read");
  });

  it("dismisses a notification through a safe direct API call", async () => {
    const notification = await getPersistenceStore().createNotification({
      repositoryId: "repo_demo",
      scanJobId: "scan_demo",
      findingId: null,
      type: "new_findings_detected",
      severity: "medium",
      title: "New findings detected",
      message: "New findings were detected."
    });

    const response = await POST(
      new Request("http://localhost/api/notifications", {
        method: "POST",
        body: JSON.stringify({ notificationId: notification.id, action: "dismiss" })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.notification.status).toBe("dismissed");
    expect(getPersistenceStore().snapshot().auditLogs.map((log) => log.action)).toContain("notification_dismissed");
  });

  it("rejects invalid notification actions without exposing stack traces", async () => {
    const response = await POST(
      new Request("http://localhost/api/notifications", {
        method: "POST",
        body: JSON.stringify({ notificationId: "notification_missing", action: "archive" })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid notification action");
    expect(JSON.stringify(body)).not.toContain("Error:");
  });
});
