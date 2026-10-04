import {
  deletionEnabled,
  seriesDeletionEnabled,
} from "@/lib/server/deletion-access";

export function GET() {
  const movies = deletionEnabled();
  const series = seriesDeletionEnabled();
  return Response.json({
    status: "ok",
    mode: movies || series ? "deletion-enabled" : "read-only",
    deletion: { movies, series },
  });
}
