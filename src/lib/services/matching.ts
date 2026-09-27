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
export type HashEvidence = {
  historyId: number;
  movieId: number;
  eventType: string;
  date: string;
  source: "downloadId" | "data.downloadId" | "data.hash";
  hash: string;
};

/** Whitelisted evidence only: never send arbitrary history data to the UI. */
export function historyEvidence(
  movieId: number,
  history: RadarrHistoryRecord[],
): HashEvidence[] {
  return history
    .filter((record) => record.movieId === movieId)
    .flatMap((record) => {
      const fields = [
        ["downloadId", record.downloadId],
        ["data.downloadId", record.data?.downloadId],
        ["data.hash", record.data?.hash],
      ] as const;
      return fields.flatMap(([source, value]) =>
        typeof value === "string" &&
        /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value.trim())
          ? [
              {
                historyId: record.id,
                movieId: record.movieId,
                eventType: record.eventType,
                date: record.date,
                source,
                hash: value.trim().toLowerCase(),
              },
            ]
          : [],
      );
    });
}
export function historyHashes(
  movieId: number,
  history: RadarrHistoryRecord[],
): string[] {
  return [
    ...new Set(historyEvidence(movieId, history).map((entry) => entry.hash)),
  ];
}

export function verificationStatus(status: MatchStatus, unavailable: boolean) {
  return !unavailable && status === "matched"
    ? "Hash match verified"
    : "BLOCKED";
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
  const evidence = historyEvidence(movie.id, history);
  const hashes = [...new Set(evidence.map((entry) => entry.hash))];
  const exact = torrents.filter((t) => hashes.includes(t.hash.toLowerCase()));
  let candidates: QBittorrentTorrent[] = [];
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
    candidates =
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
  return {
    movie,
    status,
    torrent,
    reason,
    hashes,
    evidence,
    exactMatches: exact,
    candidates,
  };
}
