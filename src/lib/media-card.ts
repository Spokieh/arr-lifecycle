import type { SonarrSeries } from "./types/sonarr";

export type CardBadge = {
  label: string;
  description: string;
  tone: "positive" | "warning" | "neutral";
  count?: string;
};

/** Monitored episodeCount must not be used for whole-series completeness. */
export function showFileBadge(
  statistics: SonarrSeries["statistics"],
): CardBadge {
  const files = statistics?.episodeFileCount;
  const total = statistics?.totalEpisodeCount;
  if (typeof files !== "number" || !Number.isSafeInteger(files) || files < 0)
    return {
      label: "UNKNOWN",
      description: "Episode file statistics unavailable.",
      tone: "neutral",
    };
  if (files === 0)
    return {
      label: "NO FILES",
      count:
        typeof total === "number" && Number.isSafeInteger(total) && total >= 0
          ? `0/${total} episodes`
          : "0/? episodes",
      description: "No episode files reported by Sonarr.",
      tone: "neutral",
    };
  if (
    typeof total !== "number" ||
    !Number.isSafeInteger(total) ||
    total <= 0 ||
    files > total
  )
    return {
      label: "ON DISK",
      count: `${files}/? episodes`,
      description: `${files} episode(s) with files; complete episode count unavailable.`,
      tone: "neutral",
    };
  return {
    label: files === total ? "COMPLETE" : "PARTIAL",
    count: `${files}/${total} episodes`,
    description: `${files} / ${total} episodes with files, based on Sonarr's current total (including specials and future episodes). Not a filesystem verification.`,
    tone: files === total ? "positive" : "warning",
  };
}
