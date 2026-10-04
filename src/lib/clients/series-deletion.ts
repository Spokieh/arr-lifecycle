import "server-only";
import { getSonarrConfig } from "../config/sonarr";
import { read } from "./deletion";
import { request, ApiError } from "../server/http";
import { requireCondition } from "../deletion-policy";
import { seriesDeletionEnabled } from "../server/deletion-access";
import { qbittorrentRequest } from "./qbittorrent";
import type {
  SonarrInstance,
  SonarrSeries,
  SonarrEpisode,
  SonarrEpisodeFile,
  SonarrHistory,
} from "../types/sonarr";

function id(value: number) {
  requireCondition(
    Number.isSafeInteger(value) && value > 0,
    "Invalid series ID.",
  );
  return value;
}
export const freshSeriesById = (instance: SonarrInstance, seriesId: number) =>
  read<SonarrSeries>(
    getSonarrConfig(instance),
    `/api/v3/series/${id(seriesId)}`,
  );
export const freshEpisodes = (instance: SonarrInstance, seriesId: number) =>
  read<SonarrEpisode[]>(
    getSonarrConfig(instance),
    `/api/v3/episode?seriesId=${id(seriesId)}`,
  );
export const freshEpisodeFiles = (instance: SonarrInstance, seriesId: number) =>
  read<SonarrEpisodeFile[]>(
    getSonarrConfig(instance),
    `/api/v3/episodefile?seriesId=${id(seriesId)}`,
  );
export const freshSeriesHistory = (
  instance: SonarrInstance,
  seriesId: number,
) =>
  read<SonarrHistory[]>(
    getSonarrConfig(instance),
    `/api/v3/history/series?seriesId=${id(seriesId)}`,
  );
export const freshSonarrSettings = (instance: SonarrInstance) =>
  read<{ recycleBin: string }>(
    getSonarrConfig(instance),
    "/api/v3/config/mediamanagement",
  );
export async function seriesIsAbsent(
  instance: SonarrInstance,
  seriesId: number,
) {
  try {
    await freshSeriesById(instance, seriesId);
    return false;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return true;
    throw error;
  }
}
export async function removeSeriesRecord(
  instance: SonarrInstance,
  seriesId: number,
) {
  requireCondition(seriesDeletionEnabled(), "Series deletion is disabled.");
  const { url, apiKey } = getSonarrConfig(instance);
  await request(
    `Sonarr (${instance}) deletion`,
    `${url}/api/v3/series/${id(seriesId)}?deleteFiles=false&addImportListExclusion=false`,
    { method: "DELETE", headers: { "X-Api-Key": apiKey } },
    async () => undefined,
    15_000,
  );
}
export async function removeSeriesTorrent(hash: string) {
  requireCondition(seriesDeletionEnabled(), "Series deletion is disabled.");
  requireCondition(
    /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(hash),
    "Invalid torrent hash.",
  );
  await qbittorrentRequest(
    "/api/v2/torrents/delete",
    {
      method: "POST",
      body: new URLSearchParams({ hashes: hash, deleteFiles: "true" }),
    },
    async () => undefined,
  );
}
