import "server-only";
import { createHash } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import * as api from "../clients/deletion";
import { getRadarrConfig } from "../config/radarr";
import { getQBittorrentConfig } from "../config/qbittorrent";
import { getSonarrConfig } from "../config/sonarr";
import { getSeerrConfig } from "../config/seerr";
import { removeConfirmedSeerr, verifySeerrRemoval } from "./seerr";
import {
  assertLibraryAfterTorrent,
  movieLibraryAfterTorrent,
  requireCondition,
} from "../deletion-policy";
import { runMovieDeletion } from "../deletion-runner";
import {
  assertNativeCleanupAvailable,
  inspectDeletionRoots,
  removeNativeLibraryTree,
  validateNativeLibraryTree,
} from "../server/nas";
import {
  acquireDeletionLock,
  consumePlan,
  persistOperation,
  releaseDeletionLock,
  rememberPlan,
} from "../server/deletion-store";
import { invalidateGroup } from "../server/cache";
import { deletionEnabled } from "../server/deletion-access";
import {
  assertExclusiveOwnership,
  assertTorrentIsolation,
  prepareMovieDeletion,
} from "./movie-deletion-preflight";
import type { DeletionOperation, MovieDeletionPlan } from "../types/deletion";

function serviceBinding() {
  return createHash("sha256")
    .update(
      JSON.stringify([
        getRadarrConfig(),
        getQBittorrentConfig(),
        getSonarrConfig("tv"),
        getSonarrConfig("anime"),
        getSeerrConfig(),
      ]),
    )
    .digest("hex");
}

export async function prepareDeletion(movieId: number) {
  const binding = serviceBinding();
  return rememberPlan(await prepareMovieDeletion(movieId), binding);
}

async function pollRemoval(check: () => Promise<boolean>) {
  const deadline = Date.now() + 15_000;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await check()) return;
    if (Date.now() >= deadline) break;
    await pause(500);
  }
  throw new Error(
    "Removal was not fully verified. No automatic mutation retry; inspect the operation journal.",
  );
}

async function verifyTorrent(plan: MovieDeletionPlan) {
  await pollRemoval(async () => {
    const torrents = await api.freshTorrents();
    requireCondition(
      Array.isArray(torrents),
      "Torrent verification unavailable.",
    );
    if (
      torrents.some(
        (torrent) => torrent.hash.toLowerCase() === plan.torrentHash,
      )
    )
      return false;
    const [library, download] = await inspectDeletionRoots(
      plan.libraryRoot,
      plan.torrentRoot,
    );
    if (download.files.length) return false;
    assertLibraryAfterTorrent(plan, library, download);
    return true;
  });
}

async function checkLibrary(plan: MovieDeletionPlan) {
  const [movie] = await Promise.all([
    api.freshMovie(plan.movieId),
    assertExclusiveOwnership(plan),
    assertTorrentIsolation(plan),
  ]);
  requireCondition(
    movie.id === plan.movieId &&
      movie.path === plan.libraryRoot &&
      movie.movieFile?.id === plan.movieFileId,
    "Radarr file identity changed after torrent deletion.",
  );
  const [library, download] = await inspectDeletionRoots(
    plan.libraryRoot,
    plan.torrentRoot,
  );
  assertLibraryAfterTorrent(plan, library, download);
}

export async function executeDeletion(
  movieId: number,
  token: unknown,
  confirmation: unknown,
  acknowledged: unknown,
) {
  requireCondition(deletionEnabled(), "Movie deletion is disabled.");
  const binding = serviceBinding();
  const prepared = consumePlan(
    movieId,
    token,
    confirmation,
    acknowledged,
    binding,
  );
  const operation: DeletionOperation = {
    id: prepared.operationId,
    movieId,
    title: prepared.plan.title,
    plan: prepared.plan,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "running",
    torrent: "not-started",
    library: "not-started",
    radarr: "not-started",
    seerr: "not-started",
    message: "Revalidating the confirmed plan.",
  };
  await acquireDeletionLock(operation.id);
  try {
    await persistOperation(operation);
    await runMovieDeletion(operation, {
      persist: persistOperation,
      preflight: async () => {
        const plan = await prepareMovieDeletion(movieId);
        requireCondition(
          Date.parse(prepared.expiresAt) > Date.now() &&
            serviceBinding() === binding &&
            deletionEnabled(),
          "Plan expired or server configuration changed.",
        );
        return plan;
      },
      beforeFirstMutation: async (plan) => {
        await assertNativeCleanupAvailable();
        await validateNativeLibraryTree(plan.libraryRoot, plan.library);
      },
      removeTorrent: api.removeTorrentAndData,
      verifyTorrent,
      checkLibrary,
      removeLibrary: (plan) =>
        removeNativeLibraryTree(
          plan.libraryRoot,
          movieLibraryAfterTorrent(plan),
        ),
      verifyLibrary: async (plan) =>
        pollRemoval(async () => {
          const [library] = await inspectDeletionRoots(
            plan.libraryRoot,
            plan.torrentRoot,
          );
          requireCondition(
            library.device === plan.library.device,
            "NAS movie mount identity changed during cleanup.",
          );
          return library.files.length === 0 && library.directories.length === 0;
        }),
      removeMovieRecord: api.removeMovieRecord,
      removeSeerr: async (plan) => {
        requireCondition(plan.seerr, "Confirmed Seerr plan is missing.");
        await removeConfirmedSeerr(plan.seerr);
      },
      verifySeerr: async (plan) => {
        requireCondition(plan.seerr, "Confirmed Seerr plan is missing.");
        await pollRemoval(() => verifySeerrRemoval(plan.seerr!));
      },
      verifyComplete: async (plan) =>
        pollRemoval(async () => {
          if (!(await api.movieIsAbsent(plan.movieId))) return false;
          const torrents = await api.freshTorrents();
          requireCondition(
            Array.isArray(torrents),
            "Final torrent verification unavailable.",
          );
          if (
            torrents.some(
              (torrent) => torrent.hash.toLowerCase() === plan.torrentHash,
            )
          )
            return false;
          const [library, download] = await inspectDeletionRoots(
            plan.libraryRoot,
            plan.torrentRoot,
          );
          requireCondition(
            library.device === plan.library.device &&
              download.device === plan.download.device,
            "NAS media mount identity changed during final verification.",
          );
          return (
            !library.files.length &&
            !library.directories.length &&
            !download.files.length
          );
        }),
    });
    return operation;
  } finally {
    invalidateGroup("media");
    // Unknown outcomes and interrupted processes keep the durable lock for manual reconciliation.
    if (operation.status === "completed" || operation.status === "blocked")
      await releaseDeletionLock(operation.id);
  }
}
