import "server-only";
import { spawn } from "node:child_process";
import type { DirectoryInventory, FileIdentity } from "../types/deletion";
import {
  containsPath,
  deletionRoot,
  requireCondition,
} from "../deletion-policy";
import {
  canonicalNasPath,
  parseNasResult,
  type NasResult,
} from "../nas-evidence";
import { assertSeriesRoots } from "../series-deletion-policy";
import type { SonarrInstance } from "../types/sonarr";

const root = globalThis as typeof globalThis & { arrNasActive?: number };
export async function inspectNas(paths: string[]): Promise<NasResult> {
  if (process.env.NAS_INSPECTION_ENABLED !== "true")
    throw new Error("Native NAS inspection is not enabled.");
  if (
    !paths.length ||
    paths.length > 64 ||
    paths.some((path) => canonicalNasPath(path) !== path) ||
    new Set(paths).size !== paths.length
  )
    throw new Error("NAS path validation failed.");
  return nasRequest(
    "arr-lifecycle-inspect-v1",
    { version: 1, paths },
    (value) => parseNasResult(value, paths),
  );
}

export async function inspectDeletionRoots(
  libraryRoot: string,
  torrentRoot: string,
): Promise<[DirectoryInventory, DirectoryInventory]> {
  const roots = [
    deletionRoot(libraryRoot, "library"),
    deletionRoot(torrentRoot, "torrent"),
  ];
  return nasRequest(
    "arr-lifecycle-inspect-v2",
    { version: 2, roots },
    (value) => {
      const data = value as {
        version: number;
        inventories: Array<DirectoryInventory & { filesystem: string }>;
      };
      requireCondition(
        data?.version === 2 &&
          Array.isArray(data.inventories) &&
          data.inventories.length === 2,
        "Invalid NAS inventories.",
      );
      for (const [i, inventory] of data.inventories.entries()) {
        requireCondition(
          inventory?.root === roots[i] &&
            inventory.filesystem === "zfs" &&
            typeof inventory.device === "string" &&
            /^\d+$/.test(inventory.device) &&
            ["present", "missing"].includes(inventory.status) &&
            Array.isArray(inventory.files) &&
            Array.isArray(inventory.directories) &&
            inventory.files.length <= 64 &&
            inventory.directories.length <= 128,
          "Invalid NAS inventory.",
        );
        const validPath = (path: string) =>
          canonicalNasPath(path) === path && containsPath(roots[i], path);
        requireCondition(
          inventory.directories.every(validPath),
          "Invalid NAS directory path.",
        );
        for (const file of inventory.files) {
          requireCondition(
            file &&
              validPath(file.path) &&
              [file.device, file.inode, file.bytes, file.modifiedNs].every(
                (part) => typeof part === "string" && /^\d+$/.test(part),
              ) &&
              Number.isSafeInteger(file.links) &&
              file.links > 0,
            "Invalid NAS file metadata.",
          );
        }
        const paths = [
          ...inventory.directories,
          ...inventory.files.map((file: FileIdentity) => file.path),
        ];
        requireCondition(
          new Set(paths).size === paths.length,
          "Duplicate NAS path.",
        );
        requireCondition(
          inventory.status !== "missing" || !paths.length,
          "Inconsistent missing inventory.",
        );
        inventory.files.sort((a, b) => a.path.localeCompare(b.path, "en"));
        inventory.directories.sort();
      }
      return [data.inventories[0], data.inventories[1]];
    },
  );
}

export async function inspectSeriesDeletionRoots(
  instance: SonarrInstance,
  libraryRoot: string,
  torrentRoots: string[],
): Promise<DirectoryInventory[]> {
  assertSeriesRoots(instance, libraryRoot, torrentRoots);
  const roots = [libraryRoot, ...torrentRoots];
  return nasRequest(
    "arr-lifecycle-inspect-v3",
    { version: 3, roots },
    (value) => {
      const data = value as {
        version: number;
        inventories: Array<DirectoryInventory & { filesystem: string }>;
      };
      requireCondition(
        data?.version === 3 &&
          Array.isArray(data.inventories) &&
          data.inventories.length === roots.length,
        "Invalid series NAS response.",
      );
      let files = 0,
        directories = 0;
      for (const [i, inventory] of data.inventories.entries()) {
        requireCondition(
          inventory?.root === roots[i] &&
            inventory.filesystem === "zfs" &&
            typeof inventory.device === "string" &&
            /^\d+$/.test(inventory.device) &&
            ["present", "missing"].includes(inventory.status) &&
            Array.isArray(inventory.files) &&
            Array.isArray(inventory.directories) &&
            inventory.files.length <= 2048 &&
            inventory.directories.length <= 4096,
          "Invalid series NAS inventory.",
        );
        const validPath = (path: string) =>
          canonicalNasPath(path) === path && containsPath(roots[i], path);
        requireCondition(
          inventory.directories.every(validPath),
          "Invalid series directory path.",
        );
        for (const file of inventory.files)
          requireCondition(
            file &&
              validPath(file.path) &&
              [file.device, file.inode, file.bytes, file.modifiedNs].every(
                (part) => typeof part === "string" && /^\d+$/.test(part),
              ) &&
              file.device === inventory.device &&
              Number.isSafeInteger(file.links) &&
              file.links > 0,
            "Invalid series file identity.",
          );
        const paths = [
          ...inventory.directories,
          ...inventory.files.map((file) => file.path),
        ];
        requireCondition(
          new Set(paths).size === paths.length &&
            (inventory.status !== "missing" || paths.length === 0),
          "Duplicate or inconsistent series paths.",
        );
        inventory.files.sort((a, b) => a.path.localeCompare(b.path, "en"));
        inventory.directories.sort();
        files += inventory.files.length;
        directories += inventory.directories.length;
      }
      requireCondition(
        files <= 4096 && directories <= 2048,
        "Series NAS inventory exceeds limits.",
      );
      return data.inventories;
    },
    2_000_000,
  );
}

