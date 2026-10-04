import "server-only";
import * as api from "../clients/seerr";
import { getSonarrConfig } from "../config/sonarr";
import { getSeerrConfig } from "../config/seerr";
import { seerrRecordPlan, identifiers } from "./seerr";
import { requireCondition } from "../deletion-policy";
import { cached, cacheKey } from "../server/cache";
import type { SonarrInstance } from "../types/sonarr";
import type { SeerrShow } from "../types/seerr";
import type { SeerrSeriesDeletionPlan } from "../types/series-deletion";

export function seerrSeriesPlan(
  data: SeerrShow,
  instance: SonarrInstance,
  seriesId: number,
  tmdbId: number,
  tvdbId: number,
  serverId: number,
): SeerrSeriesDeletionPlan {
  requireCondition(
    data?.externalIds?.tvdbId === tvdbId,
    "Seerr TMDB/TVDB identity does not match this Sonarr series.",
  );
  if (data.mediaInfo) {
    requireCondition(
      data.mediaInfo.tvdbId == null || data.mediaInfo.tvdbId === tvdbId,
      "Seerr media points to another TVDB series.",
    );
    requireCondition(
      Array.isArray(data.mediaInfo.seasons) &&
        data.mediaInfo.seasons.every((season) =>
          [1, 7].includes(season.status4k),
        ),
      "Seerr has 4K seasons or an incomplete season inventory.",
    );
  }
  return {
    instance,
    seriesId,
    tvdbId,
    sonarrServerId: serverId,
    ...seerrRecordPlan(data, tmdbId, seriesId, serverId, "tv"),
    seasonIds: data.mediaInfo
      ? identifiers(data.mediaInfo.seasons!, "season")
      : [],
  };
}

export async function prepareSeerrSeries(
  instance: SonarrInstance,
  seriesId: number,
  tmdbId: number,
  tvdbId: number,
) {
  requireCondition(
    Number.isSafeInteger(tmdbId) &&
      tmdbId > 0 &&
      Number.isSafeInteger(tvdbId) &&
      tvdbId > 0,
    "Valid Sonarr TMDB and TVDB IDs are required.",
  );
  const [show, servers, user] = await Promise.all([
    api.freshSeerrShow(tmdbId),
    api.freshSeerrSonarrServers(),
    api.freshSeerrUser(),
  ]);
  requireCondition(
    Number.isSafeInteger(user?.permissions) && (user.permissions & 2) !== 0,
    "Seerr administrator access is required.",
  );
  requireCondition(
    Array.isArray(servers),
    "Seerr Sonarr settings unavailable.",
  );
  const matches = servers.filter(
    (server) =>
      server &&
      server.apiKey === getSonarrConfig(instance).apiKey &&
      server.is4k === false,
  );
  requireCondition(
    matches.length === 1 &&
      Number.isSafeInteger(matches[0].id) &&
      matches[0].id >= 0,
    "Seerr does not identify exactly one matching Sonarr instance.",
  );
  return seerrSeriesPlan(
    show,
    instance,
    seriesId,
    tmdbId,
    tvdbId,
    matches[0].id,
  );
}
export async function verifySeerrSeries(plan: SeerrSeriesDeletionPlan) {
  const data = await api.freshSeerrShow(plan.tmdbId);
  requireCondition(
    data?.id === plan.tmdbId && data.externalIds?.tvdbId === plan.tvdbId,
    "Seerr verification identity changed.",
  );
  if (data.mediaInfo != null) return false;
  for (const id of plan.requestIds)
    if (!(await api.seerrRequestIsAbsent(id))) return false;
  return true;
}
export async function removeConfirmedSeerrSeries(
  plan: SeerrSeriesDeletionPlan,
) {
  const fresh = await prepareSeerrSeries(
    plan.instance,
    plan.seriesId,
    plan.tmdbId,
    plan.tvdbId,
  );
  if (fresh.mediaId === null && plan.mediaId !== null) {
    requireCondition(
      await verifySeerrSeries(plan),
      "Seerr series disappeared but request removal is unverified.",
    );
    return;
  }
  requireCondition(
    JSON.stringify(fresh) === JSON.stringify(plan),
    "Seerr series records changed after confirmation.",
  );
  if (plan.mediaId !== null) await api.removeSeerrMedia(plan.mediaId, "series");
}
export async function seerrSeriesOverview(
  instance: SonarrInstance,
  seriesId: number,
  tmdbId: number,
  tvdbId: number,
) {
  const config = getSeerrConfig(),
    sonarr = getSonarrConfig(instance);
  const [status, plan] = await Promise.allSettled([
    cached(
      cacheKey("seerr-status", config.url, config.apiKey),
      60_000,
      api.freshSeerrStatus,
    ),
    cached(
      cacheKey(
        "seerr-series",
        instance,
        config.url,
        config.apiKey,
        sonarr.apiKey,
        String(seriesId),
        String(tmdbId),
        String(tvdbId),
      ),
      30_000,
      () => prepareSeerrSeries(instance, seriesId, tmdbId, tvdbId),
      "media",
    ),
  ]);
  return {
    version: status.status === "fulfilled" ? status.value.version : null,
    plan: plan.status === "fulfilled" ? plan.value : null,
    error:
      plan.status === "rejected"
        ? plan.reason instanceof Error
          ? plan.reason.message
          : "Seerr unavailable."
        : null,
  };
}
