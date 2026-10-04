import "server-only";

export function deletionEnabled() {
  return process.env.MOVIE_DELETION_ENABLED === "true";
}
export function seriesDeletionEnabled() {
  return process.env.SERIES_DELETION_ENABLED === "true";
}

export async function authorizeDeletion(
  request: Request,
  enabled = deletionEnabled(),
) {
  if (!enabled) throw new Error("Deletion is disabled on this server.");
  const origin = process.env.APP_ORIGIN;
  if (
    !origin ||
    request.headers.get("origin") !== origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new Error("Deletion request origin rejected.");
}

export async function deletionBody(
  request: Request,
): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new Error("JSON body required.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Request body required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) throw new Error("Request too large.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("Invalid request.");
  return body as Record<string, unknown>;
}
