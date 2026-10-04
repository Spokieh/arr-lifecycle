import "server-only";
import { getTorrentFiles } from "../clients/qbittorrent";
import {
  canonicalNasPath,
  torrentFilePath,
  summarizeHardlinks,
} from "../nas-evidence";
import { inspectNas } from "../server/nas";
import type { QBittorrentTorrent } from "../types/qbittorrent";

export interface NasEvidenceInput {
  libraryPaths: string[];
  torrents: QBittorrentTorrent[];
  unavailable?: boolean;
}

export async function getNasEvidence({
  libraryPaths,
  torrents,
  unavailable = false,
}: NasEvidenceInput) {
  if (process.env.NAS_INSPECTION_ENABLED !== "true")
    throw new Error(
      "Native NAS inspection is not enabled in this environment.",
    );
  if (unavailable || !torrents.length || !libraryPaths.length)
    throw new Error(
      "Native comparison blocked: complete API evidence and exact, category-valid torrent matches are required.",
    );
  const uniqueTorrents = [
    ...new Map(
      torrents.map((torrent) => [torrent.hash.toLowerCase(), torrent]),
    ).values(),
  ];
  if (uniqueTorrents.length > 4)
    throw new Error(
      "Native comparison exceeds the four-torrent limit. No partial proof is shown.",
    );
  const lists = await Promise.all(
    uniqueTorrents.map((torrent) => getTorrentFiles(torrent.hash)),
  );
  const torrentMembers = lists.flatMap((files, index) =>
    files.map((file) => ({
      name: file.name,
      size: file.size,
      hash: uniqueTorrents[index].hash,
      path: torrentFilePath(uniqueTorrents[index].save_path, file.name),
    })),
  );
  const downloads = torrentMembers.map((file) => file.path);
  const library = libraryPaths.map(canonicalNasPath);
  if (downloads.some((path) => !path) || library.some((path) => !path))
    throw new Error(
      "Native comparison blocked: unsupported or unsafe API path.",
    );
  const libraryFiles = library as string[],
    torrentFiles = downloads as string[];
  const paths = [...new Set([...libraryFiles, ...torrentFiles])];
  if (paths.length > 64)
    throw new Error(
      "Native comparison exceeds the 64-file limit. No partial proof is shown.",
    );
  const result = await inspectNas(paths);
  const groups = summarizeHardlinks(
    result.observations,
    libraryFiles,
    torrentFiles,
  );
  const observations = new Map(
    result.observations.map((item) => [item.path, item]),
  );
  const linkedPaths = new Map(
    groups.flatMap((group) =>
      group.items.map((item) => [item.path, group] as const),
    ),
  );
  return {
    ...result,
    groups,
    files: [
      ...libraryFiles.map((path) => ({
        role: "Radarr library" as const,
        path,
        size: observations.get(path)?.bytes,
        observation: observations.get(path),
        link: linkedPaths.get(path),
      })),
      ...torrentMembers.map((file) => ({
        role: "qBittorrent data" as const,
        path: file.path!,
        size: String(file.size),
        observation: observations.get(file.path!),
        link: linkedPaths.get(file.path!),
      })),
    ],
  };
}
