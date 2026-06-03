export async function POST(request: Request) {
  const event = await request.json();
  return Response.json({ received: event.type });
}
