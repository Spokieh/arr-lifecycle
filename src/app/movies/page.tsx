import { getRadarrQBittorrentOverview } from "@/lib/services/radarr-qbittorrent";
import Link from "next/link";
import { MovieCard } from "@/components/movie-card";
import { connection } from "next/server";
import { parseMovieQuery, moviePageHref } from "@/lib/services/movie-query";
import { RefreshMovies } from "@/components/refresh-movies";

export default async function MoviesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const params = await searchParams;
  const query = parseMovieQuery(params);
  const {
    matches,
    radarrStatus,
    radarrError,
    qbittorrentStatus,
    qbittorrentError,
    page,
    pages,
    total,
    libraryTotal,
    oldestReadAt,
  } = await getRadarrQBittorrentOverview(query);

  return (
    <main className="min-h-screen bg-[#181a20] px-4 py-8 text-slate-100 sm:px-10">
      <div className="mx-auto max-w-[1600px]">
        <nav className="mb-6 flex gap-5 text-sm text-cyan-300">
          <Link href="/">Home</Link>
          <span>Movies</span>
          <Link href="/shows">Shows</Link>
        </nav>
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
                  ? `Connected · v${qbittorrentStatus.version.replace(/^v/i, "")}`
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

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-400">
            Read cache: 30s (version: 60s).{" "}
            {oldestReadAt && (
              <>
                Oldest cached read:{" "}
                <time dateTime={new Date(oldestReadAt).toISOString()}>
                  {new Date(oldestReadAt)
                    .toISOString()
                    .replace("T", " ")
                    .slice(0, 19)}{" "}
                  UTC
                </time>
                .
              </>
            )}
          </p>
          <RefreshMovies />
        </div>
        <form action="/movies" className="mt-6 flex flex-wrap items-end gap-3">
          <label className="sr-only" htmlFor="movie-search">
            Search movies
          </label>
          <input
            id="movie-search"
            name="q"
            defaultValue={query.q}
            placeholder="Search movies…"
            className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-4 py-2"
          />
          <FilterSelect
            name="match"
            label="Torrent match"
            value={query.match}
            options={[
              ["all", "All matches"],
              ["matched", "Matched by hash"],
              ["candidate", "Candidate"],
              ["unmatched", "No match"],
              ["ambiguous", "Ambiguous"],
              ["unavailable", "Unavailable"],
            ]}
          />
          <FilterSelect
            name="file"
            label="Library file"
            value={query.file}
            options={[
              ["all", "Any file status"],
              ["yes", "Has file"],
              ["no", "Missing file"],
            ]}
          />
          <FilterSelect
            name="monitored"
            label="Monitoring"
            value={query.monitored}
            options={[
              ["all", "Any monitoring"],
              ["yes", "Monitored"],
              ["no", "Unmonitored"],
            ]}
          />
          <FilterSelect
            name="sort"
            label="Sort by"
            value={query.sort}
            options={[
              ["title", "Title A–Z"],
              ["year-desc", "Newest year"],
              ["year-asc", "Oldest year"],
              ["size-desc", "Largest first"],
              ["size-asc", "Smallest first"],
            ]}
          />
          <button className="rounded bg-amber-700 px-4 py-2">Apply</button>
          <Link
            href="/movies"
            prefetch={false}
            className="px-2 py-2 text-sm text-slate-300"
          >
            Reset
          </Link>
        </form>
        <nav
          aria-label="Movie pages"
          className="mt-5 flex items-center justify-between text-sm text-cyan-300"
        >
          {page > 1 ? (
            <Link prefetch={false} href={moviePageHref(query, page - 1)}>
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-slate-400">
            {total} of {libraryTotal} movies · Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link prefetch={false} href={moviePageHref(query, page + 1)}>
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
        <div className="mt-8">
          {matches.length === 0 ? (
            <p className="rounded-xl border border-slate-800 p-12 text-center text-slate-400">
              No movies to display for these filters. Check connection warnings
              or reset the filters.
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

function FilterSelect({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string;
  options: [string, string][];
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-400">
      {label}
      <select
        name={name}
        defaultValue={value}
        className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
      >
        {options.map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </label>
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
