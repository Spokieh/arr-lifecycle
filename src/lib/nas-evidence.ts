export interface NasObservation {
  path: string;
  status: "observed" | "unavailable" | "unsupported-filesystem";
  filesystem?: "zfs";
  device?: string;
  inode?: string;
  links?: number;
  bytes?: string;
}
export interface NasResult {
  version: 1;
  checkedAt: string;
  observations: NasObservation[];
}

export function canonicalNasPath(path: string): string | null {
  if (
    typeof path !== "string" ||
    path.length > 4096 ||
    path.includes("\\") ||
    path.includes("\0")
  )
    return null;
  if (path.split("/").some((part) => [".", "..", ".zfs"].includes(part)))
    return null;
  const canonical = path.replace(/\/{2,}/g, "/");
  return /^\/data\/(media|torrents)\/.+$/.test(canonical) &&
    !canonical.endsWith("/")
    ? canonical
    : null;
}
export function torrentFilePath(savePath: string, name: string): string | null {
  if (!name || name.startsWith("/") || name.includes("\\")) return null;
  const path = canonicalNasPath(`${savePath.replace(/\/+$/, "")}/${name}`);
  return path?.startsWith("/data/torrents/") ? path : null;
}
export function parseNasResult(value: unknown, requested: string[]): NasResult {
  const data = value as NasResult;
  if (
    !data ||
    data.version !== 1 ||
    typeof data.checkedAt !== "string" ||
    !Number.isFinite(Date.parse(data.checkedAt)) ||
    !Array.isArray(data.observations) ||
    data.observations.length !== requested.length
  )
    throw new Error("Invalid NAS response");
  for (const [index, item] of data.observations.entries()) {
    if (
      !item ||
      item.path !== requested[index] ||
      !["observed", "unavailable", "unsupported-filesystem"].includes(
        item.status,
      )
    )
      throw new Error("Invalid NAS response");
    if (
      item.status === "observed" &&
      (item.filesystem !== "zfs" ||
        ![item.device, item.inode, item.bytes].every(
          (value) => typeof value === "string" && /^\d+$/.test(value),
        ) ||
        !Number.isSafeInteger(item.links) ||
        item.links! < 1)
    )
      throw new Error("Invalid NAS metadata");
  }
  return data;
}
export function summarizeHardlinks(
  observations: NasObservation[],
  libraryPaths: string[],
  torrentPaths: string[],
) {
  const library = new Set(libraryPaths),
    torrents = new Set(torrentPaths);
  const groups = new Map<string, NasObservation[]>();
  for (const item of observations) {
    if (item.status !== "observed") continue;
    const key = `${item.device}:${item.inode}`;
    const group = groups.get(key) ?? [];
    if (!group.some((known) => known.path === item.path)) group.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].map((items) => {
    const stable =
      items.every(
        (item) =>
          item.links === items[0].links && item.bytes === items[0].bytes,
      ) && items[0].links! >= items.length;
    return {
      items,
      confirmed:
        stable &&
        items.length > 1 &&
        items.some((item) => library.has(item.path)) &&
        items.some((item) => torrents.has(item.path)),
      remainingLinks: stable ? items[0].links! - items.length : null,
      stable,
    };
  });
}
