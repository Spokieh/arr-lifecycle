import { seerrOverview } from "@/lib/services/seerr";
import { seerrSeriesOverview } from "@/lib/services/seerr-series";
import type { SonarrInstance } from "@/lib/types/sonarr";

export async function SeerrEvidence(
  props: { tmdbId?: number } & (
    | { movieId: number }
    | { seriesId: number; tvdbId?: number; instance: SonarrInstance }
  ),
) {
  const { tmdbId } = props;
  let overview;
  try {
    if (!tmdbId) throw new Error("TMDB ID unavailable.");
    if ("movieId" in props)
      overview = await seerrOverview(props.movieId, tmdbId);
    else {
      if (!props.tvdbId) throw new Error("TVDB ID unavailable.");
      overview = await seerrSeriesOverview(
        props.instance,
        props.seriesId,
        tmdbId,
        props.tvdbId,
      );
    }
  } catch (error) {
    overview = {
      version: null,
      plan: null,
      error: error instanceof Error ? error.message : "Seerr unavailable.",
    };
  }
  return (
    <section
      aria-label="Seerr connection and match"
      className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-6"
    >
      <h2 className="text-xl font-medium">Seerr</h2>
      {overview.version && (
        <p className="mt-3 text-sm text-emerald-300">
          Connected · v{overview.version}
        </p>
      )}
      {overview.error && (
        <p className="mt-3 text-sm text-amber-300">{overview.error}</p>
      )}
      {overview.plan && (
        <p className="mt-3 text-sm text-slate-300">
          {overview.plan.mediaId !== null
            ? `${"movieId" in props ? "TMDB" : "TMDB/TVDB"} match verified · media #${overview.plan.mediaId} · ${overview.plan.requestIds.length} request(s) · ${overview.plan.issueIds.length} issue(s)`
            : "No Seerr media record for this item."}
        </p>
      )}
      <p className="mt-3 text-xs text-slate-400">
        Deletion preparation rechecks these records. Removing a Seerr record
        also clears its requests, issues and linked watchlist entries.
      </p>
    </section>
  );
}
