import "server-only";
import { getSonarrConfig } from "../config/sonarr";
import { cached, cacheKey } from "../server/cache";
import { ApiError, request } from "../server/http";
import type {
  SonarrInstance,
  SonarrSeries,
  SonarrEpisode,
  SonarrEpisodeFile,
  SonarrHistory,
} from "../types/sonarr";

async function get<T>(
  instance: SonarrInstance,
  path: string,
  validate: (value: unknown) => value is T,
): Promise<T> {
  const { url, apiKey } = getSonarrConfig(instance);
  return cached(
    cacheKey("sonarr", instance, url, apiKey, path),
    30_000,
    () =>
      request(
        `Sonarr (${instance})`,
        url + path,
        { method: "GET", headers: { "X-Api-Key": apiKey } },
        async (response) => {
          const value: unknown = await response.json();
          if (!validate(value))
            throw new ApiError(`Sonarr (${instance}): invalid response.`);
          return value;
        },
      ),
    "media",
  );
}
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const entity = (value: unknown): value is Record<string, unknown> =>
  object(value) && Number.isSafeInteger(value.id);
const series = (value: unknown): value is SonarrSeries =>
  entity(value) && typeof value.title === "string";
const array =
  <T>(check: (value: unknown) => value is T) =>
  (value: unknown): value is T[] =>
    Array.isArray(value) && value.every(check);
function idPath(id: number) {
  if (!Number.isSafeInteger(id) || id < 1)
    throw new Error("Invalid Sonarr series ID.");
  return String(id);
}
export const getSonarrStatus = (instance: SonarrInstance) =>
  get(
    instance,
    "/api/v3/system/status",
    (value): value is { version: string } =>
      object(value) && typeof value.version === "string",
  );
export const getSeries = (instance: SonarrInstance) =>
  get(instance, "/api/v3/series", array(series));
export const getSeriesById = (instance: SonarrInstance, id: number) =>
  get(instance, `/api/v3/series/${idPath(id)}`, series);
export const getEpisodes = (instance: SonarrInstance, id: number) =>
  get(
    instance,
    `/api/v3/episode?seriesId=${idPath(id)}`,
    array(
      (value): value is SonarrEpisode =>
        entity(value) &&
        Number.isSafeInteger(value.seriesId) &&
        Number.isSafeInteger(value.seasonNumber) &&
        Number.isSafeInteger(value.episodeNumber) &&
        typeof value.title === "string" &&
        typeof value.hasFile === "boolean",
    ),
  );
export const getEpisodeFiles = (instance: SonarrInstance, id: number) =>
  get(
    instance,
    `/api/v3/episodefile?seriesId=${idPath(id)}`,
    array(
      (value): value is SonarrEpisodeFile =>
        entity(value) && Number.isSafeInteger(value.seriesId),
    ),
  );
export const getSeriesHistory = (instance: SonarrInstance, id: number) =>
  get(
    instance,
    `/api/v3/history/series?seriesId=${idPath(id)}`,
    array(
      (value): value is SonarrHistory =>
        entity(value) &&
        Number.isSafeInteger(value.seriesId) &&
        Number.isSafeInteger(value.episodeId) &&
        typeof value.date === "string" &&
        typeof value.eventType === "string" &&
        (value.downloadId == null || typeof value.downloadId === "string"),
    ),
  );
