import { inspectMediaPaths } from "@/lib/server/filesystem";

export async function FilesystemEvidence({ paths }: { paths: string[] }) {
  const result = await inspectMediaPaths(paths);
  return (
    <section
      className="mt-6 rounded-xl border border-slate-800 p-5"
      aria-label="Filesystem observations"
    >
      <h2 className="text-xl">Read-only filesystem check</h2>
      {!result.enabled ? (
        <p className="mt-3 text-sm text-slate-400">
          Hardlink verification unavailable in local development. Filesystem
          inspection is disabled.
        </p>
      ) : (
        <>
          <p className="mt-3 text-sm text-amber-300">
            SMB hardlink verification: NOT VERIFIED. These mount-level inode and
            link counts are diagnostic only. Native NAS evidence, when enabled,
            is shown separately above. No deletion safety is implied.
          </p>
          <p className="mt-2 text-xs text-slate-400">
            Metadata only, at most four paths per preview. Directories are not
            scanned; their size is not a recursive media size. Matching inode
            numbers alone do not authorize deletion.
          </p>
          {!result.observations.length && (
            <p className="mt-3 text-sm">No API paths available to inspect.</p>
          )}
          <ul className="mt-4 space-y-3">
            {result.observations.map((item) => (
              <li
                key={item.path}
                className="rounded bg-slate-900 p-3 text-sm [overflow-wrap:anywhere]"
              >
                <p>{item.path}</p>
                <p className="mt-1 text-slate-400">{item.status}</p>
                {item.kind && (
                  <p className="mt-2 text-xs text-slate-400">
                    {item.kind} · {item.filesystem} · {item.bytes} bytes ·
                    reported links: {item.links} · device: {item.device} ·
                    inode: {item.inode}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {result.truncated && (
            <p className="mt-3 text-sm text-amber-300">
              Partial inspection: additional paths were not inspected.
            </p>
          )}
        </>
      )}
    </section>
  );
}
