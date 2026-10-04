import "server-only";
import * as api from "../clients/deletion";
import { inspectDeletionRoots } from "../server/nas";
import { canonicalNasPath, torrentFilePath } from "../nas-evidence";
import {
  assertInventories,
  containsPath,
  deletionRoot,
  overlaps,
  requireCondition,
} from "../deletion-policy";
import { matchMovie } from "./matching";
import { prepareSeerrDeletion } from "./seerr";
import type { MovieDeletionPlan } from "../types/deletion";
import type { QBittorrentTorrent } from "../types/qbittorrent";

function validTorrents(value: QBittorrentTorrent[]) {
  requireCondition(
    Array.isArray(value) &&
      value.every(
        (torrent) =>
          torrent &&
          typeof torrent.hash === "string" &&
          /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(torrent.hash) &&
          typeof torrent.content_path === "string",
      ),
    "Incomplete torrent inventory.",
  );
  requireCondition(
    new Set(value.map((torrent) => torrent.hash.toLowerCase())).size ===
      value.length,
    "Duplicate torrent hashes.",
  );
}

/** Reused just before Radarr deletion after the qBittorrent step. */
export async function assertExclusiveOwnership(
  plan: Pick<
    MovieDeletionPlan,
    "movieId" | "tmdbId" | "libraryRoot" | "torrentRoot" | "torrentHash"
  >,
) {
  const [movies, tv, anime, owners, tvOwners, animeOwners, settings] =
    await Promise.all([
      api.freshMovies(),
      api.freshSeries("tv"),
      api.freshSeries("anime"),
      api.hashOwners(plan.torrentHash),
      api.hashOwners(plan.torrentHash, "tv"),
      api.hashOwners(plan.torrentHash, "anime"),
      api.freshMediaSettings(),
    ]);
  requireCondition(
    settings && settings.recycleBin === "",
    "Radarr recycle bin must be empty/disabled for permanent live-file removal. Settings were not changed.",
  );
  requireCondition(
    Array.isArray(movies) && Array.isArray(tv) && Array.isArray(anime),
    "Library ownership inventory unavailable.",
  );
  if (plan.tmdbId) {
    requireCondition(
      movies.every(
        (movie) => Number.isSafeInteger(movie.tmdbId) && movie.tmdbId! > 0,
      ),
      "Radarr TMDB ownership inventory is incomplete.",
    );
    requireCondition(
      !movies.some(
        (movie) => movie.id !== plan.movieId && movie.tmdbId === plan.tmdbId,
      ),
      "Another Radarr movie shares this Seerr/TMDB identity.",
    );
  }
  requireCondition(
    owners.length > 0 &&
      owners.every((owner) => owner.movieId === plan.movieId) &&
      tvOwners.length === 0 &&
      animeOwners.length === 0,
    "This torrent is shared, has unknown ownership, or appears in Sonarr history.",
  );
  for (const item of [
    ...movies.filter((movie) => movie.id !== plan.movieId),
    ...tv,
    ...anime,
  ]) {
    requireCondition(
      item && Number.isSafeInteger(item.id) && typeof item.path === "string",
      "An owner has no usable library path.",
    );
    const path = item.path.startsWith("/media/")
      ? `/data${item.path}`
      : item.path;
    requireCondition(
      canonicalNasPath(path) === path,
      "A library path cannot be mapped to the NAS safely.",
    );
    requireCondition(
      !overlaps(plan.libraryRoot, path) && !overlaps(plan.torrentRoot, path),
      "Another library item uses the selected folder.",
    );
  }
}

export async function assertTorrentIsolation(
  plan: Pick<MovieDeletionPlan, "torrentHash" | "libraryRoot" | "torrentRoot">,
  supplied?: QBittorrentTorrent[],
) {
  const torrents = supplied ?? (await api.freshTorrents());
  validTorrents(torrents);
  for (const torrent of torrents) {
    if (torrent.hash.toLowerCase() === plan.torrentHash) continue;
    const raw = torrent.content_path;
    const path = raw.startsWith("/media/") ? `/data${raw}` : raw;
    // Outside supported mounts, absolute canonical paths still prove lexical non-overlap.
    requireCondition(
      path.startsWith("/") &&
        !path.includes("\\") &&
        !path.split("/").some((part) => [".", ".."].includes(part)),
      "Another torrent has an unsupported content path.",
    );
    requireCondition(
      !path.includes("//") && !path.endsWith("/") && !path.includes("\0"),
      "Another torrent has an ambiguous path.",
    );
    requireCondition(
      !overlaps(plan.torrentRoot, path) && !overlaps(plan.libraryRoot, path),
      "Another torrent overlaps the selected file locations.",
    );
  }
}

