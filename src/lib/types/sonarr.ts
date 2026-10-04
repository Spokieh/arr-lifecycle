export type SonarrInstance = "tv" | "anime";
export const sonarrInstances = ["tv", "anime"] as const;
export const sonarrLabels = { tv: "Sonarr · TV", anime: "Sonarr · Anime" };
export function isSonarrInstance(value: string): value is SonarrInstance {
  return value === "tv" || value === "anime";
}
export interface SonarrSeries {
  id: number;
  tvdbId?: number;
  tmdbId?: number;
  title: string;
  year?: number;
  path?: string;
  monitored?: boolean;
  overview?: string;
  images?: { coverType: string; remoteUrl?: string }[];
  statistics?: {
    episodeCount?: number;
    totalEpisodeCount?: number;
    episodeFileCount?: number;
    sizeOnDisk?: number;
  };
}
export interface SonarrEpisode {
  id: number;
  seriesId: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  hasFile: boolean;
  monitored: boolean;
  episodeFileId?: number;
  airDateUtc?: string | null;
}
export interface SonarrEpisodeFile {
  id: number;
  seriesId: number;
  path?: string;
  size?: number;
}
export interface SonarrHistory {
  id: number;
  seriesId: number;
  episodeId: number;
  date: string;
  eventType: string;
  downloadId?: string;
  data?: {
    fileId?: string | number;
    droppedPath?: string;
    importedPath?: string;
  };
}
