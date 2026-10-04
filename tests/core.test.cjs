/* eslint-disable @typescript-eslint/no-require-imports -- Node CJS hook compiles the TypeScript modules under test. */
const ts = require("typescript");
const fs = require("node:fs");
require.extensions[".ts"] = (module, filename) => {
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    filename,
  );
};
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { formatBytes } = require("../src/lib/format.ts");
const {
  canonicalNasPath,
  torrentFilePath,
  parseNasResult,
  summarizeHardlinks,
} = require("../src/lib/nas-evidence.ts");
const { inspectNas } = require("../src/lib/server/nas.ts");
test("native NAS requests reject unsafe paths and require explicit enabling", async () => {
  assert.equal(canonicalNasPath("/data/media/a"), "/data/media/a");
  assert.equal(canonicalNasPath("/data//media/a.mkv"), "/data/media/a.mkv");
  for (const path of [
    "/etc/passwd",
    "/data/media/",
    "/data/media/../a",
    "/data/media/.zfs/snapshot/a",
    "/data/media/a\0",
    "/data/media/a\\b",
    "/data/media-other/a",
  ])
    assert.equal(canonicalNasPath(path), null);
  assert.equal(
    torrentFilePath("/data/torrents/movies/", "folder/a.mkv"),
    "/data/torrents/movies/folder/a.mkv",
  );
  for (const name of ["/etc/passwd", "../a", "folder/../../a", "folder\\a", ""])
    assert.equal(torrentFilePath("/data/torrents/movies", name), null);
  assert.equal(torrentFilePath("/downloads", "a.mkv"), null);
  const previous = process.env.NAS_INSPECTION_ENABLED;
  try {
    process.env.NAS_INSPECTION_ENABLED = "false";
    await assert.rejects(inspectNas(["/data/media/a"]), /not enabled/);
    process.env.NAS_INSPECTION_ENABLED = "true";
    for (const paths of [
      [],
      ["/etc/passwd"],
      ["/data/media/a", "/data/media/a"],
      ["/data//media/a"],
      Array.from({ length: 65 }, (_, i) => `/data/media/${i}`),
    ])
      await assert.rejects(inspectNas(paths), /validation failed/);
  } finally {
    if (previous === undefined) delete process.env.NAS_INSPECTION_ENABLED;
    else process.env.NAS_INSPECTION_ENABLED = previous;
  }
});
const libraryPath = "/data/media/a",
  torrentPath = "/data/torrents/a";
