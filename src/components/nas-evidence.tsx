import {
  getNasEvidence,
  type NasEvidenceInput,
} from "@/lib/services/nas-evidence";

export async function NasEvidence(input: NasEvidenceInput) {
  let result: Awaited<ReturnType<typeof getNasEvidence>> | undefined;
  let errorMessage: string | undefined;
  try {
    result = await getNasEvidence(input);
  } catch (error) {
    errorMessage =
      error instanceof Error ? error.message : "Native inspection unavailable.";
  }
  const confirmed = result?.groups.filter((group) => group.confirmed) ?? [];
  const incomplete = result?.observations.some(
    (item) => item.status !== "observed",
  );
  const content = result ? (
    <>
      <p className="mt-3 text-cyan-300">
        {confirmed.length
          ? `${confirmed.length} library ↔ torrent hardlink group(s) confirmed on ZFS`
          : "No library ↔ torrent hardlink confirmed."}
      </p>
      <p className="mt-2 text-xs text-slate-400">
        Read-only impact preview · observed at {result.checkedAt}. qBittorrent
        file lists may be cached for 30 seconds; NAS metadata is read afresh.
      </p>
      {incomplete && (
        <p className="mt-2 text-amber-300">
          Inspection incomplete: some files could not be verified. See
          individual statuses.
        </p>
      )}
      <h3 className="mt-4 font-medium text-slate-200">
        Listed file paths ({result.files.length})
      </h3>
      <ul className="mt-2 space-y-2">
        {result.files.map((file, index) => (
          <li
            key={`${file.role}:${file.path}:${index}`}
            className="rounded bg-slate-900 p-3 text-sm"
          >
            <div className="flex flex-wrap justify-between gap-2">
              <span className="text-slate-200">{file.role}</span>
              <span
                className={
                  file.link?.confirmed
                    ? "text-cyan-300"
                    : file.observation?.status === "observed"
                      ? "text-slate-400"
                      : "text-amber-300"
                }
              >
                {file.link?.confirmed
                  ? "Hardlink confirmed"
                  : file.observation?.status === "observed"
                    ? "No listed hardlink pair"
                    : (file.observation?.status ?? "Not observed")}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              {file.size ? `${file.size} bytes · ` : ""}
              {file.path}
            </p>
            {file.observation?.status === "observed" && (
              <p className="mt-1 text-xs text-slate-500">
                ZFS device {file.observation.device} · inode{" "}
                {file.observation.inode} · live links {file.observation.links}
              </p>
            )}
          </li>
        ))}
      </ul>
      <ul className="mt-4 space-y-3">
        {result.groups.map((group, index) => (
          <li key={index} className="rounded bg-slate-900 p-3 text-sm">
            <p className={group.confirmed ? "text-cyan-300" : "text-slate-300"}>
              {group.confirmed
                ? "Hardlink confirmed"
                : group.stable
                  ? "Observed file (no library/torrent pair confirmed)"
                  : "Metadata changed or inconsistent — not verified"}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Device {group.items[0].device} · inode {group.items[0].inode} ·
              links {group.items[0].links} · {group.items[0].bytes} bytes
            </p>
            <p className="mt-1 text-xs text-amber-300">
              {group.remainingLinks === null
                ? "Cannot account for remaining links."
                : `${group.items.length} known path(s); ${group.remainingLinks} additional live link(s) outside these listed paths.`}
            </p>
            {group.items.map((item) => (
              <p
                key={item.path}
                className="mt-2 text-xs [overflow-wrap:anywhere]"
              >
                {item.path}
              </p>
            ))}
          </li>
        ))}
      </ul>
      {result.observations
        .filter((item) => item.status !== "observed")
        .map((item) => (
          <p
            key={item.path}
            className="mt-2 text-sm text-amber-300 [overflow-wrap:anywhere]"
          >
            {item.status}: {item.path}
          </p>
        ))}
    </>
  ) : (
    <p className="mt-3 text-sm text-amber-300">{errorMessage}</p>
  );
  return (
    <section
      aria-label="Native NAS evidence"
      className="mt-6 rounded-xl border border-slate-800 p-5"
    >
      <h2 className="text-xl">Native NAS hardlink evidence</h2>
      {content}
      <p className="mt-4 text-sm text-slate-400">
        Read-only observations, not deletion authorization. Extra hardlink
        paths, unrelated files in folders, ZFS snapshots, open handles and
        shared torrent ownership are not audited. No permanent erasure or
        freed-space guarantee. Movie deletion uses a separate fresh check.
      </p>
    </section>
  );
}
