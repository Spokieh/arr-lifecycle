import { canonicalNasPath } from "./nas-evidence";
import { containsPath, overlaps, requireCondition } from "./deletion-policy";
import type {
  SonarrInstance,
  SonarrEpisode,
  SonarrEpisodeFile,
} from "./types/sonarr";
import type { DirectoryInventory, FileIdentity } from "./types/deletion";
import type { SeriesDeletionPlan } from "./types/series-deletion";

export function mapSeriesPath(path: string) {
  return path?.startsWith("/media/") ? `/data${path}` : path;
}
export function seriesDeletionRoot(
  path: string,
  instance: SonarrInstance,
  kind: "library" | "torrent",
) {
  const folder = instance === "anime" ? "anime" : "series";
  const prefix = `/data/${kind === "library" ? "media" : "torrents"}/${folder}/`;
  requireCondition(
    (instance === "tv" || instance === "anime") &&
      typeof path === "string" &&
      canonicalNasPath(path) === path &&
      path.startsWith(prefix),
    "Series deletion path is outside the selected instance's supported roots.",
  );
  return path;
}
export function assertSeriesRoots(
  instance: SonarrInstance,
  libraryRoot: string,
  roots: string[],
) {
  seriesDeletionRoot(libraryRoot, instance, "library");
  requireCondition(
    roots.length > 0 && roots.length <= 64,
    "Series deletion requires 1–64 exact torrents.",
  );
  const all = [
    libraryRoot,
    ...roots.map((root) => seriesDeletionRoot(root, instance, "torrent")),
  ];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++)
      requireCondition(
        !overlaps(all[i], all[j]),
        "Selected torrent or library roots overlap.",
      );
}
export function seriesFileIdentities(
  seriesId: number,
  libraryRoot: string,
  episodes: SonarrEpisode[],
  files: SonarrEpisodeFile[],
) {
  requireCondition(
    Array.isArray(files) &&
      files.length > 0 &&
      files.length <= 2048 &&
      Array.isArray(episodes) &&
      episodes.length <= 5000,
    "Sonarr episode/file inventory is empty or exceeds inspection limits.",
  );
  const normalized = files
    .map((file) => {
      const path = mapSeriesPath(file?.path ?? "");
      requireCondition(
        file?.seriesId === seriesId &&
          Number.isSafeInteger(file.id) &&
          file.id > 0 &&
          path &&
          canonicalNasPath(path) === path &&
          path !== libraryRoot &&
          containsPath(libraryRoot, path) &&
          Number.isSafeInteger(file.size) &&
          file.size! >= 0,
        "Sonarr episode file has an unsupported identity/path/size.",
      );
      return { id: file.id, path, size: file.size! };
    })
    .sort((a, b) => a.id - b.id);
  requireCondition(
    new Set(normalized.map((file) => file.id)).size === files.length &&
      new Set(normalized.map((file) => file.path)).size === files.length,
    "Duplicate Sonarr episode file IDs or paths.",
  );
  const linked = episodes
    .map((episode) => {
      requireCondition(
        episode?.seriesId === seriesId &&
          Number.isSafeInteger(episode.id) &&
          episode.id > 0 &&
          typeof episode.hasFile === "boolean",
        "Incomplete Sonarr episode inventory.",
      );
      const fileId = episode.hasFile ? episode.episodeFileId : null;
      requireCondition(
        !episode.hasFile || normalized.some((file) => file.id === fileId),
        "An on-disk episode has no current Sonarr file record.",
      );
      requireCondition(
        episode.hasFile || !episode.episodeFileId,
        "Episode file linkage is inconsistent.",
      );
      return { id: episode.id, fileId: fileId ?? null };
    })
    .sort((a, b) => a.id - b.id);
  requireCondition(
    new Set(linked.map((episode) => episode.id)).size === linked.length &&
      normalized.every((file) =>
        linked.some((episode) => episode.fileId === file.id),
      ),
    "Unknown or duplicated Sonarr file/episode relationships.",
  );
  return { episodeFiles: normalized, episodes: linked };
}
const sameInode = (a: FileIdentity, b: FileIdentity) =>
  a.device === b.device && a.inode === b.inode;