const nativeObservation = (path, changes = {}) => ({
  path,
  status: "observed",
  filesystem: "zfs",
  device: "124",
  inode: "630094",
  links: 2,
  bytes: "1396946479",
  ...changes,
});
test("native proof requires distinct library/torrent paths on the same device and inode", () => {
  const summarize = (observations) =>
    summarizeHardlinks(observations, [libraryPath], [torrentPath]);
  const pair = [nativeObservation(libraryPath), nativeObservation(torrentPath)];
  assert.equal(summarize(pair)[0].confirmed, true);
  assert.equal(summarize(pair)[0].remainingLinks, 0);
  assert.equal(summarize([...pair, pair[0]])[0].items.length, 2);
  assert.equal(summarize([pair[0], pair[0]])[0].confirmed, false);
  for (const changes of [
    { inode: "999" },
    { device: "999" },
    { links: 3 },
    { bytes: "99" },
    { status: "unavailable" },
  ])
    assert.equal(
      summarize([pair[0], nativeObservation(torrentPath, changes)]).some(
        (group) => group.confirmed,
      ),
      false,
    );
  const extra = summarize(pair.map((item) => ({ ...item, links: 3 })))[0];
  assert.equal(extra.confirmed, true);
  assert.equal(extra.remainingLinks, 1);
  const inconsistent = summarize(
    pair.map((item) => ({ ...item, links: 1 })),
  )[0];
  assert.equal(inconsistent.confirmed, false);
  assert.equal(inconsistent.remainingLinks, null);
});
test("native response parser rejects incomplete, reordered or non-ZFS metadata", () => {
  const paths = [libraryPath, torrentPath];
  const valid = {
    version: 1,
    checkedAt: "2026-09-28T12:00:00Z",
    observations: paths.map((path) => nativeObservation(path)),
  };
  assert.deepEqual(parseNasResult(valid, paths), valid);
  for (const value of [
    null,
    {},
    { ...valid, version: 2 },
    { ...valid, checkedAt: "bad" },
    { ...valid, observations: valid.observations.slice(1) },
    { ...valid, observations: [...valid.observations].reverse() },
    {
      ...valid,
      observations: [
        nativeObservation(libraryPath, { filesystem: "cifs" }),
        valid.observations[1],
      ],
    },
    {
      ...valid,
      observations: [
        nativeObservation(libraryPath, { links: 0 }),
        valid.observations[1],
      ],
    },
    {
      ...valid,
      observations: [
        nativeObservation(libraryPath, { inode: 123 }),
        valid.observations[1],
      ],
    },
  ])
    assert.throws(() => parseNasResult(value, paths));
});
const {
  allowedMediaPath,
  inspectMediaPaths,
} = require("../src/lib/server/filesystem.ts");
test("filesystem inspection confines paths and remains disabled by default", async () => {
  assert.equal(
    allowedMediaPath("/data/media/movies/a.mkv"),
    "/data/media/movies/a.mkv",
  );
  assert.equal(allowedMediaPath("/media/tv/a.mkv"), "/data/media/tv/a.mkv");
  for (const path of [
    "/etc/passwd",
    "/data/media-other/a",
    "/data/media/../torrents/a",
    "/downloads/a",
    "C:\\media\\a",
    "/data/media/./a",
    "/data/media/a\0b",
  ])
    assert.equal(allowedMediaPath(path), null);
  const previous = process.env.FS_INSPECTION_ENABLED;
  try {
    process.env.FS_INSPECTION_ENABLED = "false";
    assert.deepEqual(await inspectMediaPaths(["/data/media/a"]), {
      enabled: false,
      truncated: false,
      observations: [],
    });
  } finally {
    if (previous === undefined) delete process.env.FS_INSPECTION_ENABLED;
    else process.env.FS_INSPECTION_ENABLED = previous;
  }
});
const { showFileBadge } = require("../src/lib/media-card.ts");
const {
  episodeProgress,
  episodeFileState,
} = require("../src/lib/episode-progress.ts");
test("episode progress distinguishes missing, upcoming and unknown dates", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  const episodes = [
    { hasFile: true, airDateUtc: "2027-01-01T00:00:00Z" },
    { hasFile: true },
    { hasFile: false, airDateUtc: "2025-01-01T00:00:00Z" },
    { hasFile: false, airDateUtc: "2027-01-01T00:00:00Z" },
    { hasFile: false, airDateUtc: null },
    { hasFile: false, airDateUtc: "bad" },
  ];
  assert.deepEqual(episodeProgress(episodes, now), {
    total: 6,
    downloaded: 2,
    missing: 1,
    upcoming: 1,
    unknown: 2,
  });
  assert.equal(
    episodeFileState(
      { hasFile: false, airDateUtc: "2026-01-01T00:00:00Z" },
      now,
    ),
    "Missing file",
  );
  assert.equal(
    showFileBadge({ episodeFileCount: 6, totalEpisodeCount: 8 }).count,
    "6/8 episodes",
  );
  assert.equal(
    showFileBadge({ episodeFileCount: 0, totalEpisodeCount: 10 }).count,
    "0/10 episodes",
  );
  assert.equal(
    showFileBadge({ episodeFileCount: 8, totalEpisodeCount: 8 }).count,
    "8/8 episodes",
  );
});
test("series card completeness requires valid total episode counts, not monitored counts", () => {
  assert.equal(showFileBadge(undefined).label, "UNKNOWN");
  assert.equal(showFileBadge({ episodeFileCount: -1 }).label, "UNKNOWN");
  assert.equal(
    showFileBadge({ episodeFileCount: 0, totalEpisodeCount: 0 }).label,
    "NO FILES",
  );
  assert.equal(
    showFileBadge({ episodeFileCount: 5, episodeCount: 5 }).label,
    "ON DISK",
  );
  assert.equal(
    showFileBadge({
      episodeFileCount: 5,
      episodeCount: 5,
      totalEpisodeCount: 10,
    }).label,
    "PARTIAL",
  );
  assert.equal(
    showFileBadge({ episodeFileCount: 10, totalEpisodeCount: 10 }).label,
    "COMPLETE",
  );
  assert.equal(
    showFileBadge({ episodeFileCount: 11, totalEpisodeCount: 10 }).label,
    "ON DISK",
  );
  assert.equal(
    showFileBadge({ episodeFileCount: 2, totalEpisodeCount: NaN }).label,
    "ON DISK",
  );
});
const { artwork } = require("../src/lib/artwork.ts");
test("artwork accepts public TVDB posters/backdrops without leaking queries and keeps TMDB sizing", () => {
  const select = (remoteUrl, kind = "poster") =>
    artwork({ images: [{ coverType: kind, remoteUrl }] }, kind);
  const tvdb =
    "https://artworks.thetvdb.com/banners/v4/series/447608/posters/670b800fd85b5.jpg";
  assert.equal(select(tvdb + "?apikey=secret#fragment"), tvdb);
  assert.equal(
    select(
      "https://artworks.thetvdb.com/banners/fanart/original/123-1.jpg",
      "fanart",
    ),
    "https://artworks.thetvdb.com/banners/fanart/original/123-1.jpg",
  );
  assert.equal(
    select("https://image.tmdb.org/t/p/original/abc.jpg"),
    "https://image.tmdb.org/t/p/w342/abc.jpg",
  );
  for (const url of [
    "http://artworks.thetvdb.com/banners/a.jpg",
    "https://artworks.thetvdb.com.evil.test/banners/a.jpg",
    "https://secret@artworks.thetvdb.com/banners/a.jpg",
    "https://artworks.thetvdb.com:8989/banners/a.jpg",
    "https://artworks.thetvdb.com/api/a.jpg",
    "http://sonarr:8989/MediaCover/1/poster.jpg?apikey=secret",
  ])
    assert.equal(select(url), undefined);
});
const {
  matchMovie,
  historyEvidence,
  verificationStatus,
} = require("../src/lib/services/matching.ts");
const {
  cached,
  invalidateGroup,
  oldestCachedRead,
} = require("../src/lib/server/cache.ts");
const {
  parseMovieQuery,
  filterAndSortMovies,
  moviePageHref,
} = require("../src/lib/services/movie-query.ts");
const { request } = require("../src/lib/server/http.ts");
const { matchSeries } = require("../src/lib/services/sonarr-matching.ts");
const { getSonarrConfig } = require("../src/lib/config/sonarr.ts");
const { getSeries } = require("../src/lib/clients/sonarr.ts");
const movie = { id: 148, title: "Intimate Strangers", year: 2018 };
const hash = "a".repeat(40);
const torrent = {
  hash,
  name: "Intimate.Strangers.2018.mkv",
  category: "MoviesRR",
};
test("Sonarr instance configuration is explicit, validated and server-only", () => {
  const original = { ...process.env };
  try {
    delete process.env.SONARR_URL;
    assert.throws(() => getSonarrConfig("tv"), /SONARR_URL/);
    process.env.SONARR_URL = "http://localhost:8989/base/";
    process.env.SONARR_API_KEY = "test-tv";
    process.env.SONARR_ANIME_URL = "http://localhost:8990";
    process.env.SONARR_ANIME_API_KEY = "test-anime";
    delete process.env.SONARR_QBIT_CATEGORY;
    assert.equal(getSonarrConfig("tv").category, null);
    assert.equal(getSonarrConfig("tv").url, "http://localhost:8989/base");
    assert.equal(getSonarrConfig("anime").apiKey, "test-anime");
    process.env.SONARR_URL = "http://user:secret@localhost";
    assert.throws(() => getSonarrConfig("tv"), /valid HTTP/);
    assert.throws(() => getSonarrConfig("unknown"), /Unknown/);
  } finally {
    process.env = original;
  }
});
test("Sonarr matching separates instances, scopes series, exposes shared episode hashes and never guesses", () => {
  const episodes = [1, 2].map((id) => ({
    id,
    seriesId: 7,
    seasonNumber: 1,
    episodeNumber: id,
    title: "Episode",
    hasFile: true,
  }));
  const history = episodes.map((episode) => ({
    id: episode.id,
    seriesId: 7,
    episodeId: episode.id,
    downloadId: hash,
  }));
  const tv = matchSeries("tv", 7, episodes, history, [torrent], "MoviesRR");
  assert.equal(tv.links.length, 1);
  assert.deepEqual(tv.links[0].episodeIds, [1, 2]);
  assert.equal(tv.episodes[0].status, "Hash match verified");
  assert.notEqual(
    tv.key,
    matchSeries("anime", 7, episodes, [], [], "Anime").key,
  );
  assert.equal(
    matchSeries("anime", 7, episodes, [], [torrent], "MoviesRR").episodes[0]
      .status,
    "No exact torrent match",
  );
  assert.equal(
    matchSeries("tv", 8, episodes, history, [torrent], "MoviesRR").links.length,
    0,
  );
  assert.equal(
    matchSeries("tv", 7, episodes, history, [torrent], null).links[0].status,
    "Category not configured",
  );
  assert.equal(
    matchSeries("tv", 7, episodes, history, [torrent], "TV").links[0].status,
    "Unexpected category",
  );
  assert.equal(
    matchSeries("tv", 7, episodes, history, [torrent], "MoviesRR", true)
      .episodes[0].status,
    "Unavailable",
  );
  const other = { ...torrent, hash: "b".repeat(40) };
  const upgraded = [
    ...history,
    { ...history[0], id: 3, downloadId: other.hash },
  ];
  assert.equal(
    matchSeries("tv", 7, episodes, upgraded, [torrent, other], "MoviesRR")
      .episodes[0].status,
    "Ambiguous",
  );
});
test("Sonarr client performs only GET and isolates caches for overlapping instance IDs", async () => {
  const originalEnv = { ...process.env },
    originalFetch = global.fetch;
  const calls = [];
  try {
    process.env.SONARR_URL = "http://sonarr.invalid";
    process.env.SONARR_API_KEY = "fake-tv-test-key";
    process.env.SONARR_ANIME_URL = "http://sonarr.invalid";
    process.env.SONARR_ANIME_API_KEY = "fake-anime-test-key";
    global.fetch = async (url, options) => {
      calls.push({ url, method: options.method });
      return Response.json([
        {
          id: 7,
          title:
            options.headers["X-Api-Key"] === "fake-tv-test-key"
              ? "TV"
              : "Anime",
        },
      ]);
    };
    assert.equal((await getSeries("tv"))[0].title, "TV");
    assert.equal((await getSeries("anime"))[0].title, "Anime");
    await getSeries("tv");
    assert.equal(calls.length, 2);
    assert.ok(calls.every((call) => call.method === "GET"));
    invalidateGroup("media");
    global.fetch = async () => Response.json({ wrong: "shape" });
    await assert.rejects(getSeries("tv"), /invalid response/);
  } finally {
    global.fetch = originalFetch;
    process.env = originalEnv;
    invalidateGroup("media");
  }
});
test("library filters and sorting run before pagination and retain URL state", () => {
  const movies = Array.from({ length: 60 }, (_, id) => ({
    id,
    title: `Movie ${id}`,
    year: 2000 + id,
    hasFile: id >= 30,
    monitored: true,
    sizeOnDisk: id * 100,
  }));
  const query = parseMovieQuery({
    file: "yes",
    monitored: "yes",
    sort: "size-desc",
    match: "matched",
    page: "2",
  });
  const result = filterAndSortMovies(movies, query);
  assert.equal(result.length, 30);
  assert.equal(result[0].id, 59);
  assert.equal(result.slice(24)[0].id, 35);
  assert.match(moviePageHref(query, 3), /match=matched/);
  assert.match(moviePageHref(query, 3), /page=3/);
  assert.equal(
    parseMovieQuery({ page: "Infinity", match: "fake", sort: ["size-desc"] })
      .page,
    1,
  );
  assert.equal(parseMovieQuery({ match: "fake" }).match, "all");
  assert.equal(
    filterAndSortMovies([{ id: 1, title: "Unknown" }, ...movies], {
      ...query,
      file: "all",
      monitored: "all",
      sort: "year-asc",
    }).at(-1).id,
    1,
  );
});
test("manual refresh invalidates read data but retains sessions and rejects stale in-flight repopulation", async () => {
  await cached("session-test", 10000, async () => "cookie");
  let resolve;
  const pending = cached(
    "refresh-test",
    10000,
    () =>
      new Promise((done) => {
        resolve = done;
      }),
    "test-media",
  );
  await Promise.resolve();
  invalidateGroup("test-media");
  resolve("old");
  await pending;
  assert.equal(
    await cached("refresh-test", 10000, async () => "new", "test-media"),
    "new",
  );
  assert.equal(
    await cached("session-test", 10000, async () => "bad"),
    "cookie",
  );
  assert.equal(typeof oldestCachedRead("test-media"), "number");
  invalidateGroup("test-media");
  assert.equal(oldestCachedRead("test-media"), null);
});
test("byte units preserve large and small real values", () => {
  assert.equal(formatBytes(1024 ** 3), "1.00 GiB");
  assert.equal(formatBytes(200 * 1024 ** 4), "200.00 TiB");
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(NaN), "—");
});
test("top-level downloadId matches only its movie and permitted category", () => {
  const history = [{ movieId: 148, downloadId: hash.toUpperCase() }];
  assert.equal(matchMovie(movie, history, [torrent]).status, "matched");
  assert.equal(
    matchMovie(movie, [{ movieId: 407, downloadId: hash }], [torrent]).status,
    "candidate",
  );
  assert.equal(
    matchMovie(movie, history, [{ ...torrent, category: "Other" }]).status,
    "unmatched",
  );
  assert.equal(
    matchMovie(movie, history, [torrent, torrent]).status,
    "ambiguous",
  );
});
test("title guesses remain candidates and require a year", () => {
  assert.equal(matchMovie(movie, [], [torrent]).status, "candidate");
  assert.equal(
    matchMovie({ ...movie, year: undefined }, [], [torrent]).status,
    "unmatched",
  );
  assert.equal(
    matchMovie(
      { id: 1, title: "Help! I'm a Fish", year: 2000 },
      [],
      [{ ...torrent, name: "Help.Im.A.Fish.2000.mkv" }],
    ).status,
    "candidate",
  );
});
test("hash evidence keeps record provenance, rejects invalid hashes, and excludes other movies and raw data", () => {
  const record = {
    id: 17,
    movieId: 148,
    eventType: "downloadFolderImported",
    date: "2026-09-01T12:00:00Z",
    downloadId: ` ${hash.toUpperCase()} `,
    data: { downloadId: "b".repeat(64), hash: "invalid", secret: "not-for-ui" },
  };
  const evidence = historyEvidence(148, [record, { ...record, movieId: 99 }]);
  assert.equal(evidence.length, 2);
  assert.deepEqual(evidence[0], {
    historyId: 17,
    movieId: 148,
    eventType: record.eventType,
    date: record.date,
    source: "downloadId",
    hash,
  });
  assert.equal(evidence[1].source, "data.downloadId");
  assert.equal(JSON.stringify(evidence).includes("not-for-ui"), false);
  assert.equal(
    historyEvidence(148, [
      { ...record, downloadId: undefined, data: { hash } },
    ])[0].source,
    "data.hash",
  );
});
test("ambiguous and candidate matches retain all diagnostic torrents without selecting one", () => {
  const second = { ...torrent, hash: "b".repeat(40) };
  const history = [
    { movieId: 148, downloadId: hash },
    { movieId: 148, downloadId: second.hash },
  ];
  const exact = matchMovie(movie, history, [torrent, second]);
  assert.equal(exact.status, "ambiguous");
  assert.deepEqual(exact.exactMatches, [torrent, second]);
  assert.equal(exact.torrent, undefined);
  assert.deepEqual(exact.candidates, []);
  const guesses = matchMovie(movie, [], [torrent, second]);
  assert.equal(guesses.status, "ambiguous");
  assert.deepEqual(guesses.candidates, [torrent, second]);
  assert.deepEqual(guesses.exactMatches, []);
  assert.equal(guesses.torrent, undefined);
  const wrongCategory = matchMovie(movie, history.slice(0, 1), [
    { ...torrent, category: "Other" },
  ]);
  assert.equal(wrongCategory.exactMatches.length, 1);
  assert.equal(verificationStatus(wrongCategory.status, false), "BLOCKED");
});
test("only available unique category-valid hash matches receive verification, never deletion authorization", () => {
  assert.equal(verificationStatus("matched", false), "Hash match verified");
  assert.equal(verificationStatus("matched", true), "BLOCKED");
  for (const status of ["candidate", "ambiguous", "unmatched", "unavailable"]) {
    assert.equal(verificationStatus(status, false), "BLOCKED");
  }
});
test("cache coalesces concurrent reads and retries failures", async () => {
  let calls = 0;
  const load = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 15));
    return 42;
  };
  assert.deepEqual(
    await Promise.all(
      Array.from({ length: 20 }, () => cached("test", 1000, load)),
    ),
    Array(20).fill(42),
  );
  assert.equal(calls, 1);
  await cached("test", 1000, load);
  assert.equal(calls, 1);
  await assert.rejects(
    cached("failure", 1000, async () => {
      throw Error("bad");
    }),
  );
  assert.equal(await cached("failure", 1000, async () => 7), 7);
  await cached("expired", 0, load);
  await cached("expired", 0, load);
  assert.equal(calls, 3);
});
test("HTTP pool limits concurrency and never leaks transport errors", async () => {
  const original = global.fetch;
  let active = 0,
    peak = 0;
  global.fetch = async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return new Response("ok");
  };
  try {
    await Promise.all(
      Array.from({ length: 20 }, () =>
        request("test", "http://example.invalid", {}, (r) => r.text()),
      ),
    );
    assert.equal(peak, 6);
    global.fetch = async () => {
      throw Error("sensitive transport detail");
    };
    await assert.rejects(
      request("test", "http://example.invalid", {}, (r) => r.text()),
      {
        message: "test: request failed or exceeded the 5-second limit.",
      },
    );
  } finally {
    global.fetch = original;
  }
});
