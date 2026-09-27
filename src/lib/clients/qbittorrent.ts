import "server-only";
import { getQBittorrentConfig } from "@/lib/config/qbittorrent";
import { cached, cacheKey, invalidate } from "@/lib/server/cache";
import { ApiError, request } from "@/lib/server/http";
import type { QBittorrentTorrent } from "@/lib/types/qbittorrent";

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
  return cached(cacheKey(identity, path), ttl, async () => {
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
            headers: cookie ? { Cookie: cookie } : {},
          },
          decode,
        );
      } catch (error) {
        if (
          attempt === 0 &&
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
  });
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
