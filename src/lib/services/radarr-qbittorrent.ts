import "server-only";
import { getHistoryForMovies, getLibraryHistory } from "@/lib/clients/radarr";
import { getConnection, getTorrents } from "@/lib/clients/qbittorrent";
import { getRadarrOverview } from "./radarr";
import { matchMovie } from "./matching";
import { errorMessage } from "@/lib/server/http";
import { oldestCachedRead } from "@/lib/server/cache";
import { filterAndSortMovies, type MovieQuery } from "./movie-query";

export async function getRadarrQBittorrentOverview(query: MovieQuery) {
  const [radarr, connection, torrents] = await Promise.all([
    getRadarrOverview(),
    getConnection().then(
      (value) => ({ value, error: null }),
      (error) => ({ value: null, error: errorMessage(error) }),
    ),
    getTorrents().then(
      (value) => ({ value, error: null }),
      (error) => ({ value: null, error: errorMessage(error) }),
    ),
  ]);
  const movies = filterAndSortMovies(radarr.movies, query);
  const fullMatching = query.match !== "all";
  let pages = Math.max(1, Math.ceil(movies.length / 24));
  let page = Math.min(pages, query.page);
  const visible = fullMatching
    ? movies
    : movies.slice((page - 1) * 24, page * 24);
  let history: Awaited<ReturnType<typeof getHistoryForMovies>> = [];
  let historyError: string | null = null;
  if (torrents.value && visible.length) {
    try {
      history = fullMatching
        ? await getLibraryHistory()
        : await getHistoryForMovies(visible.map((m) => m.id));
    } catch (error) {
      historyError = errorMessage(error);
    }
  }
  const byMovie = new Map<number, typeof history>();
  for (const record of history) {
    const records = byMovie.get(record.movieId) ?? [];
    records.push(record);
    byMovie.set(record.movieId, records);
  }
  let matches = visible.map((movie) => {
    const match = matchMovie(
      movie,
      byMovie.get(movie.id) ?? [],
      torrents.value ?? [],
    );
    if (!torrents.value || historyError) {
      return {
        ...match,
        status: "unavailable" as const,
        reason: torrents.error ?? historyError!,
      };
    }
    return match;
  });
  let total = movies.length;
  if (fullMatching) {
    matches = matches.filter((match) => match.status === query.match);
    total = matches.length;
    pages = Math.max(1, Math.ceil(total / 24));
    page = Math.min(pages, query.page);
    matches = matches.slice((page - 1) * 24, page * 24);
  }
  return {
    matches,
    page,
    pages,
    total,
    libraryTotal: radarr.movies.length,
    oldestReadAt: oldestCachedRead("media"),
    radarrStatus: radarr.status,
    radarrError: radarr.error ?? historyError,
    qbittorrentStatus: connection.value,
    qbittorrentError: torrents.error ?? connection.error,
  };
}
