export async function GET() {
  return Response.json({ users: [] });
}

export async function POST() {
  return Response.json({ created: true });
}
