import "server-only";
import { createHash } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { getRadarrConfig } from "../config/radarr";
import { getSonarrConfig } from "../config/sonarr";
import { getQBittorrentConfig } from "../config/qbittorrent";
import { getSeerrConfig } from "../config/seerr";
import { seriesDeletionEnabled } from "../server/deletion-access";
import {
  rememberScopedPlan,
  consumeScopedPlan,
  persistOperation,
  acquireDeletionLock,
  releaseDeletionLock,
} from "../server/deletion-store";
import {
  assertNativeCleanupAvailable,
  inspectSeriesDeletionRoots,
  removeNativeLibraryTree,
  validateNativeLibraryTree,
} from "../server/nas";
import { invalidateGroup } from "../server/cache";
import { requireCondition } from "../deletion-policy";
import {
  assertSeriesAfterTorrents,
  seriesLibraryAfterTorrents,
} from "../series-deletion-policy";
import { runSeriesDeletion } from "../series-deletion-runner";
import * as api from "../clients/series-deletion";
import {
  prepareSeriesDeletion,
  assertSeriesHashOwners,
  assertSeriesLibraries,
  assertSeriesTorrentIsolation,
  assertCurrentSeries,
} from "./series-deletion-preflight";
import { removeConfirmedSeerrSeries, verifySeerrSeries } from "./seerr-series";
import type { SonarrInstance } from "../types/sonarr";
import type {
  SeriesDeletionOperation,
  SeriesDeletionPlan,
} from "../types/series-deletion";

function binding() {
  return createHash("sha256")
    .update(
      JSON.stringify([
        getRadarrConfig(),
        getSonarrConfig("tv"),
        getSonarrConfig("anime"),
        getQBittorrentConfig(),
        getSeerrConfig(),
      ]),
    )
    .digest("hex");
}
const scope = (instance: SonarrInstance, id: number) =>
  `series:${instance}:${id}`;
export async function prepareSeriesRemoval(
  instance: SonarrInstance,
  id: number,
) {
  const config = binding(),
    plan = await prepareSeriesDeletion(instance, id);
  return rememberScopedPlan(
    scope(instance, id),
    plan,
    config,
    `DELETE ${plan.title} (${plan.year ?? "unknown year"}) [Sonarr ${instance === "anime" ? "Anime" : "TV"}]`,
  );
}
async function poll(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await check()) return;
    await pause(500);
  }
  throw new Error(
    "Series removal was not fully verified. Review the operation journal; mutations are not automatically retried.",
  );
}
const inventory = (plan: SeriesDeletionPlan) =>
  inspectSeriesDeletionRoots(
    plan.instance,
    plan.libraryRoot,
    plan.torrents.map((torrent) => torrent.root),
  );
const importPathProofs = (plan: SeriesDeletionPlan) =>
  new Set(
    plan.torrents
      .filter((torrent) => torrent.matchEvidence === "history-import-path")
      .map((torrent) => torrent.hash),
  );
