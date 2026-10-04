import {
  authorizeDeletion,
  deletionBody,
  seriesDeletionEnabled,
} from "@/lib/server/deletion-access";
import { readOperation } from "@/lib/server/deletion-store";
import {
  prepareSeriesRemoval,
  executeSeriesRemoval,
} from "@/lib/services/series-deletion";
import { isSonarrInstance } from "@/lib/types/sonarr";
import type { SeriesDeletionOperation } from "@/lib/types/series-deletion";

export const runtime = "nodejs";
const response = (body: object, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(
  request: Request,
  { params }: { params: Promise<{ instance: string; id: string }> },
) {
  try {
    await authorizeDeletion(request, seriesDeletionEnabled());
  } catch (error) {
    return response(
      {
        error:
          error instanceof Error
            ? error.message
            : "Series deletion unavailable.",
      },
      403,
    );
  }
  try {
    const { instance, id } = await params;
    if (
      !isSonarrInstance(instance) ||
      !/^[1-9]\d*$/.test(id) ||
      !Number.isSafeInteger(Number(id))
    )
      return response({ error: "Invalid Sonarr instance or series ID." }, 400);
    const body = await deletionBody(request);
    if (body.action === "prepare")
      return response({
        prepared: await prepareSeriesRemoval(instance, Number(id)),
      });
    if (body.action === "execute")
      return response({
        operation: await executeSeriesRemoval(
          instance,
          Number(id),
          body.token,
          body.confirmation,
          body.acknowledged,
        ),
      });
    if (body.action === "status" && typeof body.operationId === "string") {
      const operation = await readOperation<SeriesDeletionOperation>(
        body.operationId,
      );
      if (
        operation.kind !== "series" ||
        operation.instance !== instance ||
        operation.seriesId !== Number(id)
      )
        return response(
          {
            error:
              "Operation belongs to another media item or Sonarr instance.",
          },
          404,
        );
      return response({ operation });
    }
    return response({ error: "Unknown series deletion action." }, 400);
  } catch (error) {
    return response(
      {
        error:
          error instanceof Error && !("code" in error)
            ? error.message
            : "Series deletion stopped. Inspect the operation journal.",
      },
      409,
    );
  }
}
