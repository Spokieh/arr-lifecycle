"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DeletionOperation, PreparedDeletion } from "@/lib/types/deletion";
import type {
  PreparedSeriesDeletion,
  SeriesDeletionPlan,
  SeriesDeletionOperation,
} from "@/lib/types/series-deletion";
import type { SonarrInstance } from "@/lib/types/sonarr";

export function MediaDeletion(
  props: { enabled: boolean } & (
    { movieId: number } | { seriesId: number; instance: SonarrInstance }
  ),
) {
  const { enabled } = props;
  const movie = "movieId" in props;
  const arrLabel = movie
    ? "Radarr"
    : props.instance === "anime"
      ? "Sonarr Anime"
      : "Sonarr TV";
  const endpoint = movie
    ? `/api/movies/${props.movieId}/deletion`
    : `/api/shows/${props.instance}/${props.seriesId}/deletion`;
  const listPath = movie ? "/movies" : `/shows?source=${props.instance}`;
  const [prepared, setPrepared] = useState<
    PreparedDeletion | PreparedSeriesDeletion
  >();
  const [readOnlySeriesPlan, setReadOnlySeriesPlan] =
    useState<SeriesDeletionPlan>();
  const [operation, setOperation] = useState<
    DeletionOperation | SeriesDeletionOperation
  >();
  const [operationId, setOperationId] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const operationStatus = operation?.status;
  const plan = prepared?.plan;
  const seriesPlan = plan && "seriesId" in plan ? plan : undefined;
  const moviePlan = plan && "movieId" in plan ? plan : undefined;
  const fileGroups = seriesPlan
    ? [
        { title: "Library files", inventory: seriesPlan.library },
        ...seriesPlan.torrents.map((torrent) => ({
          title: `Torrent: ${torrent.name} · ${torrent.hash} · ${torrent.category}`,
          inventory: torrent.inventory,
        })),
      ]
    : moviePlan
      ? [
          { title: "Library files", inventory: moviePlan.library },
          { title: "Torrent files", inventory: moviePlan.download },
        ]
      : [];

  async function loadReadOnlyPreview() {
    if (movie || !("seriesId" in props)) return;
    setBusy(true);
    setError("");
    setPrepared(undefined);
    setReadOnlySeriesPlan(undefined);
    try {
      const response = await fetch(
        `/api/shows/${props.instance}/${props.seriesId}/preview`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "Read-only safety checks failed.");
      setReadOnlySeriesPlan(data.plan as SeriesDeletionPlan);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Read-only safety checks failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (
      !busy ||
      !attempted ||
      !operationId ||
      (operationStatus && operationStatus !== "running")
    )
      return;
    const controller = new AbortController();
    let pending = false;
    const timer = setInterval(async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "status", operationId }),
          signal: controller.signal,
        });
        if (response.ok) {
          const data = await response.json();
          if (!controller.signal.aborted && data.operation)
            setOperation(data.operation);
        }
      } catch {
        /* Execution remains single-attempt; status polling is read-only. */
      } finally {
        pending = false;
      }
    }, 2000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [busy, attempted, operationId, endpoint, operationStatus]);

  async function submit(action: "prepare" | "execute" | "status") {
    setBusy(true);
    setError("");
    if (action === "execute") setAttempted(true);
    if (action === "prepare") {
      setPrepared(undefined);
      setOperation(undefined);
      setConfirmation("");
      setAcknowledged(false);
      setAttempted(false);
    }
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          token: prepared?.token,
          confirmation,
          acknowledged,
          operationId,
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "Deletion request failed.");
      if (data.prepared) {
        setPrepared(data.prepared);
        setOperationId(data.prepared.operationId);
      }
      if (data.operation) {
        setOperation(data.operation);
        setPrepared(undefined);
        if (data.operation.status === "blocked") setAttempted(false);
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Connection interrupted. Check the operation status before doing anything else.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!enabled && !movie)
    return (
      <div className="mt-5 space-y-4">
        <p className="text-xs text-slate-400">
          Read-only checks do not enable or perform deletion.
        </p>
        <button
          onClick={loadReadOnlyPreview}
          disabled={busy}
          className="rounded-lg bg-slate-700 px-4 py-2 text-sm disabled:opacity-50"
        >
          {busy ? "Checking…" : "Run read-only safety checks"}
        </button>
        <button
          disabled
          className="cursor-not-allowed rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-500"
        >
          Delete (not enabled yet)
        </button>
        {error && (
          <p role="alert" className="text-sm text-amber-300">
            {error}
          </p>
        )}
        {readOnlySeriesPlan && (
          <div className="space-y-4 rounded-xl border border-slate-700 p-4">
            <p className="font-medium">
              Read-only preview · {readOnlySeriesPlan.title} (
              {readOnlySeriesPlan.year ?? "—"}) · {arrLabel} #
              {readOnlySeriesPlan.seriesId}
            </p>
            <p className="text-sm text-slate-300">
              {readOnlySeriesPlan.torrents.length} torrent(s) ·{" "}
              {readOnlySeriesPlan.episodeFiles.length} current episode file(s) ·
              entire series
            </p>
            {readOnlySeriesPlan.torrents.map((torrent) => (
              <p key={torrent.hash} className="break-all text-xs text-cyan-200">
                {torrent.matchEvidence === "history-import-path"
                  ? `Matched by exact Sonarr import paths · episode file IDs: ${torrent.matchedEpisodeFileIds?.join(", ") || "—"}`
                  : "Matched by exact Sonarr download hash"}
              </p>
            ))}
            {[
              {
                title: "Library files",
                inventory: readOnlySeriesPlan.library,
              },
              ...readOnlySeriesPlan.torrents.map((torrent) => ({
                title: `Torrent: ${torrent.name} · ${torrent.hash} · ${torrent.category}`,
                inventory: torrent.inventory,
              })),
            ].map(({ title, inventory }) => (
              <details key={title} open>
                <summary className="text-sm font-medium">
                  {title} ({inventory.files.length})
                </summary>
                <ul className="mt-2 space-y-2 text-xs text-slate-300">
                  {inventory.files.map((file) => (
                    <li key={file.path} className="[overflow-wrap:anywhere]">
                      {file.path}
                      <span className="block text-slate-500">
                        {file.bytes} bytes · {file.links} live link(s)
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
            <p className="text-xs text-slate-400">
              Seerr:{" "}
              {readOnlySeriesPlan.seerr.mediaId != null
                ? `media #${readOnlySeriesPlan.seerr.mediaId} · TMDB ${readOnlySeriesPlan.seerr.tmdbId} · requests: ${readOnlySeriesPlan.seerr.requestIds.join(", ") || "none"} · issues: ${readOnlySeriesPlan.seerr.issueIds.join(", ") || "none"}.`
                : "No matching media record."}
            </p>
            <p className="text-sm text-emerald-300">
              Read-only checks passed. No deletion token was created; deletion
              remains disabled.
            </p>
          </div>
        )}
      </div>
    );

  if (!enabled)
    return (
      <button
        disabled
        className="mt-5 cursor-not-allowed rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-500"
      >
        Delete (not enabled yet)
      </button>
    );

  const unresolved =
    attempted ||
    operation?.status === "needs-attention" ||
    operation?.status === "running";
  return (
    <div className="mt-5 space-y-4 border-t border-slate-700 pt-5">
      <h3 className="font-medium">
        {movie
          ? "Delete movie and torrent"
          : `Delete entire series · ${arrLabel}`}
      </h3>
      <p className="text-xs text-slate-400">
        Preparing a plan reads current service and NAS data.
      </p>
      <button
        onClick={() => submit("prepare")}
        disabled={busy || Boolean(unresolved)}
        className="rounded-lg bg-slate-700 px-4 py-2 text-sm disabled:opacity-40"
      >
        {busy ? "Working…" : "Prepare deletion"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-amber-300">
          {error}
        </p>
      )}
      {prepared && plan && (
        <div className="space-y-4 rounded-xl border border-rose-900 bg-rose-950/20 p-4">
          <p className="font-medium">
            {plan.title} ({plan.year ?? "—"}) · {arrLabel} #
            {seriesPlan?.seriesId ?? moviePlan?.movieId}
          </p>
          <p className="text-sm text-slate-300">
            {seriesPlan
              ? `${seriesPlan.torrents.length} torrent(s) · ${seriesPlan.episodeFiles.length} current episode file(s) · entire series`
              : `Torrent: ${moviePlan?.torrentName}`}
          </p>
          {seriesPlan?.torrents.map((torrent) => (
            <p key={torrent.hash} className="break-all text-xs text-cyan-200">
              {torrent.matchEvidence === "history-import-path"
                ? `Matched by exact Sonarr import paths · episode file IDs: ${torrent.matchedEpisodeFileIds?.join(", ") || "—"}`
                : "Matched by exact Sonarr download hash"}
            </p>
          ))}
          <p className="break-all text-xs text-slate-400">
            {moviePlan && `${moviePlan.torrentHash} · MoviesRR`}
          </p>
          <p className="text-sm">
            This removes the confirmed torrents and their data, then the
            inspected library files, the {arrLabel} record, and the confirmed
            Seerr entries. Every step is checked before continuing.
          </p>
          {fileGroups.map(({ title, inventory }) => (
            <details key={title} open>
              <summary className="text-sm font-medium">
                {title} ({inventory.files.length})
              </summary>
              <ul className="mt-2 space-y-2 text-xs text-slate-300">
                {inventory.files.map((file) => (
                  <li key={file.path} className="[overflow-wrap:anywhere]">
                    {file.path}
                    <span className="block text-slate-500">
                      {file.bytes} bytes · {file.links} live link(s)
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
          <p className="text-xs text-slate-400">
            Seerr:{" "}
            {prepared.plan.seerr?.mediaId != null
              ? `media #${prepared.plan.seerr.mediaId} · TMDB ${prepared.plan.seerr.tmdbId} · requests: ${prepared.plan.seerr.requestIds.join(", ") || "none"} · issues: ${prepared.plan.seerr.issueIds.join(", ") || "none"}. Linked watchlist entries are also removed.`
              : "No matching media record; no Seerr deletion required."}
          </p>
          <p className="text-xs text-slate-400">
            Confirmation expires at {prepared.expiresAt}. Files and ownership
            are checked again on execution. Snapshots/backups can retain copies;
            empty folders may remain.
          </p>
          <label className="block text-sm">
            Type <span className="font-semibold">{prepared.confirmation}</span>
            <input
              autoComplete="off"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              disabled={busy || attempted}
              className="mt-2 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              disabled={busy || attempted}
              className="mt-1"
            />
            I confirm removal of the {arrLabel}{" "}
            {movie ? "movie" : "entire series"}, torrent and listed Seerr
            records, related Seerr watchlist entries, and all listed live file
            paths. I understand snapshots and backups are separate.
          </label>
          <button
            onClick={() => submit("execute")}
            disabled={
              busy ||
              attempted ||
              confirmation !== prepared.confirmation ||
              !acknowledged
            }
            className="rounded-lg bg-rose-700 px-4 py-2 font-medium disabled:opacity-40"
          >
            Confirm delete
          </button>
        </div>
      )}
      {operation && (
        <div
          role="status"
          className="space-y-2 rounded-xl border border-slate-700 p-4 text-sm"
        >
          <p className="font-semibold">{operation.status}</p>
          <p>
            {"torrents" in operation
              ? `qBittorrent: ${operation.torrents.filter((torrent) => torrent.state === "verified").length}/${operation.torrents.length} verified · NAS files: ${operation.library ?? "not-started"} · ${arrLabel}: ${operation.sonarr}`
              : `qBittorrent: ${operation.torrent} · NAS files: ${operation.library ?? "not-started"} · Radarr: ${operation.radarr}`}
            {operation.seerr && ` · Seerr: ${operation.seerr}`}
          </p>
          <p>{operation.message}</p>
          {operation.status === "needs-attention" && (
            <p className="text-amber-300">
              Further deletions are locked. Review this operation on the server;
              do not repeat the delete requests.
            </p>
          )}
          {operation.status === "completed" && (
            <Link
              href={`${listPath}${movie ? "?" : "&"}afterDeletion=${operation.id}`}
              prefetch={false}
              className="inline-block text-cyan-300"
            >
              Back to refreshed {movie ? "movie" : "show"} list →
            </Link>
          )}
        </div>
      )}
      <details className="text-sm text-slate-400">
        <summary>Operation status / recovery</summary>
        <p className="mt-2">
          Keep the operation ID if this page closes. Status checks never repeat
          deletion.
        </p>
        <input
          aria-label="Operation ID"
          value={operationId}
          onChange={(event) => setOperationId(event.target.value)}
          disabled={busy}
          className="mt-2 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
        />
        <button
          onClick={() => submit("status")}
          disabled={busy || !operationId}
          className="mt-2 rounded bg-slate-800 px-3 py-2 disabled:opacity-40"
        >
          Check operation status
        </button>
      </details>
      {operationId && (
        <p className="break-all text-xs text-slate-500">
          Operation: {operationId}
        </p>
      )}
    </div>
  );
}
