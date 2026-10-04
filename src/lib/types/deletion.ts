import type { SeerrDeletionPlan } from "./seerr";

export interface FileIdentity {
  path: string;
  device: string;
  inode: string;
  links: number;
  bytes: string;
  modifiedNs: string;
}

export interface DirectoryInventory {
  root: string;
  device: string;
  status: "present" | "missing";
  files: FileIdentity[];
  directories: string[];
}

export interface MovieDeletionPlan {
  movieId: number;
  tmdbId?: number;
  title: string;
  year: number | null;
  movieFileId: number;
  libraryFile: string;
  libraryRoot: string;
  torrentRoot: string;
  torrentHash: string;
  torrentName: string;
  library: DirectoryInventory;
  download: DirectoryInventory;
  seerr?: SeerrDeletionPlan;
}

export type DeletionStep = "not-started" | "requested" | "verified";
export interface DeletionOperation {
  id: string;
  movieId: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: "running" | "completed" | "blocked" | "needs-attention";
  torrent: DeletionStep;
  library?: DeletionStep;
  radarr: DeletionStep;
  seerr?: DeletionStep | "not-needed";
  message: string;
  plan: MovieDeletionPlan;
}

export interface PreparedDeletion {
  operationId: string;
  token: string;
  expiresAt: string;
  confirmation: string;
  plan: MovieDeletionPlan;
}
