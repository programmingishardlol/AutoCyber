import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json();

  await markOrderPaid(body.orderId);

  return NextResponse.json({ ok: true });
}

async function markOrderPaid(_orderId: string) {
  return true;
}
