export interface QBittorrentTorrent {
  hash: string;
  name: string;
  category: string;
  save_path: string;
  content_path: string;
  size: number;
  total_size: number;
  progress: number;
  ratio: number;
  seeding_time: number;
  state: string;
  added_on: number;
  completion_on: number;
}

export interface QBittorrentConnection {
  version: string;
}
