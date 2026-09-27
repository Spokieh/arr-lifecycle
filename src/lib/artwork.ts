import type { RadarrMovie } from "./types/radarr";

/** Only public TMDB artwork; never pass Radarr URLs or credentials to browsers. */
export function artwork(
  movie: RadarrMovie | null,
  kind: "poster" | "fanart",
): string | undefined {
  const source = movie?.images?.find(
    (image) => image.coverType === kind,
  )?.remoteUrl;
  if (!source) return;
  try {
    const url = new URL(source);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "image.tmdb.org" ||
      url.username ||
      url.password
    )
      return;
    const match = url.pathname.match(/^\/t\/p\/[^/]+\/([a-zA-Z0-9._-]+)$/);
    if (!match) return;
    return `https://image.tmdb.org/t/p/${kind === "poster" ? "w342" : "w1280"}/${match[1]}`;
  } catch {
    return;
  }
}
