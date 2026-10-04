import { requireCondition } from "./deletion-policy";
import type {
  SeriesDeletionPlan,
  SeriesDeletionOperation,
} from "./types/series-deletion";

export interface SeriesDeletionDependencies {
  preflight: () => Promise<SeriesDeletionPlan>;
  beforeFirstMutation: (plan: SeriesDeletionPlan) => Promise<void>;
  persist: (operation: SeriesDeletionOperation) => Promise<void>;
  beforeTorrent: (
    plan: SeriesDeletionPlan,
    removed: string[],
    hash: string,
  ) => Promise<void>;
  removeTorrent: (hash: string) => Promise<void>;
  verifyTorrent: (plan: SeriesDeletionPlan, removed: string[]) => Promise<void>;
  checkLibrary: (plan: SeriesDeletionPlan) => Promise<void>;
  removeLibrary: (plan: SeriesDeletionPlan) => Promise<void>;
  verifyLibrary: (plan: SeriesDeletionPlan) => Promise<void>;
  removeSeriesRecord: (plan: SeriesDeletionPlan) => Promise<void>;
  verifySeries: (plan: SeriesDeletionPlan) => Promise<void>;
  removeSeerr: (plan: SeriesDeletionPlan) => Promise<void>;
  verifySeerr: (plan: SeriesDeletionPlan) => Promise<void>;
}
/** Journal each single-hash write before calling it; never retry an uncertain mutation. */
export async function runSeriesDeletion(
  operation: SeriesDeletionOperation,
  deps: SeriesDeletionDependencies,
) {
  const save = async () => {
    operation.updatedAt = new Date().toISOString();
    await deps.persist(operation);
  };
  try {
    const plan = await deps.preflight();
    requireCondition(
      JSON.stringify(plan) === JSON.stringify(operation.plan),
      "The confirmed series plan changed. Prepare a new plan.",
    );
    await deps.beforeFirstMutation(plan);
    const removed: string[] = [];
    for (const [index, torrent] of plan.torrents.entries()) {
      await deps.beforeTorrent(plan, [...removed], torrent.hash);
      operation.torrents[index].state = "requested";
      operation.message = `Removing torrent ${index + 1}/${plan.torrents.length}: ${torrent.name}`;
      await save();
      await deps.removeTorrent(torrent.hash);
      removed.push(torrent.hash);
      await deps.verifyTorrent(plan, [...removed]);
      operation.torrents[index].state = "verified";
      operation.message = `${index + 1}/${plan.torrents.length} torrents and data removal verified.`;
      await save();
    }
    await deps.checkLibrary(plan);
    operation.library = "requested";
    operation.message =
      "Removing the exact, revalidated NAS library inventory.";
    await save();
    await deps.removeLibrary(plan);
    await deps.verifyLibrary(plan);
    operation.library = "verified";
    operation.message =
      "All inspected library files and directories are absent.";
    await save();
    operation.sonarr = "requested";
    operation.message = `Removing the ${plan.instance === "anime" ? "Sonarr Anime" : "Sonarr TV"} record only; NAS files were already verified absent.`;
    await save();
    await deps.removeSeriesRecord(plan);
    await deps.verifySeries(plan);
    operation.sonarr = "verified";
    operation.seerr = "requested";
    operation.message =
      "Removing the confirmed Seerr series and related entries.";
    await save();
    await deps.removeSeerr(plan);
    await deps.verifySeerr(plan);
    operation.seerr = plan.seerr.mediaId === null ? "not-needed" : "verified";
    operation.status = "completed";
    operation.message =
      "Series record, confirmed torrents, listed live files and Seerr records removed. Snapshots/backups remain separate; empty folders may remain.";
    await save();
  } catch (error) {
    operation.status =
      operation.torrents.every((torrent) => torrent.state === "not-started") &&
      operation.library === "not-started" &&
      operation.sonarr === "not-started"
        ? "blocked"
        : "needs-attention";
    operation.message =
      error instanceof Error
        ? error.message
        : "Series deletion stopped. Review the operation journal.";
    await save();
  }
  return operation;
}
