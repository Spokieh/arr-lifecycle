import "server-only";
import { getRadarrConfig } from "../config/radarr";
import { getSonarrConfig } from "../config/sonarr";
import { qbittorrentRequest } from "./qbittorrent";
import { ApiError, request } from "../server/http";
import { requireCondition } from "../deletion-policy";
import { deletionEnabled } from "../server/deletion-access";
import type { RadarrMovie, RadarrHistoryRecord } from "../types/radarr";
import type { QBittorrentTorrent } from "../types/qbittorrent";
import type { SonarrSeries, SonarrInstance } from "../types/sonarr";

type ArrConfig = { url: string; apiKey: string };
export async function read<T>(config: ArrConfig, path: string): Promise<T> {
  return request(
    "Deletion preflight",
    config.url + path,
    { method: "GET", headers: { "X-Api-Key": config.apiKey } },
    (response) => response.json(),
  );
}
function id(value: number) {
  requireCondition(
    Number.isSafeInteger(value) && value > 0,
    "Invalid movie ID.",
  );
  return value;
}
function hash(value: string) {
  requireCondition(
    /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value),
    "Invalid torrent hash.",
  );
  return value;
}

export const freshMovie = (movieId: number) =>
  read<RadarrMovie>(getRadarrConfig(), `/api/v3/movie/${id(movieId)}`);
export const freshMovies = () =>
  read<RadarrMovie[]>(getRadarrConfig(), "/api/v3/movie");
export const freshMovieHistory = (movieId: number) =>
  read<RadarrHistoryRecord[]>(
    getRadarrConfig(),
    `/api/v3/history/movie?movieId=${id(movieId)}`,
  );
export const freshMediaSettings = () =>
  read<{ recycleBin: string }>(
    getRadarrConfig(),
    "/api/v3/config/mediamanagement",
  );
export const freshSeries = (instance: SonarrInstance) =>
  read<SonarrSeries[]>(getSonarrConfig(instance), "/api/v3/series");
export const freshTorrents = () =>
  qbittorrentRequest<QBittorrentTorrent[]>(
    "/api/v2/torrents/info",
    { method: "GET" },
    (response) => response.json(),
  );
export const freshTorrentFiles = (torrentHash: string) =>
  qbittorrentRequest<Array<{ name: string; size: number; progress: number }>>(
    `/api/v2/torrents/files?hash=${hash(torrentHash)}`,
    { method: "GET" },
    (response) => response.json(),
  );

/** Hash-filtered, complete and uncached. Query both cases for case-sensitive databases. */
export async function hashOwners(
  torrentHash: string,
  instance?: SonarrInstance,
) {
  const config = instance ? getSonarrConfig(instance) : getRadarrConfig();
  const rows: Array<{
    movieId?: number;
    seriesId?: number;
    episodeId?: number;
    downloadId: string;
  }> = [];
  for (const spelling of new Set([
    hash(torrentHash),
    torrentHash.toUpperCase(),
  ])) {
    let complete = false;
    let count = 0;
    for (let page = 1; page <= 5; page++) {
      const data = await read<{ totalRecords: number; records: typeof rows }>(
        config,
        `/api/v3/history?downloadId=${spelling}&page=${page}&pageSize=1000&sortKey=date&sortDirection=descending`,
      );
      requireCondition(
        data &&
          Array.isArray(data.records) &&
          Number.isSafeInteger(data.totalRecords) &&
          data.totalRecords >= 0,
        "Invalid hash ownership history.",
      );
      requireCondition(
        data.records.every(
          (record) =>
            record &&
            typeof record.downloadId === "string" &&
            record.downloadId.toLowerCase() === torrentHash,
        ),
        "History service did not honor the hash filter.",
      );
      rows.push(...data.records);
      count += data.records.length;
      if (count >= data.totalRecords) {
        complete = true;
        break;
      }
      if (!data.records.length) break;
    }
    requireCondition(
      complete,
      "Hash ownership history exceeds the inspection limit.",
    );
  }
  return rows;
}

export async function movieIsAbsent(movieId: number) {
  try {
    await freshMovie(movieId);
    return false;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return true;
    throw error;
  }
}

export async function removeTorrentAndData(torrentHash: string) {
  requireCondition(deletionEnabled(), "Movie deletion is disabled.");
  await qbittorrentRequest(
    "/api/v2/torrents/delete",
    {
      method: "POST",
      body: new URLSearchParams({
        hashes: hash(torrentHash),
        deleteFiles: "true",
      }),
    },
    async () => undefined,
  );
}

export async function removeMovieRecord(movieId: number) {
  requireCondition(deletionEnabled(), "Movie deletion is disabled.");
  const { url, apiKey } = getRadarrConfig();
  await request(
    "Radarr deletion",
    `${url}/api/v3/movie/${id(movieId)}?deleteFiles=false&addImportExclusion=false`,
    { method: "DELETE", headers: { "X-Api-Key": apiKey } },
    async () => undefined,
    15_000,
  );
}
