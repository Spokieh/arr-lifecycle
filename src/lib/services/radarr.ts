import { getMovies, getSystemStatus } from "@/lib/clients/radarr";
import type { RadarrMovie, RadarrSystemStatus } from "@/lib/types/radarr";

export interface RadarrOverview {
  movies: RadarrMovie[];
  status: RadarrSystemStatus | null;
  error: string | null;
}

export async function getRadarrOverview(): Promise<RadarrOverview> {
  const [moviesResult, statusResult] = await Promise.allSettled([
    getMovies(),
    getSystemStatus(),
  ]);

  const movies = moviesResult.status === "fulfilled" ? moviesResult.value : [];
  const status =
    statusResult.status === "fulfilled" ? statusResult.value : null;
  const errorResult =
    moviesResult.status === "rejected" ? moviesResult : statusResult;

  return {
    movies,
    status,
    error:
      errorResult.status === "rejected"
        ? getErrorMessage(errorResult.reason)
        : null,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Radarr is unavailable.";
}
