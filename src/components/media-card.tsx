import Link from "next/link";
import { MovieArtwork } from "./movie-artwork";
import { formatBytes } from "@/lib/format";
import type { CardBadge } from "@/lib/media-card";

export function MediaCard({
  href,
  title,
  accessibleLabel = title,
  kind,
  poster,
  year,
  size,
  files,
  matching,
}: {
  href: string;
  title: string;
  accessibleLabel?: string;
  kind: "MOVIE" | "TV" | "ANIME";
  poster?: string;
  year?: number;
  size?: number;
  files: CardBadge;
  matching: CardBadge;
}) {
  return (
    <article className="group min-w-0" data-media-card={kind}>
      <Link
        href={href}
        aria-label={accessibleLabel}
        scroll={false}
        prefetch={false}
        className="block overflow-hidden rounded-xl border border-white/10 bg-slate-900 shadow-lg transition hover:border-amber-400/60 focus-visible:outline-2 focus-visible:outline-amber-400"
      >
        <div className="relative aspect-[2/3] overflow-hidden">
          <MovieArtwork src={poster} title={title} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/20" />
          <div className="absolute inset-x-2 top-3 flex flex-wrap items-start justify-between gap-1">
            <span className="rounded bg-black/65 px-2 py-1 text-[10px] font-semibold tracking-widest text-white">
              {kind}
            </span>
            <span
              title={files.description}
              aria-label={`${files.label}: ${files.description}`}
              className={`rounded px-2 py-1 text-[10px] font-medium ${files.tone === "positive" ? "bg-emerald-950/90 text-emerald-200" : files.tone === "warning" ? "bg-amber-950/90 text-amber-200" : "bg-black/65 text-slate-300"}`}
            >
              {files.label}
            </span>
          </div>
          <div className="absolute inset-x-0 bottom-0 p-3">
            {files.count && (
              <p
                title={files.description}
                className="mb-1 text-sm font-semibold text-white"
              >
                {files.count} on disk
              </p>
            )}
            <p
              title={matching.description}
              className={`text-xs ${matching.tone === "positive" ? "text-emerald-300" : matching.tone === "warning" ? "text-amber-300" : "text-slate-300"}`}
            >
              {matching.label}
            </p>
          </div>
        </div>
        <div className="p-3">
          <h2
            className="truncate text-sm font-semibold text-slate-100"
            title={title}
          >
            {title}
          </h2>
          <p className="mt-1 flex justify-between gap-2 text-xs text-slate-400">
            <span>{year ?? "—"}</span>
            <span>{formatBytes(size)}</span>
          </p>
        </div>
      </Link>
    </article>
  );
}