export function assertSeriesInventories(
  plan: SeriesDeletionPlan,
  members: Array<Array<{ path: string; size: number }>>,
) {
  assertSeriesRoots(
    plan.instance,
    plan.libraryRoot,
    plan.torrents.map((torrent) => torrent.root),
  );
  requireCondition(
    plan.library.root === plan.libraryRoot &&
      plan.library.status === "present" &&
      plan.library.files.length > 0 &&
      members.length === plan.torrents.length,
    "Series inventory unavailable.",
  );
  for (const file of plan.episodeFiles)
    requireCondition(
      plan.library.files.some(
        (entry) =>
          entry.path === file.path && entry.bytes === String(file.size),
      ),
      "Current Sonarr episode file missing from native inventory.",
    );
  for (const [i, torrent] of plan.torrents.entries()) {
    const inventory = torrent.inventory,
      payload = members[i];
    requireCondition(
      inventory.root === torrent.root &&
        inventory.status === "present" &&
        payload.length > 0 &&
        new Set(payload.map((file) => file.path)).size === payload.length &&
        inventory.files.length === payload.length &&
        inventory.files.every((file) =>
          payload.some(
            (member) =>
              member.path === file.path && String(member.size) === file.bytes,
          ),
        ),
      "Torrent contents differ from the qBittorrent member list.",
    );
    requireCondition(
      inventory.files.some((download) =>
        plan.library.files.some(
          (library) =>
            plan.episodeFiles.some((file) => file.path === library.path) &&
            sameInode(download, library),
        ),
      ),
      "A history-linked torrent has no current episode hardlink proof.",
    );
  }
  const downloads = plan.torrents.flatMap((torrent) => torrent.inventory.files),
    all = [...plan.library.files, ...downloads];
  requireCondition(
    new Set(all.map((file) => file.path)).size === all.length &&
      all.length <= 4096,
    "Duplicate paths or excessive series inventory.",
  );
  for (const file of plan.episodeFiles) {
    const current = plan.library.files.find(
      (entry) => entry.path === file.path,
    )!;
    requireCondition(
      downloads.some((download) => sameInode(current, download)),
      "A current episode has no exact torrent/hardlink proof.",
    );
  }
  for (const file of all) {
    const group = all.filter((other) => sameInode(file, other));
    requireCondition(
      group.every(
        (other) =>
          other.links === file.links &&
          other.bytes === file.bytes &&
          other.modifiedNs === file.modifiedNs,
      ) && file.links === group.length,
      "Additional hardlinks or unstable metadata outside the confirmed series plan.",
    );
  }
}
export function assertSeriesAfterTorrents(
  plan: SeriesDeletionPlan,
  inventories: DirectoryInventory[],
  removed: string[],
) {
  const before = [
    plan.library,
    ...plan.torrents.map((torrent) => torrent.inventory),
  ];
  requireCondition(
    inventories.length === before.length &&
      new Set(removed).size === removed.length &&
      removed.every((hash) =>
        plan.torrents.some((torrent) => torrent.hash === hash),
      ),
    "Invalid torrent removal state.",
  );
  const removedFiles = plan.torrents
    .filter((torrent) => removed.includes(torrent.hash))
    .flatMap((torrent) => torrent.inventory.files);
  for (let i = 0; i < before.length; i++) {
    const old = before[i],
      current = inventories[i];
    requireCondition(
      current.root === old.root && current.device === old.device,
      "NAS mount or root identity changed.",
    );
    if (i > 0 && removed.includes(plan.torrents[i - 1].hash)) {
      requireCondition(
        current.files.length === 0,
        "Removed torrent data remains on the NAS.",
      );
      continue;
    }
    requireCondition(
      current.status === "present" &&
        current.files.length === old.files.length &&
        JSON.stringify(current.directories) === JSON.stringify(old.directories),
      "Unremoved series/torrent folder changed.",
    );
    for (const file of old.files) {
      const now = current.files.find((entry) => entry.path === file.path);
      const links = removedFiles.filter((entry) =>
        sameInode(entry, file),
      ).length;
      requireCondition(
        now &&
          sameInode(now, file) &&
          now.bytes === file.bytes &&
          now.modifiedNs === file.modifiedNs &&
          now.links === file.links - links,
        "Series contents or hardlinks changed between deletion steps.",
      );
    }
  }
}

/** Snapshot required by the NAS unlink protocol after every confirmed torrent root is gone. */
export function seriesLibraryAfterTorrents(plan: SeriesDeletionPlan) {
  const downloads = plan.torrents.flatMap((torrent) => torrent.inventory.files);
  const files = plan.library.files.map((file) => {
    const libraryLinks = plan.library.files.filter((other) =>
      sameInode(file, other),
    ).length;
    const removedLinks = downloads.filter((other) =>
      sameInode(file, other),
    ).length;
    requireCondition(
      file.links - removedLinks === libraryLinks,
      "NAS hardlink counts do not prove exclusive ownership after torrent removal.",
    );
    return { ...file, links: libraryLinks };
  });
  return {
    device: plan.library.device,
    files,
    directories: plan.library.directories,
  };
}
