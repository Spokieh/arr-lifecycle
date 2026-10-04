import "server-only";
import { getQBittorrentConfig } from "../config/qbittorrent";
import { cached, cacheKey, invalidate } from "../server/cache";
import { ApiError, request } from "../server/http";
import type { QBittorrentTorrent } from "../types/qbittorrent";

async function get<T>(
  path: string,
  ttl: number,
  decode: (r: Response) => Promise<T>,
): Promise<T> {
  const config = getQBittorrentConfig();
  const identity = cacheKey(
    "qbit",
    config.url,
    config.username,
    config.password,
  );
  return cached(
    cacheKey(identity, path),
    ttl,
    () => qbittorrentRequest(path, {}, decode),
    "media",
  );
}

/** Fresh upstream request. Mutation requests are never retried automatically. */
export async function qbittorrentRequest<T>(
  path: string,
  init: RequestInit,
  decode: (response: Response) => Promise<T>,
): Promise<T> {
  const config = getQBittorrentConfig();
  const identity = cacheKey(
    "qbit",
    config.url,
    config.username,
    config.password,
  );
  const sessionKey = cacheKey(identity, "session");
  const login = () =>
    cached(sessionKey, 20 * 60_000, async () => {
      if (!config.username && !config.password) return "";
      return request(
        "qBittorrent login",
        config.url + "/api/v2/auth/login",
        {
          method: "POST",
          body: new URLSearchParams({
            username: config.username,
            password: config.password,
          }),
        },
        async (response) => {
          if ((await response.text()).trim() !== "Ok.")
            throw new ApiError("qBittorrent authentication failed.");
          const cookie = response.headers
            .get("set-cookie")
            ?.match(/SID=([^;\s,]+)/)?.[0];
          if (!cookie)
            throw new ApiError("qBittorrent session cookie missing.");
          return cookie;
        },
      );
    });
  for (let attempt = 0; attempt < 2; attempt++) {
    const cookie = await login();
    try {
      return await request(
        "qBittorrent",
        config.url + path,
        {
          ...init,
          headers: { ...init.headers, ...(cookie ? { Cookie: cookie } : {}) },
        },
        decode,
        init.method === "POST" ? 15_000 : 5000,
      );
    } catch (error) {
      if (
        attempt === 0 &&
        (!init.method || init.method === "GET") &&
        config.username &&
        error instanceof ApiError &&
        error.status === 403
      ) {
        invalidate(sessionKey);
        continue;
      }
      throw error;
    }
  }
  throw new ApiError("qBittorrent authentication failed.");
}
export async function getConnection() {
  return {
    version: (await get("/api/v2/app/version", 60_000, (r) => r.text())).trim(),
  };
}
export async function getTorrents(): Promise<QBittorrentTorrent[]> {
  return get("/api/v2/torrents/info", 30_000, async (r) => {
    const value = await r.json();
    if (!Array.isArray(value))
      throw new ApiError("qBittorrent: invalid torrent response.");
    return value;
  });
}

export async function getTorrentFiles(
  hash: string,
): Promise<{ name: string; size: number }[]> {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(hash))
    throw new Error("Invalid torrent hash.");
  return get(
    `/api/v2/torrents/files?hash=${encodeURIComponent(hash)}`,
    30_000,
    async (response) => {
      const value = await response.json();
      if (
        !Array.isArray(value) ||
        !value.length ||
        value.length > 5000 ||
        !value.every(
          (file) =>
            file !== null &&
            typeof file === "object" &&
            typeof file.name === "string" &&
            typeof file.size === "number" &&
            Number.isFinite(file.size) &&
            file.size >= 0,
        )
      )
        throw new ApiError(
          "qBittorrent: invalid or oversized torrent file list.",
        );
      return value.map((file) => ({ name: file.name, size: file.size }));
    },
  );
}
