import "server-only";
import { isSonarrInstance, type SonarrInstance } from "../types/sonarr";

export function getSonarrConfig(instance: SonarrInstance) {
  if (!isSonarrInstance(instance)) throw new Error("Unknown Sonarr instance.");
  const prefix = instance === "anime" ? "SONARR_ANIME" : "SONARR";
  const url = process.env[`${prefix}_URL`]?.trim();
  const apiKey = process.env[`${prefix}_API_KEY`]?.trim();
  if (!url || !apiKey)
    throw new Error(
      `Set ${prefix}_URL and ${prefix}_API_KEY in the server environment.`,
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
      throw new Error();
  } catch {
    throw new Error(
      `${prefix}_URL must be a valid HTTP(S) URL without credentials, query or fragment.`,
    );
  }
  return {
    url: url.replace(/\/+$/, ""),
    apiKey,
    category: process.env[`${prefix}_QBIT_CATEGORY`]?.trim() || null,
  };
}
