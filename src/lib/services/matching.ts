import type { RadarrMovie, RadarrHistoryRecord } from "../types/radarr";
import type { QBittorrentTorrent } from "../types/qbittorrent";

export type MatchStatus =
  "matched" | "candidate" | "unmatched" | "ambiguous" | "unavailable";
export const matchLabels: Record<MatchStatus, string> = {
  matched: "Matched by hash",
  candidate: "Candidate (not hash-verified)",
  unmatched: "No torrent match found",
  ambiguous: "Ambiguous",
  unavailable: "Matching unavailable",
};
export function historyHashes(
  movieId: number,
  history: RadarrHistoryRecord[],
): string[] {
  return [
    ...new Set(
      history
        .filter((r) => r.movieId === movieId)
        .flatMap((r) => [r.downloadId, r.data?.downloadId, r.data?.hash])
        .filter(
          (v): v is string =>
            typeof v === "string" &&
            /^[a-f0-9]{40}$|^[a-f0-9]{64}$/i.test(v.trim()),
        )
        .map((v) => v.trim().toLowerCase()),
    ),
  ];
}
function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
export function matchMovie(
  movie: RadarrMovie,
  history: RadarrHistoryRecord[],
  torrents: QBittorrentTorrent[],
) {
  const hashes = historyHashes(movie.id, history);
  const exact = torrents.filter((t) => hashes.includes(t.hash.toLowerCase()));
  let status: MatchStatus = "unmatched";
  let torrent: QBittorrentTorrent | undefined;
  let reason = "No exact torrent hash found.";
  if (exact.length > 1) {
    status = "ambiguous";
    reason = "Multiple torrent matches.";
  } else if (exact.length === 1) {
    torrent = exact[0];
    if (torrent.category === "MoviesRR") {
      status = "matched";
      reason = "One exact hash match in MoviesRR.";
    } else reason = "Unexpected torrent category.";
  } else {
    const title = normalize(movie.title);
    const candidates =
      title && movie.year
        ? torrents.filter(
            (t) =>
              t.category === "MoviesRR" &&
              ` ${normalize(t.name)} `.includes(` ${title} `) &&
              ` ${normalize(t.name)} `.includes(` ${movie.year} `),
          )
        : [];
    if (candidates.length === 1) {
      status = "candidate";
      torrent = candidates[0];
      reason = "Title/year candidate only; no hash proof.";
    } else if (candidates.length > 1) {
      status = "ambiguous";
      reason = "Multiple title/year candidates.";
    }
  }
  return { movie, status, torrent, reason, hashes };
}
