import "server-only";
import * as api from "../clients/deletion";
import * as sonarr from "../clients/series-deletion";
import { getSonarrConfig } from "../config/sonarr";
import { inspectSeriesDeletionRoots } from "../server/nas";
import { mapLimited } from "../server/parallel";
import { overlaps, containsPath, requireCondition } from "../deletion-policy";
import { canonicalNasPath, torrentFilePath } from "../nas-evidence";
import {
  mapSeriesPath,
  seriesDeletionRoot,
  assertSeriesRoots,
  seriesFileIdentities,
  assertSeriesInventories,
} from "../series-deletion-policy";
import { prepareSeerrSeries } from "./seerr-series";
import { matchHistoryImportPaths } from "./series-import-matching";
import type { SonarrInstance } from "../types/sonarr";
import type {
  SeriesDeletionPlan,
  SeriesTorrentPlan,
} from "../types/series-deletion";
import type { QBittorrentTorrent } from "../types/qbittorrent";

type Scope = Pick<
  SeriesDeletionPlan,
  "instance" | "seriesId" | "tvdbId" | "tmdbId" | "libraryRoot" | "episodes"
> & { torrents: Array<Omit<SeriesTorrentPlan, "inventory">> };
const states = [
  "uploading",
  "stalledUP",
  "pausedUP",
  "stoppedUP",
  "queuedUP",
  "forcedUP",
];
export function validSeriesTorrents(torrents: QBittorrentTorrent[]) {
  requireCondition(
    Array.isArray(torrents) &&
      torrents.every(
        (torrent) =>
          torrent &&
          typeof torrent.hash === "string" &&
          /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(torrent.hash) &&
          typeof torrent.content_path === "string",
      ) &&
      new Set(torrents.map((torrent) => torrent.hash.toLowerCase())).size ===
        torrents.length,
    "Incomplete/duplicate qBittorrent torrent inventory.",
  );
}
export async function assertSeriesLibraries(plan: Scope) {
  const [movies, tv, anime, settings] = await Promise.all([
    api.freshMovies(),
    api.freshSeries("tv"),
    api.freshSeries("anime"),
    sonarr.freshSonarrSettings(plan.instance),
  ]);
  requireCondition(
    Array.isArray(movies) && Array.isArray(tv) && Array.isArray(anime),
    "Arr library inventory unavailable.",
  );
  requireCondition(
    settings?.recycleBin === "",
    "Selected Sonarr recycle bin must be empty/disabled for permanent file removal.",
  );
  for (const [instance, rows] of [
    ["tv", tv],
    ["anime", anime],
  ] as const) {
    for (const row of rows) {
      if (instance === plan.instance && row.id === plan.seriesId) continue;
      requireCondition(
        Number.isSafeInteger(row.tvdbId) &&
          row.tvdbId! > 0 &&
          (row.tmdbId == null ||
            (Number.isSafeInteger(row.tmdbId) && row.tmdbId >= 0)),
        `Sonarr ${instance} #${row.id} has incomplete ownership metadata.`,
      );
      requireCondition(
        row.tvdbId !== plan.tvdbId && row.tmdbId !== plan.tmdbId,
        "This Seerr/TVDB/TMDB identity exists in another Sonarr series or instance.",
      );
    }
  }
  const other = [
    ...movies,
    ...tv.filter((row) => plan.instance !== "tv" || row.id !== plan.seriesId),
    ...anime.filter(
      (row) => plan.instance !== "anime" || row.id !== plan.seriesId,
    ),
  ];
  const roots = [
    plan.libraryRoot,
    ...plan.torrents.map((torrent) => torrent.root),
  ];
  for (const row of other) {
    const path = mapSeriesPath(row?.path ?? "");
    requireCondition(
      row &&
        Number.isSafeInteger(row.id) &&
        path &&
        canonicalNasPath(path) === path,
      "An arr library path cannot be mapped safely to the NAS.",
    );
    requireCondition(
      roots.every((root) => !overlaps(root, path)),
      "Another arr library item overlaps the selected series folders.",
    );
  }
}
export async function assertSeriesHashOwners(
  plan: Scope,
  hashes = plan.torrents.map((torrent) => torrent.hash),
  importPathHashes = new Set<string>(),
) {
  await mapLimited(hashes, 2, async (hash) => {
    const [movies, tv, anime] = await Promise.all([
      api.hashOwners(hash),
      api.hashOwners(hash, "tv"),
      api.hashOwners(hash, "anime"),
    ]);
    const own = plan.instance === "tv" ? tv : anime,
      other = plan.instance === "tv" ? anime : tv;
    requireCondition(
      movies.length === 0 &&
        other.length === 0 &&
        (own.length > 0
          ? own.every(
              (row) =>
                row.seriesId === plan.seriesId &&
                plan.episodes.some((episode) => episode.id === row.episodeId),
            )
          : importPathHashes.has(hash.toLowerCase())),
      "A torrent has shared, unknown or cross-instance episode ownership.",
    );
  });
}
export async function assertSeriesTorrentIsolation(
  plan: Pick<Scope, "instance" | "libraryRoot" | "torrents">,
  removed: string[] = [],
  supplied?: QBittorrentTorrent[],
) {
  const torrents = supplied ?? (await api.freshTorrents());
  validSeriesTorrents(torrents);
  for (const target of plan.torrents) {
    const found = torrents.find(
      (torrent) => torrent.hash.toLowerCase() === target.hash,
    );
    if (removed.includes(target.hash)) {
      requireCondition(
        !found,
        "A removed torrent is still present or was re-added.",
      );
      continue;
    }
    requireCondition(
      found &&
        found.name === target.name &&
        found.category === target.category &&
        found.progress === 1 &&
        states.includes(found.state) &&
        mapSeriesPath(found.content_path) === target.root &&
        mapSeriesPath(found.save_path) === target.savePath,
      "Selected torrent metadata, category, state or path changed.",
    );
  }
  const roots = [
    plan.libraryRoot,
    ...plan.torrents.map((torrent) => torrent.root),
  ];
  for (const torrent of torrents) {
    if (
      plan.torrents.some((target) => target.hash === torrent.hash.toLowerCase())
    )
      continue;
    const path = mapSeriesPath(torrent.content_path);
    requireCondition(
      path.startsWith("/") &&
        !path.includes("\\") &&
        !path.includes("\0") &&
        !path.includes("//") &&
        !path.endsWith("/") &&
        !path.split("/").some((part) => [".", "..", ".zfs"].includes(part)),
      "Another torrent has an ambiguous path.",
    );
    requireCondition(
      roots.every((root) => !overlaps(root, path)),
      "Another torrent overlaps the selected series data.",
    );
  }
}
export async function assertCurrentSeries(plan: SeriesDeletionPlan) {
  const [series, files, episodes] = await Promise.all([
    sonarr.freshSeriesById(plan.instance, plan.seriesId),
    sonarr.freshEpisodeFiles(plan.instance, plan.seriesId),
    sonarr.freshEpisodes(plan.instance, plan.seriesId),
  ]);
  requireCondition(
    series?.id === plan.seriesId &&
      series.path === plan.libraryPath &&
      series.tvdbId === plan.tvdbId &&
      series.tmdbId === plan.tmdbId,
    "Sonarr series identity/path changed.",
  );
  const current = seriesFileIdentities(
    plan.seriesId,
    plan.libraryRoot,
    episodes,
    files,
  );
  requireCondition(
    JSON.stringify(current.episodeFiles) ===
      JSON.stringify(plan.episodeFiles) &&
      JSON.stringify(current.episodes) === JSON.stringify(plan.episodes),
    "Sonarr current episode/file relationships changed.",
  );
}
export async function prepareSeriesDeletion(
  instance: SonarrInstance,
  seriesId: number,
): Promise<SeriesDeletionPlan> {
  const config = getSonarrConfig(instance),
    expected = instance === "anime" ? "AnimeRR" : "SeriesRR";
  requireCondition(
    config.category === expected,
    `Set the ${instance} torrent category to ${expected} before series deletion.`,
  );
  const [series, episodes, files, history, torrents] = await Promise.all([
    sonarr.freshSeriesById(instance, seriesId),
    sonarr.freshEpisodes(instance, seriesId),
    sonarr.freshEpisodeFiles(instance, seriesId),
    sonarr.freshSeriesHistory(instance, seriesId),
    api.freshTorrents(),
  ]);
  requireCondition(
    series?.id === seriesId &&
      typeof series.title === "string" &&
      series.title.length > 0 &&
      series.title.length < 300 &&
      Number.isSafeInteger(series.tvdbId) &&
      series.tvdbId! > 0 &&
      Number.isSafeInteger(series.tmdbId) &&
      series.tmdbId! > 0,
    "Sonarr series identity is incomplete.",
  );
  const libraryRoot = seriesDeletionRoot(
    mapSeriesPath(series.path!),
    instance,
    "library",
  );
  const identities = seriesFileIdentities(
    seriesId,
    libraryRoot,
    episodes,
    files,
  );
  requireCondition(
    Array.isArray(history) &&
      history.length <= 50_000 &&
      history.every((row) => row?.seriesId === seriesId),
    "Complete series-scoped history is unavailable.",
  );
  const historyHashRows = history.filter(
    (row) =>
      typeof row.downloadId === "string" &&
      /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(row.downloadId.trim()),
  );
  const hashes = new Set(
    historyHashRows.map((row) => row.downloadId!.trim().toLowerCase()),
  );
  validSeriesTorrents(torrents);
  const hashFileIds = new Set<number>();
  for (const row of historyHashRows) {
    const episode = episodes.find((candidate) => candidate.id === row.episodeId);
    if (episode?.hasFile && episode.episodeFileId) hashFileIds.add(episode.episodeFileId);
  }
  const unresolvedFileIds = new Set(
    identities.episodeFiles
      .filter((file) => !hashFileIds.has(file.id))
      .map((file) => file.id),
  );
  const memberCache = new Map<
    string,
    Array<{ name: string; size: number; progress: number }>
  >();
  const importMatches = unresolvedFileIds.size
    ? await matchHistoryImportPaths(
        instance,
        seriesId,
        history,
        episodes,
        files,
        torrents,
        unresolvedFileIds,
        async (hash) => {
          const rows = await api.freshTorrentFiles(hash);
          memberCache.set(hash, rows);
          return rows;
        },
      )
    : new Map<string, { torrent: QBittorrentTorrent; fileIds: Set<number> }>();
  const selectedByHash = new Map(
    torrents
      .filter((torrent) => hashes.has(torrent.hash.toLowerCase()))
      .map((torrent) => [torrent.hash.toLowerCase(), torrent]),
  );
  for (const [hash, evidence] of importMatches) selectedByHash.set(hash, evidence.torrent);
  const selected = [...selectedByHash.values()].sort((a, b) =>
    a.hash.toLowerCase().localeCompare(b.hash.toLowerCase()),
  );
  assertSeriesRoots(
    instance,
    libraryRoot,
    selected.map((torrent) => mapSeriesPath(torrent.content_path)),
  );
  const targets = selected.map((torrent) => {
    requireCondition(
      torrent.category === expected &&
        torrent.progress === 1 &&
        states.includes(torrent.state) &&
        typeof torrent.name === "string" &&
        typeof torrent.save_path === "string",
      "History-linked torrent is incomplete, unsafe or in an unexpected category.",
    );
    const root = seriesDeletionRoot(
        mapSeriesPath(torrent.content_path),
        instance,
        "torrent",
      ),
      savePath = mapSeriesPath(torrent.save_path);
    requireCondition(
      canonicalNasPath(savePath) === savePath && containsPath(savePath, root),
      "Torrent save/content path is inconsistent.",
    );
    const hash = torrent.hash.toLowerCase();
    return {
      hash,
      name: torrent.name,
      category: expected,
      savePath,
      root,
      matchEvidence: hashes.has(hash) ? "history-hash" as const : "history-import-path" as const,
      matchedEpisodeFileIds: [...(importMatches.get(hash)?.fileIds ?? new Set<number>())].sort((a, b) => a - b),
    };
  });
  const scope = {
    instance,
    seriesId,
    tvdbId: series.tvdbId!,
    tmdbId: series.tmdbId!,
    libraryRoot,
    episodes: identities.episodes,
    torrents: targets,
  };
  const [seerr] = await Promise.all([
    prepareSeerrSeries(instance, seriesId, scope.tmdbId, scope.tvdbId),
    assertSeriesLibraries(scope),
    assertSeriesHashOwners(scope, undefined, new Set(importMatches.keys())),
    assertSeriesTorrentIsolation(scope, [], torrents),
  ]);
  const members = await mapLimited(targets, 4, async (torrent) => {
    let rows = memberCache.get(torrent.hash);
    if (!rows) {
      rows = await api.freshTorrentFiles(torrent.hash);
      memberCache.set(torrent.hash, rows);
    }
    requireCondition(
      Array.isArray(rows) && rows.length > 0 && rows.length <= 2048,
      "Torrent member inventory unavailable or too large.",
    );
    return rows.map((row) => {
      const path = torrentFilePath(torrent.savePath, row?.name);
      requireCondition(
        row &&
          Number.isSafeInteger(row.size) &&
          row.size >= 0 &&
          row.progress === 1 &&
          path &&
          containsPath(torrent.root, path),
        "Incomplete torrent member or path outside the confirmed content root.",
      );
      return { path, size: row.size };
    });
  });
  const inventories = await inspectSeriesDeletionRoots(
    instance,
    libraryRoot,
    targets.map((torrent) => torrent.root),
  );
  const plan: SeriesDeletionPlan = {
    kind: "series",
    ...scope,
    title: series.title,
    year: series.year ?? null,
    libraryPath: series.path!,
    library: inventories[0],
    episodeFiles: identities.episodeFiles,
    torrents: targets.map((torrent, i) => ({
      ...torrent,
      inventory: inventories[i + 1],
    })),
    seerr,
  };
  assertSeriesInventories(plan, members);
  return plan;
}
