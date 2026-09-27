// Read-only diagnostic. Credentials are loaded by Node's --env-file, never printed.
const start = performance.now();
async function read(url, headers = {}) {
  const t = performance.now();
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const data = await r.json();
  return { data, ms: Math.round(performance.now() - t) };
}
try {
  const [history, torrents] = await Promise.all([
    read(process.env.RADARR_URL + "/api/v3/history/movie?movieId=148", {
      "X-Api-Key": process.env.RADARR_API_KEY,
    }),
    read(process.env.QBIT_URL + "/api/v2/torrents/info"),
  ]);
  const hashes = history.data
    .filter((r) => r.movieId === 148)
    .map((r) => r.downloadId)
    .filter(Boolean);
  console.log(
    JSON.stringify({
      historyMs: history.ms,
      torrentMs: torrents.ms,
      records: history.data.length,
      topLevelDownloadIds: hashes.length,
      exactMatches: torrents.data
        .filter((t) =>
          hashes.some((h) => h.toLowerCase() === t.hash.toLowerCase()),
        )
        .map((t) => ({ hash: t.hash, category: t.category })),
      elapsedMs: Math.round(performance.now() - start),
    }),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