export async function prepareMovieDeletion(
  movieId: number,
): Promise<MovieDeletionPlan> {
  const [movie, history, torrents] = await Promise.all([
    api.freshMovie(movieId),
    api.freshMovieHistory(movieId),
    api.freshTorrents(),
  ]);
  requireCondition(
    movie?.id === movieId &&
      movie.hasFile === true &&
      typeof movie.title === "string" &&
      movie.title.length > 0 &&
      movie.title.length < 300,
    "Current Radarr movie/file unavailable.",
  );
  requireCondition(Array.isArray(history), "Movie history unavailable.");
  validTorrents(torrents);
  const match = matchMovie(movie, history, torrents);
  requireCondition(
    match.status === "matched" &&
      match.torrent &&
      match.exactMatches.length === 1,
    match.reason,
  );
  const torrent = match.torrent;
  requireCondition(
    torrent.category === "MoviesRR" &&
      torrent.progress === 1 &&
      [
        "uploading",
        "stalledUP",
        "pausedUP",
        "stoppedUP",
        "queuedUP",
        "forcedUP",
      ].includes(torrent.state),
    "Torrent is incomplete, moving, checking or outside MoviesRR.",
  );
  requireCondition(
    typeof torrent.name === "string" && typeof torrent.save_path === "string",
    "Incomplete torrent metadata.",
  );
  const libraryRoot = deletionRoot(movie.path!, "library"),
    torrentRoot = deletionRoot(torrent.content_path, "torrent");
  requireCondition(
    !overlaps(libraryRoot, torrentRoot),
    "Library and torrent roots overlap.",
  );
  const libraryFile =
    movie.movieFile?.path ??
    (movie.movieFile?.relativePath
      ? `${libraryRoot}/${movie.movieFile.relativePath}`
      : "");
  requireCondition(
    canonicalNasPath(libraryFile) === libraryFile &&
      libraryFile !== libraryRoot &&
      containsPath(libraryRoot, libraryFile) &&
      Number.isSafeInteger(movie.movieFile?.id) &&
      movie.movieFile!.id! > 0,
    "Radarr file identity is incomplete.",
  );
  const base = {
    movieId,
    tmdbId: movie.tmdbId,
    title: movie.title,
    year: movie.year ?? null,
    movieFileId: movie.movieFile!.id!,
    libraryFile,
    libraryRoot,
    torrentRoot,
    torrentHash: torrent.hash.toLowerCase(),
    torrentName: torrent.name,
  };
  const [seerr] = await Promise.all([
    prepareSeerrDeletion(movieId, movie.tmdbId!),
    assertExclusiveOwnership(base),
    assertTorrentIsolation(base, torrents),
  ]);
  const members = await api.freshTorrentFiles(base.torrentHash);
  requireCondition(
    Array.isArray(members) && members.length > 0 && members.length <= 64,
    "Torrent file list is empty or exceeds the 64-file limit.",
  );
  const files = members.map((member) => {
    requireCondition(
      member &&
        typeof member.name === "string" &&
        Number.isSafeInteger(member.size) &&
        member.size >= 0 &&
        member.progress === 1,
      "Incomplete torrent member.",
    );
    const path = torrentFilePath(torrent.save_path, member.name);
    requireCondition(
      path && containsPath(torrentRoot, path),
      "Torrent member is outside its content location.",
    );
    return { path, size: member.size };
  });
  const [library, download] = await inspectDeletionRoots(
    libraryRoot,
    torrentRoot,
  );
  const plan = { ...base, library, download, seerr };
  assertInventories(plan, files);
  return plan;
}
