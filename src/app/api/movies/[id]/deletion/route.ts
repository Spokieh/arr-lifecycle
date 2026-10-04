import { authorizeDeletion, deletionBody } from "@/lib/server/deletion-access";
import { readOperation } from "@/lib/server/deletion-store";
import {
  executeDeletion,
  prepareDeletion,
} from "@/lib/services/movie-deletion";

export const runtime = "nodejs";
const response = (body: object, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authorizeDeletion(request);
  } catch (error) {
    return response(
      {
        error:
          error instanceof Error ? error.message : "Deletion access denied.",
      },
      403,
    );
  }
  try {
    const { id } = await params;
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))
      return response({ error: "Invalid movie ID." }, 400);
    const body = await deletionBody(request);
    if (body.action === "prepare")
      return response({ prepared: await prepareDeletion(Number(id)) });
    if (body.action === "execute")
      return response({
        operation: await executeDeletion(
          Number(id),
          body.token,
          body.confirmation,
          body.acknowledged,
        ),
      });
    if (body.action === "status" && typeof body.operationId === "string") {
      const operation = await readOperation(body.operationId);
      if (operation.movieId !== Number(id))
        return response(
          { error: "Operation does not belong to this movie." },
          404,
        );
      return response({ operation });
    }
    return response({ error: "Unknown deletion action." }, 400);
  } catch (error) {
    // File-system errors can contain server paths; only domain/API errors are returned.
    const message =
      error instanceof Error && !("code" in error)
        ? error.message
        : "Deletion could not continue. Inspect the operation journal.";
    return response({ error: message }, 409);
  }
}
