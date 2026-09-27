import type { RadarrMovie } from "../types/radarr";
import type { MatchStatus } from "./matching";

export type MovieQuery = {
  q: string;
  page: number;
  match: MatchStatus | "all";
  file: "all" | "yes" | "no";
  monitored: "all" | "yes" | "no";
  sort: "title" | "year-desc" | "year-asc" | "size-desc" | "size-asc";
};
export function parseMovieQuery(
  params: Record<string, string | string[] | undefined>,
): MovieQuery {
  const one = (key: string) =>
    typeof params[key] === "string" ? (params[key] as string) : "";
  const choice = <T extends string>(
    key: string,
    values: readonly T[],
    fallback: T,
  ): T => values.find((value) => value === one(key)) ?? fallback;
  const page = Number(one("page"));
  return {
    q: one("q").trim().slice(0, 200),
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    match: choice(
      "match",
      ["all", "matched", "candidate", "unmatched", "ambiguous", "unavailable"],
      "all",
    ),
    file: choice("file", ["all", "yes", "no"], "all"),
    monitored: choice("monitored", ["all", "yes", "no"], "all"),
    sort: choice(
      "sort",
      ["title", "year-desc", "year-asc", "size-desc", "size-asc"],
      "title",
    ),
  };
}
export function filterAndSortMovies(
  movies: RadarrMovie[],
  query: MovieQuery,
): RadarrMovie[] {
  return movies
    .filter(
      (movie) =>
        movie.title.toLowerCase().includes(query.q.toLowerCase()) &&
        (query.file === "all" || movie.hasFile === (query.file === "yes")) &&
        (query.monitored === "all" ||
          movie.monitored === (query.monitored === "yes")),
    )
    .sort((a, b) => {
      const tie = () => a.title.localeCompare(b.title, "en") || a.id - b.id;
      if (query.sort === "title") return tie();
      const field = query.sort.startsWith("year") ? "year" : "sizeOnDisk";
      const av = a[field],
        bv = b[field];
      const aKnown = typeof av === "number" && Number.isFinite(av);
      const bKnown = typeof bv === "number" && Number.isFinite(bv);
      if (!aKnown || !bKnown) return aKnown ? -1 : bKnown ? 1 : tie();
      return (query.sort.endsWith("desc") ? bv - av : av - bv) || tie();
    });
}
export function moviePageHref(query: MovieQuery, page: number): string {
  return `/movies?${new URLSearchParams({ ...query, page: String(page) })}`;
}
