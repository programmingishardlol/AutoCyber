import { NextResponse } from "next/server";
import { getPersistenceStore } from "../../../lib/persistence/store";

export const runtime = "nodejs";

type NotificationActionInput = {
  notificationId?: unknown;
  action?: unknown;
};

export async function POST(request: Request) {
  let input: NotificationActionInput;

  try {
    input = (await request.json()) as NotificationActionInput;
  } catch {
    return NextResponse.json(
      {
        error: "invalid notification action",
        message: "Request body must be valid JSON."
      },
      { status: 400 }
    );
  }

  if (typeof input.notificationId !== "string" || !input.notificationId) {
    return NextResponse.json(
      {
        error: "invalid notification action",
        message: "A notificationId is required."
      },
      { status: 400 }
    );
  }

  if (input.action !== "read" && input.action !== "dismiss") {
    return NextResponse.json(
      {
        error: "invalid notification action",
        message: "Use action `read` or `dismiss`."
      },
      { status: 400 }
    );
  }

  const store = getPersistenceStore();
  const notification =
    input.action === "read"
      ? await store.markNotificationRead(input.notificationId)
      : await store.dismissNotification(input.notificationId);

  if (!notification) {
    return NextResponse.json(
      {
        error: "notification not found",
        message: "AutoCyber could not find that notification."
      },
      { status: 404 }
    );
  }

  return NextResponse.json({ notification }, { status: 200 });
}
