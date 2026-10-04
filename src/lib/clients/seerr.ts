import "server-only";
import { getSeerrConfig } from "../config/seerr";
import { request, ApiError } from "../server/http";
import { requireCondition } from "../deletion-policy";
import {
  deletionEnabled,
  seriesDeletionEnabled,
} from "../server/deletion-access";
import type { SeerrMovie, SeerrRadarrServer, SeerrShow } from "../types/seerr";

function validId(value: number) {
  requireCondition(
    Number.isSafeInteger(value) && value > 0,
    "Invalid Seerr identifier.",
  );
  return value;
}

async function read<T>(path: string): Promise<T> {
  const { url, apiKey } = getSeerrConfig();
  return request(
    "Seerr",
    url + "/api/v1" + path,
    { method: "GET", headers: { "X-Api-Key": apiKey } },
    (response) => response.json(),
  );
}

export const freshSeerrMovie = (tmdbId: number) =>
  read<SeerrMovie>(`/movie/${validId(tmdbId)}`);
export const freshSeerrRadarrServers = () =>
  read<SeerrRadarrServer[]>("/settings/radarr");
export const freshSeerrUser = () => read<{ permissions: number }>("/auth/me");
export const freshSeerrStatus = () => read<{ version: string }>("/status");
export const freshSeerrShow = (tmdbId: number) =>
  read<SeerrShow>(`/tv/${validId(tmdbId)}`);
export const freshSeerrSonarrServers = () =>
  read<SeerrRadarrServer[]>("/settings/sonarr");

export async function removeSeerrMedia(
  mediaId: number,
  kind: "movie" | "series" = "movie",
) {
  requireCondition(
    kind === "series" ? seriesDeletionEnabled() : deletionEnabled(),
    "Deletion is disabled.",
  );
  const { url, apiKey } = getSeerrConfig();
  await request(
    "Seerr deletion",
    `${url}/api/v1/media/${validId(mediaId)}`,
    { method: "DELETE", headers: { "X-Api-Key": apiKey } },
    async () => undefined,
    15_000,
  );
}

export async function seerrRequestIsAbsent(requestId: number) {
  try {
    await read(`/request/${validId(requestId)}`);
    return false;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return true;
    throw error;
  }
}
