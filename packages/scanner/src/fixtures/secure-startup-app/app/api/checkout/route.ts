import Stripe from "stripe";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");

export async function POST(request: Request) {
  const user = await auth();
  if (!user.userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const body = await request.json();
  const session = await stripe.checkout.sessions.retrieve(body.sessionId);

  if (session.payment_status !== "paid") {
    return new NextResponse("Payment required", { status: 402 });
  }

  return NextResponse.json({ ok: true });
}
