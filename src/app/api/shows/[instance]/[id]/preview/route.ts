import { prepareSeriesDeletion } from "@/lib/services/series-deletion-preflight";
import { isSonarrInstance } from "@/lib/types/sonarr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const response = (body: object, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ instance: string; id: string }> },
) {
  try {
    const { instance, id } = await params;
    if (
      !isSonarrInstance(instance) ||
      !/^[1-9]\d*$/.test(id) ||
      !Number.isSafeInteger(Number(id))
    )
      return response({ error: "Invalid Sonarr instance or series ID." }, 400);

    // This path only reads upstream services and native NAS metadata. It does
    // not create a confirmation token, journal, lock, or mutation request.
    return response({
      plan: await prepareSeriesDeletion(instance, Number(id)),
    });
  } catch (error) {
    return response(
      {
        error:
          error instanceof Error
            ? error.message
            : "Read-only series safety checks failed.",
      },
      409,
    );
  }
}
