import { MediaCard } from "./media-card";
import { artwork } from "@/lib/artwork";
import { matchLabels, type MatchStatus } from "@/lib/services/matching";
import type { RadarrMovie } from "@/lib/types/radarr";

export function MovieCard({
  movie,
  status,
}: {
  movie: RadarrMovie;
  status: MatchStatus;
}) {
  return (
    <MediaCard
      href={`/movies/${movie.id}`}
      title={movie.title}
      kind="MOVIE"
      poster={artwork(movie, "poster")}
      year={movie.year}
      size={movie.hasFile ? movie.sizeOnDisk : undefined}
      files={{
        label:
          movie.hasFile === true
            ? "ON DISK"
            : movie.hasFile === false
              ? "NO FILE"
              : "UNKNOWN",
        description:
          "File availability reported by Radarr; not filesystem verification.",
        tone: movie.hasFile ? "positive" : "neutral",
      }}
      matching={{
        label: matchLabels[status],
        description: matchLabels[status],
        tone:
          status === "matched"
            ? "positive"
            : status === "candidate" || status === "ambiguous"
              ? "warning"
              : "neutral",
      }}
    />
  );
}
