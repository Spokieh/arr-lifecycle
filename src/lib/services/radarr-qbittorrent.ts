import "server-only";
import { getHistoryForMovies } from "@/lib/clients/radarr";
import { getConnection, getTorrents } from "@/lib/clients/qbittorrent";
import { getRadarrOverview } from "./radarr";
import { matchMovie } from "./matching";
import { errorMessage } from "@/lib/server/http";

export async function getRadarrQBittorrentOverview(
  query = "",
  requestedPage = 1,
) {
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
  const movies = radarr.movies
    .filter((m) => m.title.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => a.title.localeCompare(b.title, "en") || a.id - b.id);
  const pages = Math.max(1, Math.ceil(movies.length / 24));
  const page = Math.min(
    pages,
    Math.max(1, Number.isSafeInteger(requestedPage) ? requestedPage : 1),
  );
  const visible = movies.slice((page - 1) * 24, page * 24);
  let history: Awaited<ReturnType<typeof getHistoryForMovies>> = [];
  let historyError: string | null = null;
  if (torrents.value) {
    try {
      history = await getHistoryForMovies(visible.map((m) => m.id));
    } catch (error) {
      historyError = errorMessage(error);
    }
  }
  const matches = visible.map((movie) => {
    const match = matchMovie(movie, history, torrents.value ?? []);
    if (!torrents.value || historyError) {
      return {
        ...match,
        status: "unavailable" as const,
        reason: torrents.error ?? historyError!,
      };
    }
    return match;
  });
  return {
    matches,
    page,
    pages,
    total: movies.length,
    radarrStatus: radarr.status,
    radarrError: radarr.error ?? historyError,
    qbittorrentStatus: connection.value,
    qbittorrentError: torrents.error ?? connection.error,
  };
}
