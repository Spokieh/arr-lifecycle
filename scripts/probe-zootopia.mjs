// Read-only diagnostic, run inside the deployed container with its existing env.
async function read(base, path, headers = {}) {
  const response = await fetch(base.replace(/\/+$/, "") + path, {
    method: "GET", headers, redirect: "error", signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Read failed: HTTP ${response.status}`);
  return response.json();
}
const headers = { "X-Api-Key": process.env.RADARR_API_KEY };
const movies = await read(process.env.RADARR_URL, "/api/v3/movie", headers);
const selected = movies.filter((movie) => movie.title.toLowerCase() === "zootopia 2");
if (selected.length !== 1) throw new Error(`Expected one exact title, received ${selected.length}`);
const movie = await read(process.env.RADARR_URL, `/api/v3/movie/${selected[0].id}`, headers);
const history = await read(process.env.RADARR_URL, `/api/v3/history/movie?movieId=${movie.id}`, headers);
const hashes = [...new Set(history.filter((record) => record.movieId === movie.id && typeof record.downloadId === "string" && /^[a-f0-9]{40}$|^[a-f0-9]{64}$/i.test(record.downloadId)).map((record) => record.downloadId.toLowerCase()))];
// This server already allows its own client unauthenticated read access.
const torrents = await read(process.env.QBIT_URL, "/api/v2/torrents/info");
const matches = torrents.filter((torrent) => hashes.includes(torrent.hash.toLowerCase()));
console.log(JSON.stringify({
  movie: { id: movie.id, title: movie.title, year: movie.year, path: movie.path, hasFile: movie.hasFile, file: movie.movieFile && { id: movie.movieFile.id, path: movie.movieFile.path, relativePath: movie.movieFile.relativePath, size: movie.movieFile.size } },
  historyHashes: hashes,
  matches: await Promise.all(matches.map(async (torrent) => ({
    hash: torrent.hash, name: torrent.name, category: torrent.category, savePath: torrent.save_path, contentPath: torrent.content_path,
    files: await read(process.env.QBIT_URL, `/api/v2/torrents/files?hash=${encodeURIComponent(torrent.hash)}`),
  }))),
}, null, 2));
