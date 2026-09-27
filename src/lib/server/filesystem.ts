import "server-only";
import { lstat, statfs } from "node:fs/promises";
import { posix } from "node:path";

const roots = ["/data/media", "/data/torrents"];
export function allowedMediaPath(value: string): string | null {
  if (
    !value ||
    !value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("\0")
  )
    return null;
  if (value.split("/").some((part) => part === "." || part === ".."))
    return null;
  // qBittorrent's /media bind points to the same library on this deployment.
  const mapped = value.startsWith("/media/") ? `/data${value}` : value;
  const normalized = posix.normalize(mapped);
  return roots.some(
    (root) => normalized === root || normalized.startsWith(root + "/"),
  )
    ? normalized
    : null;
}
export type FileObservation = {
  path: string;
  status: string;
  kind?: "file" | "directory" | "other";
  bytes?: string;
  inode?: string;
  device?: string;
  links?: string;
  filesystem?: string;
};

/** Metadata only. Never opens file contents, walks directories, or follows symlinks. */
async function inspect(path: string): Promise<FileObservation> {
  const safe = allowedMediaPath(path);
  if (!safe) return { path, status: "Outside inspected mounts; not inspected" };
  try {
    let current = "";
    for (const segment of safe.split("/").filter(Boolean)) {
      current += `/${segment}`;
      if ((await lstat(current)).isSymbolicLink())
        return { path, status: "Symbolic link in path; not inspected" };
    }
    const [file, fs] = await Promise.all([
      lstat(safe, { bigint: true }),
      statfs(safe, { bigint: true }),
    ]);
    if (file.isSymbolicLink())
      return { path, status: "Symbolic link; not inspected" };
    const fsType = BigInt.asUintN(32, fs.type);
    const filesystem =
      fsType === BigInt("0xff534d42") || fsType === BigInt("0xfe534d42")
        ? "SMB/CIFS"
        : fsType === BigInt("0x6969")
          ? "NFS"
          : `type 0x${fsType.toString(16)}`;
    return {
      path,
      status: "Metadata observed (not deletion safety)",
      kind: file.isFile() ? "file" : file.isDirectory() ? "directory" : "other",
      bytes: file.size.toString(),
      inode: file.ino.toString(),
      device: file.dev.toString(),
      links: file.nlink.toString(),
      filesystem,
    };
  } catch {
    return {
      path,
      status:
        "Unavailable: missing path, permission denied, or filesystem error",
    };
  }
}

// A stalled network mount must not create an unbounded backlog of metadata operations.
const state = globalThis as typeof globalThis & { arrFsActive?: number };
async function boundedInspect(path: string): Promise<FileObservation> {
  if ((state.arrFsActive ?? 0) >= 4)
    return { path, status: "Filesystem busy; retry later" };
  state.arrFsActive = (state.arrFsActive ?? 0) + 1;
  const work = inspect(path).finally(() => {
    state.arrFsActive = (state.arrFsActive ?? 1) - 1;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<FileObservation>((resolve) => {
        timer = setTimeout(
          () =>
            resolve({
              path,
              status: "Filesystem timed out; verification unavailable",
            }),
          2000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function inspectMediaPaths(paths: string[]) {
  if (
    process.env.FS_INSPECTION_ENABLED !== "true" ||
    process.platform !== "linux"
  )
    return {
      enabled: false,
      truncated: false,
      observations: [] as FileObservation[],
    };
  const unique = [...new Set(paths.filter(Boolean))];
  const observations: FileObservation[] = [];
  // One bounded batch per preview; no recursive scan or long queue on large seasons.
  observations.push(
    ...(await Promise.all(unique.slice(0, 4).map(boundedInspect))),
  );
  return { enabled: true, truncated: unique.length > 4, observations };
}
