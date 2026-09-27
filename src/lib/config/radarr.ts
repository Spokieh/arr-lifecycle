import "server-only";

export interface RadarrConfig {
  url: string;
  apiKey: string;
}

export function getRadarrConfig(): RadarrConfig {
  const url = process.env.RADARR_URL?.trim();
  const apiKey = process.env.RADARR_API_KEY?.trim();

  if (!url || !apiKey) {
    throw new Error(
      "Radarr is not configured. Set RADARR_URL and RADARR_API_KEY in the server environment.",
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
      "Radarr is not configured correctly: RADARR_URL must be a valid URL.",
    );
  }

  return { url: url.replace(/\/+$/, ""), apiKey };
}
