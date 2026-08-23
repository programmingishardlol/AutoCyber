import { NextResponse } from "next/server";
import { getPersistenceStore } from "../../../../lib/persistence/store";

export const runtime = "nodejs";

type FalsePositiveInput = {
  findingId?: unknown;
  note?: unknown;
};

export async function POST(request: Request) {
  let input: FalsePositiveInput;

  try {
    input = (await request.json()) as FalsePositiveInput;
  } catch {
    return NextResponse.json(
      {
        error: "invalid false positive request",
        message: "Request body must be valid JSON.",
      },
      { status: 400 },
    );
  }

  if (typeof input.findingId !== "string" || !input.findingId) {
    return NextResponse.json(
      {
        error: "invalid false positive request",
        message: "A findingId is required.",
      },
      { status: 400 },
    );
  }

  const finding = await getPersistenceStore().markFindingFalsePositive(
    input.findingId,
    typeof input.note === "string" ? input.note : null,
  );
  if (!finding) {
    return NextResponse.json(
      {
        error: "finding not found",
        message: "AutoCyber could not find that finding.",
      },
      { status: 404 },
    );
  }

  return NextResponse.json({ finding }, { status: 200 });
}
