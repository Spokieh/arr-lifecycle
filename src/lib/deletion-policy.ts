import type { DirectoryInventory, MovieDeletionPlan } from "./types/deletion";
import { canonicalNasPath } from "./nas-evidence";

export function requireCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}

export function containsPath(root: string, path: string) {
  return root === path || path.startsWith(`${root}/`);
}

export function overlaps(a: string, b: string) {
  return containsPath(a, b) || containsPath(b, a);
}

export function deletionRoot(path: string, kind: "library" | "torrent") {
  const prefix =
    kind === "library" ? "/data/media/movies/" : "/data/torrents/movies/";
  requireCondition(
    typeof path === "string" &&
      canonicalNasPath(path) === path &&
      path.startsWith(prefix),
    "Deletion path is outside the supported movie roots.",
  );
  return path;
}

export function assertInventories(
  plan: MovieDeletionPlan,
  torrentFiles: { path: string; size: number }[],
) {
  const { library, download } = plan;
  requireCondition(
    library.status === "present" && download.status === "present",
    "A selected media location is missing.",
  );
  requireCondition(
    library.root === plan.libraryRoot && download.root === plan.torrentRoot,
    "Inventory root mismatch.",
  );
  requireCondition(
    library.files.length > 0 && download.files.length > 0,
    "Empty file inventory.",
  );
  requireCondition(
    library.files.some((file) => file.path === plan.libraryFile),
    "Radarr's current file was not found in the movie folder.",
  );
  requireCondition(
    new Set(torrentFiles.map((file) => file.path)).size === torrentFiles.length,
    "Duplicate torrent file paths.",
  );
  requireCondition(
    download.files.length === torrentFiles.length &&
      download.files.every((file) =>
        torrentFiles.some(
          (member) =>
            member.path === file.path && String(member.size) === file.bytes,
        ),
      ),
    "Torrent folder contents or sizes differ from qBittorrent's file list.",
  );
  const all = [...library.files, ...download.files];
  requireCondition(
    new Set(all.map((file) => file.path)).size === all.length,
    "Library and download paths overlap.",
  );
  const current = library.files.find((file) => file.path === plan.libraryFile)!;
  requireCondition(
    download.files.some(
      (file) => file.device === current.device && file.inode === current.inode,
    ),
    "The current Radarr file is not hardlinked to this torrent.",
  );
  for (const file of all) {
    const group = all.filter(
      (other) => other.device === file.device && other.inode === file.inode,
    );
    requireCondition(
      group.every(
        (other) =>
          other.links === file.links &&
          other.bytes === file.bytes &&
          other.modifiedNs === file.modifiedNs,
      ),
      "File metadata changed during inspection.",
    );
    requireCondition(
      file.links === group.length,
      "Additional hardlinks exist outside the confirmed file list.",
    );
  }
}

export function assertLibraryAfterTorrent(
  plan: MovieDeletionPlan,
  library: DirectoryInventory,
  download: DirectoryInventory,
) {
  requireCondition(
    library.device === plan.library.device &&
      download.device === plan.download.device,
    "NAS media mount identity changed.",
  );
  requireCondition(
    download.files.length === 0,
    "Torrent data remains on the NAS.",
  );
  requireCondition(
    library.status === "present" &&
      library.files.length === plan.library.files.length &&
      JSON.stringify(library.directories) ===
        JSON.stringify(plan.library.directories),
    "The library folder changed after torrent removal.",
  );
  for (const before of plan.library.files) {
    const after = library.files.find((file) => file.path === before.path);
    const removedLinks = plan.download.files.filter(
      (file) => file.device === before.device && file.inode === before.inode,
    ).length;
    requireCondition(
      after &&
        after.device === before.device &&
        after.inode === before.inode &&
        after.bytes === before.bytes &&
        after.modifiedNs === before.modifiedNs &&
        after.links === before.links - removedLinks,
      "Library contents or hardlinks changed after torrent removal.",
    );
  }
}

export function movieLibraryAfterTorrent(plan: MovieDeletionPlan) {
  const files = plan.library.files.map((file) => {
    const libraryLinks = plan.library.files.filter(
      (other) => other.device === file.device && other.inode === file.inode,
    ).length;
    const removedLinks = plan.download.files.filter(
      (other) => other.device === file.device && other.inode === file.inode,
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

export function confirmationFor(plan: MovieDeletionPlan) {
  return `DELETE ${plan.title} (${plan.year ?? "unknown year"})`;
}
