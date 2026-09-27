import Link from "next/link";
import { MovieArtwork } from "./movie-artwork";
import { artwork } from "@/lib/artwork";
import { formatBytes } from "@/lib/format";
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
    <article className="group min-w-0">
      <Link
        href={`/movies/${movie.id}`}
        aria-label={movie.title}
        scroll={false}
        prefetch={false}
        className="block overflow-hidden rounded-xl border border-white/10 bg-slate-900 shadow-lg transition hover:border-amber-400/60 focus-visible:outline-2 focus-visible:outline-amber-400"
      >
        <div className="relative aspect-[2/3] overflow-hidden">
          <MovieArtwork src={artwork(movie, "poster")} title={movie.title} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/20" />
          <span className="absolute left-3 top-3 rounded bg-black/65 px-2 py-1 text-[10px] font-semibold tracking-widest text-white">
            MOVIE
          </span>
          <span
            className={`absolute right-3 top-3 rounded px-2 py-1 text-[10px] font-medium ${movie.hasFile ? "bg-emerald-950/90 text-emerald-200" : "bg-black/65 text-slate-300"}`}
          >
            {movie.hasFile ? "ON DISK" : "NO FILE"}
          </span>
          <div className="absolute inset-x-0 bottom-0 p-3">
            <p
              className={`text-xs ${status === "matched" ? "text-emerald-300" : status === "candidate" || status === "ambiguous" ? "text-amber-300" : "text-slate-300"}`}
            >
              {matchLabels[status]}
            </p>
          </div>
        </div>
        <div className="p-3">
          <h2
            className="truncate text-sm font-semibold text-slate-100"
            title={movie.title}
          >
            {movie.title}
          </h2>
          <p className="mt-1 flex justify-between text-xs text-slate-400">
            <span>{movie.year ?? "—"}</span>
            <span>{movie.hasFile ? formatBytes(movie.sizeOnDisk) : "—"}</span>
          </p>
        </div>
      </Link>
    </article>
  );
}