export async function executeSeriesRemoval(
  instance: SonarrInstance,
  id: number,
  token: unknown,
  confirmation: unknown,
  acknowledged: unknown,
) {
  requireCondition(seriesDeletionEnabled(), "Series deletion is disabled.");
  const config = binding();
  const prepared = consumeScopedPlan<SeriesDeletionPlan>(
    scope(instance, id),
    token,
    confirmation,
    acknowledged,
    config,
  );
  const operation: SeriesDeletionOperation = {
    kind: "series",
    id: prepared.operationId,
    instance,
    seriesId: id,
    title: prepared.plan.title,
    plan: prepared.plan,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "running",
    torrents: prepared.plan.torrents.map((torrent) => ({
      hash: torrent.hash,
      state: "not-started",
    })),
    library: "not-started",
    sonarr: "not-started",
    seerr: "not-started",
    message: "Revalidating the confirmed series plan.",
  };
  await acquireDeletionLock(operation.id);
  try {
    await persistOperation(operation);
    await runSeriesDeletion(operation, {
      persist: persistOperation,
      preflight: async () => {
        const plan = await prepareSeriesDeletion(instance, id);
        requireCondition(
          Date.parse(prepared.expiresAt) > Date.now() &&
            config === binding() &&
            seriesDeletionEnabled(),
          "Series plan expired or configuration changed.",
        );
        return plan;
      },
      beforeFirstMutation: async (plan) => {
        await assertNativeCleanupAvailable();
        await validateNativeLibraryTree(plan.libraryRoot, plan.library);
      },
      beforeTorrent: async (plan, removed, hash) => {
        await Promise.all([
          assertCurrentSeries(plan),
          assertSeriesLibraries(plan),
          assertSeriesHashOwners(plan, [hash], importPathProofs(plan)),
          assertSeriesTorrentIsolation(plan, removed),
        ]);
        assertSeriesAfterTorrents(plan, await inventory(plan), removed);
      },
      removeTorrent: api.removeSeriesTorrent,
      verifyTorrent: async (plan, removed) =>
        poll(async () => {
          try {
            await assertSeriesTorrentIsolation(plan, removed);
            const roots = await inventory(plan);
            if (
              roots
                .slice(1)
                .some(
                  (root, i) =>
                    removed.includes(plan.torrents[i].hash) &&
                    root.files.length,
                )
            )
              return false;
            assertSeriesAfterTorrents(plan, roots, removed);
            return true;
          } catch (error) {
            // Only the absence checks can be retried; changed identities/ownership fail immediately.
            if (
              error instanceof Error &&
              error.message ===
                "A removed torrent is still present or was re-added."
            )
              return false;
            throw error;
          }
        }),
      checkLibrary: async (plan) => {
        await Promise.all([
          assertCurrentSeries(plan),
          assertSeriesLibraries(plan),
          assertSeriesHashOwners(
            plan,
            plan.torrents.map((torrent) => torrent.hash),
            importPathProofs(plan),
          ),
          assertSeriesTorrentIsolation(
            plan,
            plan.torrents.map((torrent) => torrent.hash),
          ),
        ]);
        assertSeriesAfterTorrents(
          plan,
          await inventory(plan),
          plan.torrents.map((torrent) => torrent.hash),
        );
      },
      removeLibrary: async (plan) =>
        removeNativeLibraryTree(
          plan.libraryRoot,
          seriesLibraryAfterTorrents(plan),
        ),
      verifyLibrary: async (plan) =>
        poll(async () => {
          const roots = await inventory(plan);
          const library = roots[0];
          requireCondition(
            library.root === plan.libraryRoot &&
              library.device === plan.library.device,
            "NAS library mount identity changed during cleanup.",
          );
          return library.files.length === 0 && library.directories.length === 0;
        }),
      removeSeriesRecord: (plan) =>
        api.removeSeriesRecord(plan.instance, plan.seriesId),
      verifySeries: async (plan) =>
        poll(async () => {
          if (!(await api.seriesIsAbsent(plan.instance, plan.seriesId)))
            return false;
          await assertSeriesTorrentIsolation(
            plan,
            plan.torrents.map((torrent) => torrent.hash),
          );
          const roots = await inventory(plan),
            before = [
              plan.library,
              ...plan.torrents.map((torrent) => torrent.inventory),
            ];
          requireCondition(
            roots.every(
              (root, i) =>
                root.device === before[i].device &&
                root.root === before[i].root,
            ),
            "NAS mount identity changed during final verification.",
          );
          return (
            roots[0].files.length === 0 &&
            roots[0].directories.length === 0 &&
            roots.slice(1).every((root) => root.files.length === 0)
          );
        }),
      removeSeerr: (plan) => removeConfirmedSeerrSeries(plan.seerr),
      verifySeerr: (plan) => poll(() => verifySeerrSeries(plan.seerr)),
    });
    return operation;
  } finally {
    invalidateGroup("media");
    if (operation.status === "completed" || operation.status === "blocked")
      await releaseDeletionLock(operation.id);
  }
}