function managedLibraryRoot(path: string) {
  requireCondition(
    canonicalNasPath(path) === path &&
      (path.startsWith("/data/media/movies/") ||
        path.startsWith("/data/media/series/") ||
        path.startsWith("/data/media/anime/")),
    "Native cleanup is restricted to an exact managed library root.",
  );
  return path;
}

type ExpectedTree = Pick<
  DirectoryInventory,
  "device" | "files" | "directories"
>;

// Pick<> is only a TypeScript constraint: inventory objects still carry root,
// status and filesystem at runtime. The NAS protocol accepts these three keys.
function expectedTreePayload(expected: ExpectedTree): ExpectedTree {
  return {
    device: expected.device,
    files: expected.files,
    directories: expected.directories,
  };
}

export async function assertNativeCleanupAvailable() {
  const result = await nasRequest(
    "arr-lifecycle-delete-v4",
    { version: 4, mode: "capabilities" },
    (value) => value as { version: number; exactSeriesTreeUnlink: boolean },
  );
  requireCondition(
    result?.version === 4 && result.exactSeriesTreeUnlink === true,
    "NAS exact-file cleanup helper is unavailable; no deletion was started.",
  );
}

export async function validateNativeLibraryTree(
  rootPath: string,
  expected: ExpectedTree,
) {
  const result = await nasRequest(
    "arr-lifecycle-delete-v4",
    {
      version: 4,
      mode: "check",
      root: managedLibraryRoot(rootPath),
      expected: expectedTreePayload(expected),
    },
    (value) => value as { version: number; checked: boolean },
  );
  requireCondition(
    result?.version === 4 && result.checked === true,
    "NAS library contents changed before deletion.",
  );
}

export async function removeNativeLibraryTree(
  rootPath: string,
  expected: ExpectedTree,
) {
  const result = await nasRequest(
    "arr-lifecycle-delete-v4",
    {
      version: 4,
      mode: "delete",
      root: managedLibraryRoot(rootPath),
      expected: expectedTreePayload(expected),
    },
    (value) =>
      value as {
        version: number;
        removedFiles: number;
        removedDirectories: number;
      },
    512000,
  );
  requireCondition(
    result?.version === 4 &&
      result.removedFiles === expected.files.length &&
      result.removedDirectories === expected.directories.length,
    "NAS did not confirm removal of the complete inspected series tree.",
  );
}

async function nasRequest<T>(
  command: string,
  payload: object,
  decode: (value: unknown) => T,
  outputLimit = 512000,
): Promise<T> {
  if (process.env.NAS_INSPECTION_ENABLED !== "true")
    throw new Error("Native NAS inspection is not enabled.");
  if ((root.arrNasActive ?? 0) >= 2)
    throw new Error("NAS inspection is busy. Retry shortly.");
  root.arrNasActive = (root.arrNasActive ?? 0) + 1;
  try {
    return await new Promise<T>((resolve, reject) => {
      const child = spawn(
        "ssh",
        [
          "-F",
          "/dev/null",
          "-T",
          "-o",
          "BatchMode=yes",
          "-o",
          "IdentitiesOnly=yes",
          "-o",
          "PasswordAuthentication=no",
          "-o",
          "StrictHostKeyChecking=yes",
          "-o",
          "UserKnownHostsFile=/run/secrets/nas_known_hosts",
          "-o",
          "GlobalKnownHostsFile=/dev/null",
          "-o",
          "ConnectTimeout=3",
          "-o",
          "ServerAliveInterval=2",
          "-o",
          "ServerAliveCountMax=2",
          "-i",
          "/run/secrets/nas_key",
          "dpcloudAdmin@192.168.1.99",
          command,
        ],
        { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
      );
      let output = "",
        failed = false;
      const timer = setTimeout(
        () => {
          failed = true;
          child.kill("SIGKILL");
        },
        command === "arr-lifecycle-delete-v4" ? 70000 : 10000,
      );
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        output += chunk;
        if (Buffer.byteLength(output) > outputLimit) {
          failed = true;
          child.kill("SIGKILL");
        }
      });
      child.stderr.resume(); // Never expose transport internals or credentials in UI.
      child.stdin.on("error", () => {
        failed = true;
      });
      child.on("error", () => {
        failed = true;
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (failed || code !== 0) {
          reject(new Error("Native NAS inspection unavailable or timed out."));
          return;
        }
        try {
          resolve(decode(JSON.parse(output)));
        } catch {
          reject(new Error("Invalid native NAS inspection response."));
        }
      });
      child.stdin.end(JSON.stringify(payload));
    });
  } finally {
    root.arrNasActive = (root.arrNasActive ?? 1) - 1;
  }
}
