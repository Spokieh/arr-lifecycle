import "server-only";
import { getMovie, getMovieHistory } from "@/lib/clients/radarr";
import { getTorrents } from "@/lib/clients/qbittorrent";
import { matchMovie, verificationStatus } from "./matching";
import { errorMessage } from "@/lib/server/http";

export async function getMovieDeletePreview(movieId: number) {
  const [movieResult, historyResult, torrentsResult] = await Promise.allSettled(
    [getMovie(movieId), getMovieHistory(movieId), getTorrents()],
  );
  const movie = movieResult.status === "fulfilled" ? movieResult.value : null;
  const error =
    [movieResult, historyResult, torrentsResult]
      .filter((r) => r.status === "rejected")
      .map((r) => errorMessage(r.reason))
      .join(" ") || null;
  const match = movie
    ? matchMovie(
        movie,
        historyResult.status === "fulfilled" ? historyResult.value : [],
        torrentsResult.status === "fulfilled" ? torrentsResult.value : [],
      )
    : null;
  return {
    movie,
    torrent: match?.torrent ?? null,
    matchStatus: error
      ? ("unavailable" as const)
      : (match?.status ?? ("unmatched" as const)),
    verificationStatus: verificationStatus(
      match?.status ?? "unavailable",
      Boolean(error),
    ),
    reason: error ?? match?.reason ?? "Movie unavailable.",
    error,
    hardlinkMessage: "Hardlink verification unavailable in local development",
    historyHashes: match?.hashes ?? [],
    evidence: match?.evidence ?? [],
    exactMatches: !error ? (match?.exactMatches ?? []) : [],
    candidates: !error ? (match?.candidates ?? []) : [],
  };
}
