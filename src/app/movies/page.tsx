import { getRadarrQBittorrentOverview } from "@/lib/services/radarr-qbittorrent";
import Link from "next/link";
import { MovieCard } from "@/components/movie-card";
import { connection } from "next/server";

export default async function MoviesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await connection();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.slice(0, 200) : "";
  const {
    matches,
    radarrStatus,
    radarrError,
    qbittorrentStatus,
    qbittorrentError,
    page,
    pages,
    total,
  } = await getRadarrQBittorrentOverview(q, Number(params.page ?? 1));

  return (
    <main className="min-h-screen bg-[#181a20] px-4 py-8 text-slate-100 sm:px-10">
      <div className="mx-auto max-w-[1600px]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.25em] text-cyan-400">
              ARR LIFECYCLE / LIBRARY
            </p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight">
              Movies
            </h1>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <StatusPill
              label="Radarr"
              value={
                radarrStatus
                  ? `Connected · v${radarrStatus.version}`
                  : "Unavailable"
              }
              ok={Boolean(radarrStatus)}
            />
            <StatusPill
              label="qBittorrent"
              value={
                qbittorrentStatus
                  ? `Connected · v${qbittorrentStatus.version}`
                  : "Unavailable"
              }
              ok={Boolean(qbittorrentStatus)}
            />
          </div>
        </div>

        {(radarrError || qbittorrentError) && (
          <div className="mt-8 space-y-1 rounded-xl border border-amber-900/60 bg-amber-950/30 p-4 text-sm text-amber-200">
            {radarrError && <p>{radarrError}</p>}
            {qbittorrentError && (
              <p>{qbittorrentError} Torrent matching is unavailable.</p>
            )}
          </div>
        )}

        <form action="/movies" className="mt-8 flex gap-3">
          <label className="sr-only" htmlFor="movie-search">
            Search movies
          </label>
          <input
            id="movie-search"
            name="q"
            defaultValue={q}
            placeholder="Search movies…"
            className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-4 py-2"
          />
          <button className="rounded bg-amber-700 px-4 py-2">Search</button>
        </form>
        <nav
          aria-label="Movie pages"
          className="mt-5 flex items-center justify-between text-sm text-cyan-300"
        >
          {page > 1 ? (
            <Link
              prefetch={false}
              href={`/movies?q=${encodeURIComponent(q)}&page=${page - 1}`}
            >
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-slate-400">
            {total} movies · Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link
              prefetch={false}
              href={`/movies?q=${encodeURIComponent(q)}&page=${page + 1}`}
            >
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
        <div className="mt-8">
          {matches.length === 0 ? (
            <p className="rounded-xl border border-slate-800 p-12 text-center text-slate-400">
              No movies found. Try another search.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {matches.map(({ movie, status }) => (
                <MovieCard key={movie.id} movie={movie} status={status} />
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function StatusPill({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className="rounded-full border border-slate-800 px-4 py-2">
      <span
        className={`mr-2 inline-block h-2 w-2 rounded-full ${ok ? "bg-emerald-400" : "bg-rose-400"}`}
      />
      {label}: {value}
    </div>
  );
}
