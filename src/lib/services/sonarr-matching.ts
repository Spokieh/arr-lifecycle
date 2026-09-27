import type {
  SonarrInstance,
  SonarrEpisode,
  SonarrHistory,
} from "../types/sonarr";
import type { QBittorrentTorrent } from "../types/qbittorrent";

/** Each caller supplies history from ONE configured instance; numeric IDs are not global. */
export function matchSeries(
  instance: SonarrInstance,
  seriesId: number,
  episodes: SonarrEpisode[],
  history: SonarrHistory[],
  torrents: QBittorrentTorrent[],
  category: string | null,
  unavailable = false,
) {
  const scoped = history.filter(
    (record) =>
      record.seriesId === seriesId &&
      typeof record.downloadId === "string" &&
      /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(record.downloadId.trim()),
  );
  const groups = new Map<string, SonarrHistory[]>();
  for (const record of scoped) {
    const hash = record.downloadId!.trim().toLowerCase();
    groups.set(hash, [...(groups.get(hash) ?? []), record]);
  }
  const links = [...groups].map(([hash, evidence]) => {
    const matches = torrents.filter(
      (torrent) => torrent.hash.toLowerCase() === hash,
    );
    const episodeIds = [...new Set(evidence.map((record) => record.episodeId))];
    const status = unavailable
      ? "Unavailable"
      : matches.length > 1
        ? "Ambiguous"
        : !matches.length
          ? "No torrent found"
          : !category
            ? "Category not configured"
            : matches[0].category !== category
              ? "Unexpected category"
              : "Hash match verified";
    return { hash, evidence, matches, episodeIds, status };
  });
  const episodeMatches = episodes
    .filter((episode) => episode.seriesId === seriesId)
    .map((episode) => {
      const related = links.filter((link) =>
        link.episodeIds.includes(episode.id),
      );
      const found = related.filter((link) => link.matches.length);
      const status = unavailable
        ? "Unavailable"
        : found.length > 1 || found.some((link) => link.matches.length > 1)
          ? "Ambiguous"
          : found.length === 1
            ? found[0].status
            : "No exact torrent match";
      return { episode, status, hashes: related.map((link) => link.hash) };
    });
  return { key: `${instance}:${seriesId}`, links, episodes: episodeMatches };
}
