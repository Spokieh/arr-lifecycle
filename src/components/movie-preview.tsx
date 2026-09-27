import Link from "next/link";
import { getMovieDeletePreview } from "@/lib/services/radarr-movie-preview";
import { formatBytes, formatSeedTime } from "@/lib/format";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { matchLabels } from "@/lib/services/matching";
import { artwork } from "@/lib/artwork";
import { MovieArtwork } from "./movie-artwork";

export default async function MoviePreview({
  id,
  modal = false,
}: {
  id: string;
  modal?: boolean;
}) {
  const movieId = Number(id);
  await connection();
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(movieId)) notFound();
  const preview = await getMovieDeletePreview(movieId);

  return (
    <div
      className={
        modal
          ? "text-slate-100"
          : "min-h-screen bg-slate-950 px-6 py-12 text-slate-100 sm:px-10"
      }
    >
      <div className="mx-auto max-w-5xl">
        {!modal && (
          <Link
            href="/movies"
            className="text-sm text-cyan-400 hover:text-cyan-300"
          >
            ← Back to movies
          </Link>
        )}
        <div className="relative mt-4 aspect-[16/9] overflow-hidden rounded-xl bg-slate-900 sm:aspect-[21/9]">
          <MovieArtwork
            src={
              artwork(preview.movie, "fanart") ??
              artwork(preview.movie, "poster")
            }
            title={preview.movie?.title ?? "Movie"}
            backdrop
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-black/10" />
          <span className="absolute left-4 top-4 rounded bg-black/60 px-3 py-1 text-xs font-semibold tracking-wider">
            MOVIE
          </span>
          {preview.movie?.certification && (
            <span className="absolute right-4 top-4 rounded bg-black/60 px-3 py-1 text-xs">
              {preview.movie.certification}
            </span>
          )}
          <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-4xl">
              {preview.movie?.title ?? "Movie unavailable"}
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              {preview.movie?.year ?? "—"}
              {preview.movie?.runtime ? ` · ${preview.movie.runtime} min` : ""}
            </p>
          </div>
        </div>
        {!!preview.movie?.genres?.length && (
          <div className="mt-4 flex flex-wrap gap-2">
            {preview.movie.genres.map((genre) => (
              <span
                key={genre}
                className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300"
              >
                {genre}
              </span>
            ))}
          </div>
        )}
        <p className="mt-5 text-sm leading-7 text-slate-300">
          {preview.movie?.overview?.replace(/<br\s*\/?\s*>/gi, "\n") ||
            "No overview available."}
        </p>
        {preview.movie?.tmdbId && (
          <a
            className="mt-3 inline-block text-xs font-medium text-amber-300 hover:text-amber-200"
            href={`https://www.themoviedb.org/movie/${preview.movie.tmdbId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View on TMDB ↗
          </a>
        )}

        {preview.error && (
          <div className="mt-6 rounded-xl border border-amber-900/60 bg-amber-950/30 p-4 text-sm text-amber-200">
            {preview.error}
          </div>
        )}

        <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <h2 className="text-xl font-medium">Radarr</h2>
          <dl className="mt-4 grid gap-3 text-sm text-slate-300 md:grid-cols-2">
            <Info label="ID" value={preview.movie?.id} />
            <Info label="Title" value={preview.movie?.title} />
            <Info label="Year" value={preview.movie?.year} />
            <Info
              label="Has file"
              value={
                preview.movie
                  ? preview.movie.hasFile
                    ? "Yes"
                    : "No"
                  : undefined
              }
            />
            <Info
              label="Size on disk"
              value={
                preview.movie
                  ? formatBytes(preview.movie.sizeOnDisk)
                  : undefined
              }
            />
            <Info label="Path" value={preview.movie?.path} wide />
          </dl>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <h2 className="text-xl font-medium">qBittorrent</h2>
          <p
            className={`mt-3 font-medium ${preview.matchStatus === "matched" ? "text-emerald-300" : "text-amber-300"}`}
          >
            Match status: {matchLabels[preview.matchStatus]}
          </p>
          {preview.torrent ? (
            <dl className="mt-4 grid gap-3 text-sm text-slate-300 md:grid-cols-2">
              <Info label="Name" value={preview.torrent.name} />
              <Info label="Hash" value={preview.torrent.hash} />
              <Info label="Category" value={preview.torrent.category} />
              <Info label="State" value={preview.torrent.state} />
              <Info label="Ratio" value={preview.torrent.ratio.toFixed(2)} />
              <Info
                label="Seed time"
                value={formatSeedTime(preview.torrent.seeding_time)}
              />
              <Info
                label="Size"
                value={formatBytes(
                  preview.torrent.total_size || preview.torrent.size,
                )}
              />
              <Info label="Save path" value={preview.torrent.save_path} wide />
              <Info
                label="Content path"
                value={preview.torrent.content_path}
                wide
              />
            </dl>
          ) : (
            <p className="mt-3 text-sm text-slate-500">
              No torrent details available.
            </p>
          )}
          <p className="mt-4 text-xs text-slate-600">
            Radarr history hashes:{" "}
            {preview.historyHashes.length
              ? preview.historyHashes.join(", ")
              : "none returned"}
          </p>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-xl font-medium">Delete preview</h2>
            <span
              className={`rounded-full px-4 py-2 text-sm font-semibold ${preview.eligibility === "SAFE TO DELETE" ? "bg-emerald-950 text-emerald-300" : "bg-rose-950 text-rose-300"}`}
            >
              {preview.eligibility}
            </span>
          </div>
          <p className="mt-4 text-sm text-slate-300">{preview.reason}</p>
          <p className="mt-3 text-sm text-slate-400">
            Would delete if enabled. This is a cached read-only preview, not
            filesystem verification or deletion authorization.
          </p>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-400">
            <li>Radarr movie record</li>
            <li>Radarr library files</li>
            <li>qBittorrent torrent</li>
            <li>qBittorrent downloaded data</li>
          </ul>
          <p className="mt-5 border-t border-slate-800 pt-4 text-sm text-slate-500">
            {preview.hardlinkMessage}
          </p>
          <button
            disabled
            className="mt-5 cursor-not-allowed rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-500"
          >
            Delete (not enabled yet)
          </button>
        </section>
      </div>
    </div>
  );
}

function Info({
  label,
  value,
  wide = false,
}: {
  label: string;
  value?: string | number;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "md:col-span-2" : ""}>
      <dt className="text-slate-500">{label}</dt>
      <dd
        className="break-words [overflow-wrap:anywhere]"
        title={String(value ?? "—")}
      >
        {value ?? "—"}
      </dd>
    </div>
  );
}
