import "server-only";
import { getRadarrConfig } from "@/lib/config/radarr";
import { cached, cacheKey } from "@/lib/server/cache";
import { request } from "@/lib/server/http";
import type {
  RadarrHistoryRecord,
  RadarrMovie,
  RadarrSystemStatus,
} from "@/lib/types/radarr";

async function get<T>(path: string): Promise<T> {
  const { url, apiKey } = getRadarrConfig();
  return cached(cacheKey("radarr", url, apiKey, path), 30_000, () =>
    request(
      "Radarr",
      url + path,
      { headers: { "X-Api-Key": apiKey } },
      (r) => r.json() as Promise<T>,
    ),
  );
}
export const getSystemStatus = () =>
  get<RadarrSystemStatus>("/api/v3/system/status");
export const getMovies = () => get<RadarrMovie[]>("/api/v3/movie");
export const getMovie = (id: number) => get<RadarrMovie>(`/api/v3/movie/${id}`);
export async function getMovieHistory(
  id: number,
): Promise<RadarrHistoryRecord[]> {
  const records = await get<RadarrHistoryRecord[]>(
    `/api/v3/history/movie?movieId=${id}`,
  );
  if (!Array.isArray(records))
    throw new Error("Radarr: invalid movie history response.");
  return records.filter((record) => record.movieId === id);
}

/** One batched history query for the visible page, never one request per library movie. */
export async function getHistoryForMovies(
  ids: number[],
): Promise<RadarrHistoryRecord[]> {
  if (!ids.length) return [];
  const query = new URLSearchParams();
  ids.forEach((id) => query.append("movieIds", String(id)));
  const records: RadarrHistoryRecord[] = [];
  const started = Date.now();
  for (let page = 1; page <= 10; page++) {
    if (Date.now() - started > 5000)
      throw new Error(
        "History lookup is taking too long. Open a movie for its history.",
      );
    const result = await get<{
      records: RadarrHistoryRecord[];
      totalRecords: number;
    }>(
      `/api/v3/history?${query}&page=${page}&pageSize=250&sortKey=date&sortDirection=descending`,
    );
    if (!Array.isArray(result.records) || !Number.isFinite(result.totalRecords))
      throw new Error("Radarr: invalid history response.");
    records.push(...result.records);
    if (records.length >= result.totalRecords)
      return records.filter((record) => ids.includes(record.movieId));
    if (!result.records.length) break;
  }
  throw new Error(
    "Radarr history exceeds the preview limit; open a movie for its complete history.",
  );
}
