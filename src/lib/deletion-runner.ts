import type { DeletionOperation, MovieDeletionPlan } from "./types/deletion";
import { requireCondition } from "./deletion-policy";

export interface DeletionDependencies {
  preflight: () => Promise<MovieDeletionPlan>;
  beforeFirstMutation: (plan: MovieDeletionPlan) => Promise<void>;
  persist: (operation: DeletionOperation) => Promise<void>;
  removeTorrent: (hash: string) => Promise<void>;
  verifyTorrent: (plan: MovieDeletionPlan) => Promise<void>;
  checkLibrary: (plan: MovieDeletionPlan) => Promise<void>;
  removeLibrary: (plan: MovieDeletionPlan) => Promise<void>;
  verifyLibrary: (plan: MovieDeletionPlan) => Promise<void>;
  removeMovieRecord: (movieId: number) => Promise<void>;
  verifyComplete: (plan: MovieDeletionPlan) => Promise<void>;
  removeSeerr: (plan: MovieDeletionPlan) => Promise<void>;
  verifySeerr: (plan: MovieDeletionPlan) => Promise<void>;
}

/** One attempt per external write; the journal precedes every irreversible step. */
export async function runMovieDeletion(
  operation: DeletionOperation,
  deps: DeletionDependencies,
) {
  const save = async () => {
    operation.updatedAt = new Date().toISOString();
    await deps.persist(operation);
  };
  try {
    const fresh = await deps.preflight();
    requireCondition(
      JSON.stringify(fresh) === JSON.stringify(operation.plan),
      "The confirmed plan changed. Prepare and confirm a new plan.",
    );
    await deps.beforeFirstMutation(fresh);
    operation.torrent = "requested";
    operation.message = "Removing the selected torrent and its data.";
    await save();
    await deps.removeTorrent(fresh.torrentHash);
    await deps.verifyTorrent(fresh);
    operation.torrent = "verified";
    operation.message =
      "Torrent and data removal verified; library files retained.";
    await save();
    await deps.checkLibrary(fresh);
    operation.library = "requested";
    operation.message = "Removing the exact, revalidated NAS movie inventory.";
    await save();
    await deps.removeLibrary(fresh);
    await deps.verifyLibrary(fresh);
    operation.library = "verified";
    operation.message = "All inspected movie files and directories are absent.";
    await save();
    operation.radarr = "requested";
    operation.message =
      "Removing the Radarr record only; NAS files were already verified absent.";
    await save();
    await deps.removeMovieRecord(fresh.movieId);
    await deps.verifyComplete(fresh);
    operation.radarr = "verified";
    if (fresh.seerr) {
      operation.seerr = "requested";
      operation.message =
        "Removing the confirmed Seerr media record and related entries.";
      await save();
      await deps.removeSeerr(fresh);
      await deps.verifySeerr(fresh);
      operation.seerr =
        fresh.seerr.mediaId === null ? "not-needed" : "verified";
    }
    operation.status = "completed";
    operation.message =
      "Radarr record, torrent and listed live files removed. Confirmed Seerr records cleared. Snapshots/backups were not changed; empty folders may remain.";
    await save();
  } catch (error) {
    operation.status =
      operation.torrent === "not-started" ? "blocked" : "needs-attention";
    operation.message =
      error instanceof Error
        ? error.message
        : "Deletion stopped. Review the operation journal.";
    await save();
  }
  return operation;
}
