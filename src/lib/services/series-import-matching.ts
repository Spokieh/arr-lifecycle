import { containsPath, requireCondition } from "../deletion-policy";
import { canonicalNasPath, torrentFilePath } from "../nas-evidence";
import {
  mapSeriesPath,
  seriesDeletionRoot,
} from "../series-deletion-policy";
import type {
  SonarrEpisode,
  SonarrEpisodeFile,
  SonarrHistory,
  SonarrInstance,
} from "../types/sonarr";
import type { QBittorrentTorrent } from "../types/qbittorrent";

/** Bind hashless Sonarr imports using their exact recorded source/destination paths. */
export async function matchHistoryImportPaths(
  instance: SonarrInstance,
  seriesId: number,
  history: SonarrHistory[],
  episodes: SonarrEpisode[],
  files: SonarrEpisodeFile[],
  torrents: QBittorrentTorrent[],
  unresolvedFileIds: Set<number>,
  readMembers: (hash: string) => Promise<Array<{ name: string; size: number }>>,
) {
  const expected = instance === "anime" ? "AnimeRR" : "SeriesRR";
  const currentFiles = new Map(files.map((file) => [file.id, file]));
  const episodeByFile = new Map<number, Set<number>>();
  for (const episode of episodes) {
    if (episode.seriesId !== seriesId || !episode.hasFile) continue;
    const fileId = episode.episodeFileId;
    if (!fileId || !currentFiles.has(fileId)) continue;
    const ids = episodeByFile.get(fileId) ?? new Set<number>();
    ids.add(episode.id);
    episodeByFile.set(fileId, ids);
  }

  const rowsByFile = new Map<number, Array<{ sourcePath: string; destinationPath: string }>>();
  for (const row of history) {
    if (
      row.seriesId !== seriesId ||
      row.eventType !== "downloadFolderImported" ||
      !row.data ||
      (typeof row.data.fileId !== "string" && typeof row.data.fileId !== "number") ||
      typeof row.data.droppedPath !== "string" ||
      typeof row.data.importedPath !== "string"
    ) continue;
    const fileId = Number(row.data.fileId);
    if (!unresolvedFileIds.has(fileId)) continue;
    const file = currentFiles.get(fileId);
    if (!file || !episodeByFile.get(fileId)?.has(row.episodeId)) continue;
    const sourcePath = mapSeriesPath(row.data.droppedPath);
    const destinationPath = mapSeriesPath(row.data.importedPath);
    const currentPath = mapSeriesPath(file.path ?? "");
    if (
      !sourcePath || canonicalNasPath(sourcePath) !== sourcePath ||
      !destinationPath || destinationPath !== currentPath ||
      !containsPath(file.path!.replace(/\\/g, "/"), destinationPath)
    ) continue;
    const rows = rowsByFile.get(fileId) ?? [];
    rows.push({ sourcePath, destinationPath });
    rowsByFile.set(fileId, rows);
  }

  const result = new Map<string, { torrent: QBittorrentTorrent; fileIds: Set<number> }>();
  const selectedFileIds = new Set<number>();
  for (const fileId of unresolvedFileIds) {
    const file = currentFiles.get(fileId);
    const candidates = new Map<string, { torrent: QBittorrentTorrent; sourcePath: string }>();
    for (const row of rowsByFile.get(fileId) ?? []) {
      const matches = torrents.filter((torrent) => {
        if (typeof torrent.content_path !== "string") return false;
        const root = mapSeriesPath(torrent.content_path);
        return root && canonicalNasPath(root) === root && containsPath(root, row.sourcePath);
      });
      requireCondition(
        matches.length === 1,
        `Sonarr import history for episode file #${fileId} maps to ${matches.length} qBittorrent torrents.`,
      );
      const torrent = matches[0];
      requireCondition(
        torrent.category === expected,
        `Exact Sonarr import source for episode file #${fileId} belongs to category ${torrent.category || "(empty)"}, expected ${expected}.`,
      );
      candidates.set(torrent.hash.toLowerCase(), { torrent, sourcePath: row.sourcePath });
    }
    requireCondition(
      candidates.size === 1 && file,
      `No unique exact Sonarr import path matches current episode file #${fileId}.`,
    );
    const [{ torrent, sourcePath }] = [...candidates.values()];
    const root = seriesDeletionRoot(mapSeriesPath(torrent.content_path), instance, "torrent");
    const savePath = mapSeriesPath(torrent.save_path);
    requireCondition(
      typeof savePath === "string" && canonicalNasPath(savePath) === savePath && containsPath(savePath, root),
      "Exact import-path torrent has an inconsistent save path.",
    );
    const members = await readMembers(torrent.hash);
    const exactMembers = members.filter((member) =>
      torrentFilePath(savePath, member.name) === sourcePath &&
      Number.isSafeInteger(member.size) && member.size === file!.size,
    );
    requireCondition(
      exactMembers.length === 1,
      `Sonarr import source for episode file #${fileId} does not match exactly one qBittorrent member and size.`,
    );
    const entry = result.get(torrent.hash.toLowerCase()) ?? { torrent, fileIds: new Set<number>() };
    entry.fileIds.add(fileId);
    result.set(torrent.hash.toLowerCase(), entry);
    selectedFileIds.add(fileId);
  }
  requireCondition(
    selectedFileIds.size === unresolvedFileIds.size,
    "Not every current episode file has exact Sonarr import-path torrent evidence.",
  );
  return result;
}
