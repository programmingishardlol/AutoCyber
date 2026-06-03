import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(request: Request) {
  const { sessionId } = await request.json();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  return Response.json({ paid: session.payment_status === "paid" });
}
