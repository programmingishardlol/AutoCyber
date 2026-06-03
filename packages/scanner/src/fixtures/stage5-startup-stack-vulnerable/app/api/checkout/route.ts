export async function POST(request: Request) {
  const body = await request.json();
  if (body.payment_status === "paid") {
    await markOrderPaid(body.orderId);
  }
  return Response.json({ ok: true });
}

async function markOrderPaid(orderId: string) {
  return orderId;
}
