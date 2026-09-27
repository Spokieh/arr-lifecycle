export interface RadarrImage {
  coverType: string;
  remoteUrl?: string;
}

export interface RadarrMovie {
  id: number;
  title: string;
  year?: number;
  tmdbId?: number;
  path?: string;
  monitored?: boolean;
  hasFile?: boolean;
  sizeOnDisk?: number;
  status?: string;
  images?: RadarrImage[];
  overview?: string;
  genres?: string[];
  runtime?: number;
  certification?: string;
}

export interface RadarrSystemStatus {
  version: string;
}

export interface RadarrHistoryRecord {
  downloadId?: string;
  id: number;
  movieId: number;
  eventType: string;
  date: string;
  data?: {
    downloadId?: string;
    hash?: string;
  };
}

export interface RadarrQueueRecord {
  id: number;
  movieId?: number;
  downloadId?: string;
}
