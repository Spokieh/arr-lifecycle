import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { isSonarrInstance, sonarrLabels } from "@/lib/types/sonarr";
import { getShowPreview } from "@/lib/services/sonarr";
import { formatBytes, formatSeedTime } from "@/lib/format";
import { artwork } from "@/lib/artwork";
import { MovieArtwork } from "./movie-artwork";
import { Suspense } from "react";
import { FilesystemEvidence } from "./filesystem-evidence";
import { episodeFileState, episodeProgress } from "@/lib/episode-progress";

export default async function ShowPreview({
  instance,
  id,
  modal = false,
}: {
  instance: string;
  id: string;
  modal?: boolean;
}) {
  await connection();
  if (
    !isSonarrInstance(instance) ||
    !/^[1-9]\d*$/.test(id) ||
    !Number.isSafeInteger(Number(id))
  )
    notFound();
  const preview = await getShowPreview(instance, Number(id));
  const { series, matching } = preview;
  const now = preview.evaluatedAt;
  const seasons = [
    ...new Set(matching.episodes.map(({ episode }) => episode.seasonNumber)),
  ].sort((a, b) => a - b);
  return (
    <div
      className={
        modal
          ? "text-slate-100"
          : "min-h-screen bg-slate-950 p-6 text-slate-100"
      }
    >
      <div className="mx-auto max-w-5xl">
        {!modal && (
          <Link href="/shows" className="text-cyan-300">
            ← Back to shows
          </Link>
        )}
        <div className="relative mt-4 aspect-video overflow-hidden rounded-xl">
          <MovieArtwork
            src={artwork(series, "fanart") ?? artwork(series, "poster")}
            title={series?.title ?? "Show"}
            backdrop
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-5">
            <p className="text-sm text-cyan-300">
              {sonarrLabels[instance]} · {matching.key}
            </p>
            <h1 className="mt-2 text-3xl font-semibold">
              {series?.title ?? "Show unavailable"}
            </h1>
          </div>
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-300">
          {series?.overview?.replace(/<br\s*\/?\s*>/gi, "\n") ??
            "No overview available."}
        </p>
        {!!preview.errors.length && (
          <div
            role="status"
            className="mt-5 rounded border border-amber-800 p-4 text-amber-300"
          >
            {preview.errors.map((error) => (
              <p key={error}>{error}</p>
            ))}
            <p>Lookup incomplete. No match is verified.</p>
          </div>
        )}
        <section className="mt-6 rounded-xl border border-slate-800 p-5">
          <h2 className="text-xl">Sonarr library</h2>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <Field label="ID" value={series?.id} />
            <Field label="Year" value={series?.year} />
            <Field
              label="Monitored"
              value={series ? String(series.monitored ?? "Unknown") : undefined}
            />
            <Field
              label="Size on disk"
              value={formatBytes(series?.statistics?.sizeOnDisk)}
            />
            <Field label="Library path" value={series?.path} />
            <Field
              label="Expected torrent category"
              value={
                preview.category ?? "Not configured — hash verification blocked"
              }
            />
          </dl>
        </section>
        <section
          aria-label="Sonarr torrent evidence"
          className="mt-6 rounded-xl border border-slate-800 p-5"
        >
          <h2 className="text-xl">Torrent evidence</h2>
          <p className="mt-3 text-sm text-slate-400">
            Exact history downloadId → torrent hash only. A series can have
            several valid torrents. One hash may cover several episodes; the
            complete torrent contents and other hardlinks are not verified.
          </p>
          {!matching.links.length && (
            <p className="mt-4 text-amber-300">
              {preview.errors.length
                ? "Matching unavailable."
                : "No valid torrent hash returned in this series’ history. No title/path guesses are used."}
            </p>
          )}
          {matching.links.map((link) => (
            <details
              key={link.hash}
              className="mt-4 rounded-lg border border-slate-700 p-3"
            >
              <summary className="cursor-pointer break-all text-sm">
                <span
                  className={
                    link.status === "Hash match verified"
                      ? "text-cyan-300"
                      : "text-amber-300"
                  }
                >
                  {link.status}
                </span>{" "}
                · {link.hash} · {link.episodeIds.length} history-linked
                episode(s)
              </summary>
              {link.episodeIds.length > 1 && (
                <p className="mt-3 text-sm text-amber-300">
                  Shared hash across episodes: never treat this as a
                  single-episode delete target.
                </p>
              )}
              {link.matches.map((torrent, index) => (
                <dl
                  key={`${torrent.hash}-${index}`}
                  className="mt-4 grid gap-3 text-sm sm:grid-cols-2"
                >
                  <Field label="Torrent" value={torrent.name} />
                  <Field label="Category" value={torrent.category} />
                  <Field label="State" value={torrent.state} />
                  <Field label="Ratio" value={torrent.ratio} />
                  <Field
                    label="Seed time"
                    value={formatSeedTime(torrent.seeding_time)}
                  />
                  <Field
                    label="Size"
                    value={formatBytes(torrent.total_size || torrent.size)}
                  />
                  <Field label="Save path" value={torrent.save_path} />
                  <Field label="Content path" value={torrent.content_path} />
                </dl>
              ))}
              <ul className="mt-4 space-y-2 text-xs text-slate-400">
                {link.evidence.map((record) => (
                  <li key={record.id}>
                    History #{record.id} · Episode #{record.episodeId} ·{" "}
                    {record.eventType} · {record.date} · source: downloadId
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </section>
        <section className="mt-6 rounded-xl border border-slate-800 p-5">
          <h2 className="text-xl">Seasons and episodes</h2>
          <p className="mt-2 text-sm text-slate-400">
            Counts show episodes with files / all known episodes. Unaired
            episodes and unknown air dates are listed separately, not as missing
            downloads.
          </p>
          <p className="mt-3 text-sm text-slate-400">
            History proves a past download relationship, not ownership of the
            current file. Multiple matching downloads for an episode remain
            ambiguous.
          </p>
          {!matching.episodes.length && (
            <p className="mt-3 text-slate-400">
              {preview.errors.length
                ? "Episodes unavailable or not returned."
                : "No episodes returned."}
            </p>
          )}
          {seasons.map((season) => {
            const entries = matching.episodes.filter(
              ({ episode }) => episode.seasonNumber === season,
            );
            const progress = episodeProgress(
              entries.map(({ episode }) => episode),
              now,
            );
            return (
              <details
                key={season}
                className="mt-4 border-t border-slate-800 pt-4"
              >
                <summary className="cursor-pointer">
                  {season === 0 ? "Specials" : `Season ${season}`}
                  <span
                    className={`ml-3 text-sm ${progress.downloaded === progress.total ? "text-emerald-300" : "text-amber-300"}`}
                  >
                    {progress.downloaded}/{progress.total} on disk
                  </span>
                  <span className="mt-1 block text-xs text-slate-400">
                    {progress.missing} missing · {progress.upcoming} not aired
                    yet
                    {progress.unknown > 0
                      ? ` · ${progress.unknown} air date unknown`
                      : ""}
                  </span>
                </summary>
                <ul className="mt-3 space-y-3">
                  {entries.map(({ episode, status, hashes }) => {
                    const file = preview.files.find(
                      (item) => item.id === episode.episodeFileId,
                    );
                    return (
                      <li
                        key={episode.id}
                        className="rounded bg-slate-900 p-3 text-sm [overflow-wrap:anywhere]"
                      >
                        <p>
                          E{episode.episodeNumber} · {episode.title}
                        </p>
                        <p className="mt-1 text-slate-400">
                          {episodeFileState(episode, now)} · {status}
                        </p>
                        {file && (
                          <p className="mt-1 text-slate-400">
                            {file.path} · {formatBytes(file.size)}
                          </p>
                        )}
                        {!!hashes.length && (
                          <p className="mt-2 text-xs text-slate-400">
                            History hashes: {hashes.join(", ")}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </details>
            );
          })}
        </section>
        <section className="my-6 rounded-xl border border-amber-900 p-5">
          <h2 className="text-xl">Deletion not enabled</h2>
          <p className="mt-3 text-sm text-slate-400">
            Read-only integration. No series, season, episode, torrent or file
            can be deleted here. Hash verification is not deletion
            authorization.
          </p>
          <button
            disabled
            className="mt-4 cursor-not-allowed rounded bg-slate-800 px-4 py-2 text-slate-500"
          >
            Delete (not enabled yet)
          </button>
        </section>
        <Suspense
          fallback={
            <p className="mt-4 text-sm text-slate-400">
              Checking filesystem metadata…
            </p>
          }
        >
          <FilesystemEvidence
            paths={[
              preview.files[0]?.path ?? series?.path,
              ...matching.links.flatMap((link) =>
                link.matches.map((torrent) => torrent.content_path),
              ),
              ...preview.files.slice(1).map((file) => file.path),
            ].filter((path): path is string => Boolean(path))}
          />
        </Suspense>
      </div>
    </div>
  );
}
function Field({ label, value }: { label: string; value?: string | number }) {
  return (
    <div className="[overflow-wrap:anywhere]">
      <dt className="text-slate-500">{label}</dt>
      <dd>{value ?? "—"}</dd>
    </div>
  );
}
