import type { SonarrEpisode } from "./types/sonarr";

export function episodeFileState(episode: SonarrEpisode, now: number) {
  if (episode.hasFile) return "On disk";
  const airTime =
    typeof episode.airDateUtc === "string"
      ? Date.parse(episode.airDateUtc)
      : NaN;
  if (!Number.isFinite(airTime)) return "Air date unknown";
  return airTime > now ? "Not aired yet" : "Missing file";
}

export function episodeProgress(episodes: SonarrEpisode[], now: number) {
  const counts = {
    total: episodes.length,
    downloaded: 0,
    missing: 0,
    upcoming: 0,
    unknown: 0,
  };
  for (const episode of episodes) {
    switch (episodeFileState(episode, now)) {
      case "On disk":
        counts.downloaded++;
        break;
      case "Missing file":
        counts.missing++;
        break;
      case "Not aired yet":
        counts.upcoming++;
        break;
      default:
        counts.unknown++;
    }
  }
  return counts;
}
