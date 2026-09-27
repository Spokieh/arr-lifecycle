export function GET() {
  return Response.json({ status: "ok", mode: "read-only" });
}
