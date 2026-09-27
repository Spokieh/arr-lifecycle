/** Only allowlisted public artwork; never pass service URLs or credentials to browsers. */
export function artwork(
  movie: { images?: { coverType: string; remoteUrl?: string }[] } | null,
  kind: "poster" | "fanart",
): string | undefined {
  const source = movie?.images?.find(
    (image) => image.coverType === kind,
  )?.remoteUrl;
  if (!source) return;
  try {
    const url = new URL(source);
    if (url.protocol !== "https:" || url.port || url.username || url.password)
      return;
    if (url.hostname === "artworks.thetvdb.com") {
      if (
        !/^\/banners\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9._-]+\.(?:jpg|jpeg|png|webp)$/i.test(
          url.pathname,
        )
      )
        return;
      return `https://artworks.thetvdb.com${url.pathname}`;
    }
    if (url.hostname !== "image.tmdb.org") return;
    const match = url.pathname.match(/^\/t\/p\/[^/]+\/([a-zA-Z0-9._-]+)$/);
    if (!match) return;
    return `https://image.tmdb.org/t/p/${kind === "poster" ? "w342" : "w1280"}/${match[1]}`;
  } catch {
    return;
  }
}
