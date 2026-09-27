import type { HashEvidence } from "@/lib/services/matching";
import type { QBittorrentTorrent } from "@/lib/types/qbittorrent";

export function MatchEvidence({
  evidence,
  exactMatches,
  candidates,
  unavailable,
}: {
  evidence: HashEvidence[];
  exactMatches: QBittorrentTorrent[];
  candidates: QBittorrentTorrent[];
  unavailable: boolean;
}) {
  return (
    <section
      aria-label="Matching evidence"
      className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-6"
    >
      <h2 className="text-xl font-medium">Matching evidence</h2>
      <p className="mt-3 text-sm text-slate-400">
        Radarr movie ID → history hash → qBittorrent hash → MoviesRR category.
        Paths and titles are not proof of a connection or file ownership.
      </p>
      {unavailable && (
        <p className="mt-3 text-sm text-amber-300">
          Lookup incomplete. Available history below is diagnostic only; no
          match is verified.
        </p>
      )}
      <h3 className="mt-5 font-medium">
        Radarr history hash sources ({evidence.length})
      </h3>
      {evidence.length ? (
        <ul className="mt-3 space-y-3">
          {evidence.map((entry, index) => {
            const matched = exactMatches.some(
              (torrent) => torrent.hash.toLowerCase() === entry.hash,
            );
            return (
              <li
                key={`${entry.historyId}-${entry.source}-${index}`}
                className="rounded-lg border border-slate-700 p-3 text-sm"
              >
                <p>
                  History #{entry.historyId ?? "unknown"} · Movie #
                  {entry.movieId} · {entry.eventType || "Unknown event"}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {entry.date || "Date unavailable"}
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  Source field: <code>{entry.source}</code>
                </p>
                <code className="mt-1 block break-all text-cyan-200">
                  {entry.hash}
                </code>
                <p className="mt-2 text-xs text-slate-400">
                  {unavailable
                    ? "Torrent comparison unavailable"
                    : matched
                      ? "Hash present in qBittorrent (category and uniqueness checked separately)"
                      : "Hash not present in the current torrent list"}
                </p>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-slate-400">
          {unavailable
            ? "No hash evidence available from this lookup."
            : "No valid torrent hash returned in this movie’s Radarr history."}
        </p>
      )}
      {!!exactMatches.length && (
        <TorrentEvidence
          title="Exact hash matches"
          torrents={exactMatches}
          exact
        />
      )}
      {!!candidates.length && (
        <TorrentEvidence
          title="Title/year candidates — NOT hash-verified"
          torrents={candidates}
          exact={false}
        />
      )}
    </section>
  );
}

function TorrentEvidence({
  title,
  torrents,
  exact,
}: {
  title: string;
  torrents: QBittorrentTorrent[];
  exact: boolean;
}) {
  return (
    <div className="mt-5">
      <h3 className="font-medium">
        {title} ({torrents.length})
      </h3>
      <p className="mt-2 text-sm text-amber-300">
        {!exact
          ? "BLOCKED: title/year similarity is only a search hint, never hash proof."
          : torrents.length > 1
            ? "BLOCKED: multiple exact torrent matches; no torrent is selected automatically."
            : torrents[0].category !== "MoviesRR"
              ? "BLOCKED: unexpected torrent category; MoviesRR is required."
              : "One exact hash match in MoviesRR. Filesystem safety remains unverified."}
      </p>
      <ul className="mt-3 space-y-3">
        {torrents.map((torrent, index) => (
          <li
            key={`${torrent.hash}-${index}`}
            className="rounded-lg border border-slate-700 p-3 text-sm [overflow-wrap:anywhere]"
          >
            <p className="font-medium">{torrent.name}</p>
            <code className="mt-1 block text-xs text-cyan-200">
              {torrent.hash}
            </code>
            <p className="mt-2 text-slate-400">
              Category: {torrent.category || "Uncategorized"} · State:{" "}
              {torrent.state}
            </p>
            <p className="mt-1 text-slate-400">
              Content path: {torrent.content_path || "—"}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
