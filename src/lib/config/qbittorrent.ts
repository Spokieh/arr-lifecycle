import "server-only";

export interface QBittorrentConfig {
  url: string;
  username: string;
  password: string;
}

export function getQBittorrentConfig(): QBittorrentConfig {
  const url = process.env.QBIT_URL?.trim();
  const username = process.env.QBIT_USERNAME?.trim() ?? "";
  const password = process.env.QBIT_PASSWORD ?? "";

  if (!url) {
    throw new Error(
      "qBittorrent is not configured. Set QBIT_URL in the server environment.",
    );
  }

  try {
    const parsed = new URL(url);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      throw new Error("Invalid service URL");
  } catch {
    throw new Error(
      "qBittorrent is not configured correctly: QBIT_URL must be a valid URL.",
    );
  }

  if (Boolean(username) !== Boolean(password))
    throw new Error(
      "Set both qBittorrent credentials, or leave both empty for an already permitted connection.",
    );
  return { url: url.replace(/\/+$/, ""), username, password };
}
