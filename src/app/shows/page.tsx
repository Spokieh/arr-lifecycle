import Link from "next/link";
import { connection } from "next/server";
import { getShowsOverview } from "@/lib/services/sonarr";
import { sonarrLabels } from "@/lib/types/sonarr";
import { ShowCard } from "@/components/show-card";
import { RefreshMovies } from "@/components/refresh-movies";

export default async function ShowsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 200) : "";
  const source =
    params.source === "tv" || params.source === "anime" ? params.source : "all";
  const { instances, qbit } = await getShowsOverview();
  const shows = instances
    .filter((item) => source === "all" || item.instance === source)
    .flatMap((item) =>
      item.series.map((series) => ({ instance: item.instance, series })),
    )
    .filter(({ series }) =>
      series.title.toLowerCase().includes(q.toLowerCase()),
    )
    .sort(
      (a, b) =>
        a.series.title.localeCompare(b.series.title, "en") ||
        a.instance.localeCompare(b.instance) ||
        a.series.id - b.series.id,
    );
  const pages = Math.max(1, Math.ceil(shows.length / 24));
  const requested = typeof params.page === "string" ? Number(params.page) : 1;
  const page = Math.min(
    pages,
    Number.isSafeInteger(requested) && requested > 0 ? requested : 1,
  );
  const href = (next: number) =>
    `/shows?${new URLSearchParams({ q, source, page: String(next) })}`;
  return (
    <main className="min-h-screen bg-[#181a20] px-4 py-8 text-slate-100 sm:px-10">
      <div className="mx-auto max-w-[1600px]">
        <nav className="flex gap-5 text-sm text-cyan-300">
          <Link href="/">Home</Link>
          <Link href="/movies">Movies</Link>
          <span>Shows</span>
        </nav>
        <h1 className="mt-6 text-4xl font-semibold">Shows</h1>
        <p className="mt-2 text-slate-400">
          TV and anime · Read-only · Torrent evidence loads when you open a
          show.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {instances.map((item) => (
            <div
              key={item.instance}
              className="rounded-xl border border-slate-700 p-4 text-sm"
            >
              <p>
                {sonarrLabels[item.instance]}:{" "}
                {item.version ? `v${item.version}` : "Unavailable"}
              </p>
              {item.error && (
                <p className="mt-2 text-amber-300">{item.error}</p>
              )}
            </div>
          ))}
          <div className="rounded-xl border border-slate-700 p-4 text-sm">
            qBittorrent: {qbit.value?.version ?? "Unavailable"}
            {qbit.error && <p className="mt-2 text-amber-300">{qbit.error}</p>}
          </div>
        </div>
        <div className="mt-5">
          <RefreshMovies />
        </div>
        <form action="/shows" className="mt-5 flex flex-wrap gap-3">
          <label className="sr-only" htmlFor="show-search">
            Search shows
          </label>
          <input
            id="show-search"
            name="q"
            defaultValue={q}
            placeholder="Search shows…"
            className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2"
          />
          <label className="sr-only" htmlFor="show-source">
            Sonarr instance
          </label>
          <select
            id="show-source"
            name="source"
            defaultValue={source}
            className="rounded border border-slate-700 bg-slate-900 px-3 py-2"
          >
            <option value="all">TV + Anime</option>
            <option value="tv">TV</option>
            <option value="anime">Anime</option>
          </select>
          <button className="rounded bg-amber-700 px-4 py-2">Apply</button>
        </form>
        <nav
          aria-label="Show pages"
          className="my-5 flex justify-between text-sm text-cyan-300"
        >
          {page > 1 ? (
            <Link href={href(page - 1)} prefetch={false}>
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span>
            {shows.length} shows · Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={href(page + 1)} prefetch={false}>
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
        {!shows.length && (
          <p className="p-8 text-slate-400">
            No shows to display. Check configuration, connection warnings or
            search filters.
          </p>
        )}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {shows
            .slice((page - 1) * 24, page * 24)
            .map(({ instance, series }) => (
              <ShowCard
                key={`${instance}:${series.id}`}
                series={series}
                instance={instance}
                unavailable={Boolean(qbit.error)}
              />
            ))}
        </div>
      </div>
    </main>
  );
}
