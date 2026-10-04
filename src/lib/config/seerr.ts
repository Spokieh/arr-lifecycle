import "server-only";

export interface SeerrConfig {
  url: string;
  apiKey: string;
}

export function getSeerrConfig(): SeerrConfig {
  const url = process.env.SEERR_URL?.trim();
  const apiKey = process.env.SEERR_API_KEY?.trim();
  if (!url || !apiKey)
    throw new Error(
      "Seerr is not configured. Set SEERR_URL and SEERR_API_KEY on the server.",
    );
  try {
    const parsed = new URL(url);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      throw new Error("Invalid URL");
  } catch {
    throw new Error("SEERR_URL must be a valid HTTP or HTTPS service URL.");
  }
  return { url: url.replace(/\/+$/, ""), apiKey };
}
