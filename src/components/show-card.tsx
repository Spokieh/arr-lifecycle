import { MediaCard } from "./media-card";
import { artwork } from "@/lib/artwork";
import { showFileBadge } from "@/lib/media-card";
import type { SonarrInstance, SonarrSeries } from "@/lib/types/sonarr";

export function ShowCard({
  series,
  instance,
  unavailable = false,
}: {
  series: SonarrSeries;
  instance: SonarrInstance;
  unavailable?: boolean;
}) {
  return (
    <MediaCard
      href={`/shows/${instance}/${series.id}`}
      title={series.title}
      accessibleLabel={`${series.title} (${instance})`}
      kind={instance === "anime" ? "ANIME" : "TV"}
      poster={artwork(series, "poster")}
      year={series.year}
      size={series.statistics?.sizeOnDisk}
      files={showFileBadge(series.statistics)}
      matching={{
        label: unavailable ? "Matching unavailable" : "Not checked",
        description: unavailable
          ? "qBittorrent is unavailable. Open details for diagnostics."
          : "Open show details for episode-level hash matching. The list does not load torrent history.",
        tone: unavailable ? "warning" : "neutral",
      }}
    />
  );
}
