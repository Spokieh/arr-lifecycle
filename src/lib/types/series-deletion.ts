import type { DirectoryInventory, DeletionStep } from "./deletion";
import type { SonarrInstance } from "./sonarr";
import type { SeerrDeletionPlan } from "./seerr";

export interface SeerrSeriesDeletionPlan extends Omit<
  SeerrDeletionPlan,
  "radarrMovieId" | "radarrServerId"
> {
  instance: SonarrInstance;
  seriesId: number;
  tvdbId: number;
  sonarrServerId: number;
  seasonIds: number[];
}
export interface SeriesTorrentPlan {
  hash: string;
  name: string;
  category: string;
  savePath: string;
  root: string;
  matchEvidence?: "history-hash" | "history-import-path";
  matchedEpisodeFileIds?: number[];
  inventory: DirectoryInventory;
}
export interface SeriesDeletionPlan {
  kind: "series";
  instance: SonarrInstance;
  seriesId: number;
  title: string;
  year: number | null;
  tvdbId: number;
  tmdbId: number;
  libraryPath: string;
  libraryRoot: string;
  library: DirectoryInventory;
  episodeFiles: Array<{ id: number; path: string; size: number }>;
  episodes: Array<{ id: number; fileId: number | null }>;
  torrents: SeriesTorrentPlan[];
  seerr: SeerrSeriesDeletionPlan;
}
export interface SeriesDeletionOperation {
  kind: "series";
  id: string;
  instance: SonarrInstance;
  seriesId: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: "running" | "completed" | "blocked" | "needs-attention";
  torrents: Array<{ hash: string; state: DeletionStep }>;
  library: DeletionStep;
  sonarr: DeletionStep;
  seerr: DeletionStep | "not-needed";
  message: string;
  plan: SeriesDeletionPlan;
}
export interface PreparedSeriesDeletion {
  operationId: string;
  token: string;
  expiresAt: string;
  confirmation: string;
  plan: SeriesDeletionPlan;
}
