import "server-only";
import * as api from "../clients/seerr";
import { getRadarrConfig } from "../config/radarr";
import { getSeerrConfig } from "../config/seerr";
import { cached, cacheKey } from "../server/cache";
import { requireCondition } from "../deletion-policy";
import type { SeerrDeletionPlan, SeerrMovie } from "../types/seerr";

export function identifiers(rows: Array<{ id: number }>, label: string) {
  requireCondition(
    Array.isArray(rows) &&
      rows.length <= 200 &&
      rows.every((row) => row && Number.isSafeInteger(row.id) && row.id > 0),
    `Seerr ${label} inventory is incomplete or exceeds the inspection limit.`,
  );
  const ids = rows.map((row) => row.id).sort((a, b) => a - b);
  requireCondition(
    new Set(ids).size === ids.length,
    `Duplicate Seerr ${label} identifiers.`,
  );
  return ids;
}

export function seerrRecordPlan(
  data: SeerrMovie,
  tmdbId: number,
  movieId: number,
  serverId: number,
  mediaType: "movie" | "tv" = "movie",
) {
  requireCondition(
    data && data.id === tmdbId,
    "Seerr TMDB identity does not match the Radarr movie.",
  );
  const media = data.mediaInfo;
  const base = { tmdbId };
  if (media == null)
    return { ...base, mediaId: null, requestIds: [], issueIds: [] };
  requireCondition(
    Number.isSafeInteger(media.id) &&
      media.id > 0 &&
      media.tmdbId === tmdbId &&
      media.mediaType === mediaType,
    "Seerr media identity is ambiguous.",
  );
  // Seerr 3.4: UNKNOWN=1, BLOCKLISTED=6, DELETED=7.
  requireCondition(
    [1, 2, 3, 4, 5, 7].includes(media.status),
    "Seerr media status is unsupported or blocklisted.",
  );
  requireCondition(
    [1, 7].includes(media.status4k) &&
      media.serviceId4k === null &&
      media.externalServiceId4k === null,
    "Seerr has another 4K copy or request; removing the whole record is blocked.",
  );
  requireCondition(
    (media.serviceId === null || media.serviceId === serverId) &&
      (media.externalServiceId === null || media.externalServiceId === movieId),
    "Seerr media belongs to a different Radarr server or movie.",
  );
  const requestIds = identifiers(media.requests, "request");
  requireCondition(
    media.requests.every(
      (row) =>
        row.type === mediaType &&
        row.is4k === false &&
        (row.serverId === null || row.serverId === serverId),
    ),
    "Seerr requests include a different server, media type or 4K copy.",
  );
  return {
    ...base,
    mediaId: media.id,
    requestIds,
    issueIds: identifiers(media.issues, "issue"),
  };
}

export function seerrMediaPlan(
  data: SeerrMovie,
  tmdbId: number,
  movieId: number,
  serverId: number,
): SeerrDeletionPlan {
  const record = seerrRecordPlan(data, tmdbId, movieId, serverId);
  return {
    tmdbId,
    radarrMovieId: movieId,
    radarrServerId: serverId,
    mediaId: record.mediaId,
    requestIds: record.requestIds,
    issueIds: record.issueIds,
  };
}

export async function prepareSeerrDeletion(
  movieId: number,
  tmdbId: number,
): Promise<SeerrDeletionPlan> {
  requireCondition(
    Number.isSafeInteger(tmdbId) && tmdbId > 0,
    "A valid Radarr TMDB ID is required for Seerr matching.",
  );
  const [movie, servers, user] = await Promise.all([
    api.freshSeerrMovie(tmdbId),
    api.freshSeerrRadarrServers(),
    api.freshSeerrUser(),
  ]);
  // Admin is required for the settings/complete inventory reads as well as removal.
  requireCondition(
    Number.isSafeInteger(user?.permissions) && (user.permissions & 2) !== 0,
    "Seerr API key needs administrator access to inspect all affected records.",
  );
  requireCondition(
    Array.isArray(servers),
    "Seerr Radarr configuration unavailable.",
  );
  const matches = servers.filter(
    (server) =>
      server &&
      server.apiKey === getRadarrConfig().apiKey &&
      server.is4k === false,
  );
  requireCondition(
    matches.length === 1 &&
      Number.isSafeInteger(matches[0].id) &&
      matches[0].id >= 0,
    "Seerr does not identify exactly one matching Radarr server.",
  );
  return seerrMediaPlan(movie, tmdbId, movieId, matches[0].id);
}

export async function removeConfirmedSeerr(plan: SeerrDeletionPlan) {
  const fresh = await prepareSeerrDeletion(plan.radarrMovieId, plan.tmdbId);
  // An upstream scanner/operator may already have removed the confirmed record.
  if (fresh.mediaId === null && plan.mediaId !== null) {
    requireCondition(
      await verifySeerrRemoval(plan),
      "Seerr media disappeared but request removal is unverified.",
    );
    return;
  }
  requireCondition(
    JSON.stringify(fresh) === JSON.stringify(plan),
    "Seerr records changed after confirmation. Review the operation journal.",
  );
  if (plan.mediaId !== null) await api.removeSeerrMedia(plan.mediaId);
}

export async function verifySeerrRemoval(plan: SeerrDeletionPlan) {
  const data = await api.freshSeerrMovie(plan.tmdbId);
  requireCondition(
    data && data.id === plan.tmdbId,
    "Seerr verification returned a different movie.",
  );
  if (data.mediaInfo != null) return false;
  return (
    await Promise.all(plan.requestIds.map(api.seerrRequestIsAbsent))
  ).every(Boolean);
}

/** Informational modal overview only; deletion always uses the fresh path above. */
export async function seerrOverview(movieId: number, tmdbId: number) {
  const seerr = getSeerrConfig();
  const radarr = getRadarrConfig();
  const [status, plan] = await Promise.allSettled([
    cached(
      cacheKey("seerr-status", seerr.url, seerr.apiKey),
      60_000,
      api.freshSeerrStatus,
    ),
    cached(
      cacheKey(
        "seerr-movie",
        seerr.url,
        seerr.apiKey,
        radarr.apiKey,
        String(movieId),
        String(tmdbId),
      ),
      30_000,
      () => prepareSeerrDeletion(movieId, tmdbId),
      "media",
    ),
  ]);
  return {
    version: status.status === "fulfilled" ? status.value.version : null,
    plan: plan.status === "fulfilled" ? plan.value : null,
    error:
      plan.status === "rejected"
        ? String(
            plan.reason instanceof Error
              ? plan.reason.message
              : "Seerr unavailable.",
          )
        : status.status === "rejected"
          ? "Seerr status unavailable."
          : null,
  };
}
