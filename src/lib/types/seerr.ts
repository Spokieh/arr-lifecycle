export interface SeerrRequest {
  id: number;
  type: string;
  is4k: boolean;
  serverId: number | null;
}

export interface SeerrMedia {
  id: number;
  tmdbId: number;
  mediaType: string;
  status: number;
  status4k: number;
  serviceId: number | null;
  serviceId4k: number | null;
  externalServiceId: number | null;
  externalServiceId4k: number | null;
  requests: SeerrRequest[];
  issues: Array<{ id: number }>;
  tvdbId?: number | null;
  seasons?: Array<{ id: number; status4k: number }>;
}

export interface SeerrMovie {
  id: number;
  mediaInfo?: SeerrMedia | null;
}
export interface SeerrShow extends SeerrMovie {
  externalIds: { tvdbId?: number | null };
}

export interface SeerrRadarrServer {
  id: number;
  apiKey: string;
  is4k: boolean;
}

export interface SeerrDeletionPlan {
  tmdbId: number;
  radarrMovieId: number;
  radarrServerId: number;
  mediaId: number | null;
  requestIds: number[];
  issueIds: number[];
}
