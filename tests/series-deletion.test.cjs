/* eslint-disable @typescript-eslint/no-require-imports -- Compile server TS under Node's test runner. */
const ts = require("typescript"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
require.extensions[".ts"] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    filename,
  );
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const service = require("../src/lib/services/series-deletion.ts");
const preflight = require("../src/lib/services/series-deletion-preflight.ts");
const api = require("../src/lib/clients/series-deletion.ts");
const nas = require("../src/lib/server/nas.ts");
const store = require("../src/lib/server/deletion-store.ts");
const policy = require("../src/lib/series-deletion-policy.ts");
const seerr = require("../src/lib/services/seerr-series.ts");
const seerrApi = require("../src/lib/clients/seerr.ts");
const {
  matchHistoryImportPaths,
} = require("../src/lib/services/series-import-matching.ts");

test("hashless Sonarr imports bind only by exact source, destination, file ID and qBittorrent member", async () => {
  const file = {
    id: 21,
    seriesId: 7,
    path: "/data/media/anime/Show/S01E01.mkv",
    size: 100,
  };
  const history = [
    {
      id: 1,
      seriesId: 7,
      episodeId: 11,
      date: "2026-01-01",
      eventType: "downloadFolderImported",
      data: {
        fileId: "21",
        droppedPath: "/data/torrents/anime/Pack/release.mkv",
        importedPath: file.path,
      },
    },
  ];
  const episode = { id: 11, seriesId: 7, hasFile: true, episodeFileId: 21 };
  const torrent = {
    hash: "a".repeat(40),
    name: "unrelated label",
    category: "AnimeRR",
    save_path: "/data/torrents/anime",
    content_path: "/data/torrents/anime/Pack",
  };
  const match = await matchHistoryImportPaths(
    "anime",
    7,
    history,
    [episode],
    [file],
    [torrent],
    new Set([21]),
    async () => [{ name: "Pack/release.mkv", size: 100 }],
  );
  assert.deepEqual([...match.keys()], [torrent.hash]);
  assert.deepEqual([...match.get(torrent.hash).fileIds], [21]);
  await assert.rejects(
    matchHistoryImportPaths(
      "anime",
      7,
      history,
      [episode],
      [file],
      [torrent],
      new Set([21]),
      async () => [{ name: "Pack/release.mkv", size: 101 }],
    ),
    /does not match/,
  );
  await assert.rejects(
    matchHistoryImportPaths(
      "anime",
      7,
      history,
      [episode],
      [file],
      [{ ...torrent, category: "Other" }],
      new Set([21]),
      async () => [],
    ),
    /expected AnimeRR/,
  );
  await assert.rejects(
    matchHistoryImportPaths(
      "anime",
      7,
      [
        {
          ...history[0],
          data: {
            ...history[0].data,
            importedPath: "/data/media/anime/Other/S01E01.mkv",
          },
        },
      ],
      [episode],
      [file],
      [torrent],
      new Set([21]),
      async () => [],
    ),
    /No unique exact Sonarr import path/,
  );
});

test("import-path provenance permits absent hash history but still rejects another service owner", async () => {
  const env = { ...process.env },
    originalFetch = global.fetch;
  const hash = "c".repeat(40);
  try {
    Object.assign(process.env, {
      RADARR_URL: "http://radarr.invalid",
      RADARR_API_KEY: "fake-radarr",
      SONARR_URL: "http://tv.invalid",
      SONARR_API_KEY: "fake-tv",
      SONARR_ANIME_URL: "http://anime.invalid",
      SONARR_ANIME_API_KEY: "fake-anime",
    });
    let crossOwner = false;
    global.fetch = async (input) => {
      const url = new URL(String(input));
      const foreign = crossOwner && url.hostname === "tv.invalid";
      return Response.json({
        totalRecords: foreign ? 1 : 0,
        records: foreign
          ? [
              {
                seriesId: 8,
                episodeId: 99,
                downloadId: url.searchParams.get("downloadId"),
              },
            ]
          : [],
      });
    };
    const plan = { instance: "anime", seriesId: 7, episodes: [{ id: 11 }] };
    await preflight.assertSeriesHashOwners(plan, [hash], new Set([hash]));
    crossOwner = true;
    await assert.rejects(
      preflight.assertSeriesHashOwners(plan, [hash], new Set([hash])),
      /shared, unknown or cross-instance/,
    );
  } finally {
    global.fetch = originalFetch;
    process.env = env;
  }
});

test("series roots and confirmation tokens separate TV/anime and reject overlap", () => {
  assert.throws(() =>
    policy.assertSeriesRoots("anime", "/data/media/series/Test", [
      "/data/torrents/anime/file.mkv",
    ]),
  );
  assert.throws(() =>
    policy.assertSeriesRoots("tv", "/data/media/series/Test", [
      "/data/torrents/series/Pack",
      "/data/torrents/series/Pack/file.mkv",
    ]),
  );
  assert.throws(() =>
    policy.assertSeriesRoots("tv", "/data/media/series", [
      "/data/torrents/series/file.mkv",
    ]),
  );
  const prepared = store.rememberScopedPlan(
    "series:tv:7",
    { title: "Test" },
    "binding",
    "DELETE Test [Sonarr TV]",
  );
  assert.throws(() =>
    store.consumeScopedPlan(
      "series:anime:7",
      prepared.token,
      prepared.confirmation,
      true,
      "binding",
    ),
  );
  assert.throws(() =>
    store.consumePlan(
      7,
      prepared.token,
      prepared.confirmation,
      true,
      "binding",
    ),
  );
  store.consumeScopedPlan(
    "series:tv:7",
    prepared.token,
    prepared.confirmation,
    true,
    "binding",
  );
  assert.throws(() =>
    store.consumeScopedPlan(
      "series:tv:7",
      prepared.token,
      prepared.confirmation,
      true,
      "binding",
    ),
  );
});

test("Seerr TV requires the exact TVDB/TMDB pair and blocks another instance or 4K season", () => {
  const data = () => ({
    id: 4242,
    externalIds: { tvdbId: 9876 },
    mediaInfo: {
      id: 55,
      tmdbId: 4242,
      tvdbId: 9876,
      mediaType: "tv",
      status: 4,
      status4k: 1,
      serviceId: 1,
      externalServiceId: 7,
      serviceId4k: null,
      externalServiceId4k: null,
      requests: [{ id: 33, type: "tv", is4k: false, serverId: 1 }],
      issues: [],
      seasons: [{ id: 66, status4k: 1 }],
    },
  });
  assert.equal(
    seerr.seerrSeriesPlan(data(), "anime", 7, 4242, 9876, 1).mediaId,
    55,
  );
  assert.throws(() => seerr.seerrSeriesPlan(data(), "tv", 7, 4242, 9876, 0));
  assert.throws(() => seerr.seerrSeriesPlan(data(), "anime", 7, 4242, 9877, 1));
  const fourK = data();
  fourK.mediaInfo.seasons[0].status4k = 5;
  assert.throws(() => seerr.seerrSeriesPlan(fourK, "anime", 7, 4242, 9876, 1));
});

test("full series deletion scopes both instances, verifies every hardlink and journals partial failures (fake APIs only)", async () => {
  const env = { ...process.env },
    originalFetch = global.fetch,
    originalNas = nas.inspectSeriesDeletionRoots,
    originalNativeCheck = nas.assertNativeCleanupAvailable,
    originalTreeValidation = nas.validateNativeLibraryTree,
    originalTreeRemoval = nas.removeNativeLibraryTree;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "arr-series-test-"));
  try {
    Object.assign(process.env, {
      MOVIE_DELETION_ENABLED: "false",
      SERIES_DELETION_ENABLED: "true",
      NAS_INSPECTION_ENABLED: "true",
      RADARR_URL: "http://radarr.invalid",
      RADARR_API_KEY: "fake-radarr",
      SONARR_URL: "http://tv.invalid",
      SONARR_API_KEY: "fake-tv",
      SONARR_QBIT_CATEGORY: "SeriesRR",
      SONARR_ANIME_URL: "http://anime.invalid",
      SONARR_ANIME_API_KEY: "fake-anime",
      SONARR_ANIME_QBIT_CATEGORY: "AnimeRR",
      QBIT_URL: "http://qbit.invalid",
      QBIT_USERNAME: "",
      QBIT_PASSWORD: "",
      SEERR_URL: "http://seerr.invalid",
      SEERR_API_KEY: "fake-seerr",
    });
    for (const instance of ["tv", "anime"]) {
      const folder = instance === "tv" ? "series" : "anime",
        category = instance === "tv" ? "SeriesRR" : "AnimeRR",
        serverId = instance === "tv" ? 0 : 1;
      const library = `/data/media/${folder}/Test`,
        save = `/data/torrents/${folder}`;
      const hashes = ["a".repeat(40), "b".repeat(40)];
      const series = {
        id: 7,
        title: "Test",
        year: 2025,
        tvdbId: 9876,
        tmdbId: 4242,
        path: `/media/${folder}/Test`,
      };
      const episodes = [11, 12].map((id, i) => ({
        id,
        seriesId: 7,
        hasFile: true,
        episodeFileId: 21 + i,
      }));
      const files = [21, 22].map((id, i) => ({
        id,
        seriesId: 7,
        path: `${library}/episode-${i}.mkv`,
        size: 100,
      }));
      const torrents = hashes.map((hash, i) => ({
        hash,
        name: `release-${i}.mkv`,
        category,
        save_path: save,
        content_path: `${save}/release-${i}.mkv`,
        progress: 1,
        state: "stalledUP",
      }));
      let scenario = "normal",
        removed = new Set(),
        libraryGone = false,
        seriesGone = false,
        seerrGone = false,
        writes = [];
      const identity = (p, inode, links) => ({
        path: p,
        device: "124",
        inode: String(inode),
        links,
        bytes: "100",
        modifiedNs: "1234",
      });
      nas.inspectSeriesDeletionRoots = async (source, libraryRoot, roots) => {
        assert.equal(source, instance);
        assert.equal(libraryRoot, library);
        assert.deepEqual(
          roots,
          torrents.map((torrent) => torrent.content_path),
        );
        const lib = {
          root: library,
          device: "124",
          status: libraryGone ? "missing" : "present",
          directories: libraryGone ? [] : [library],
          files: libraryGone
            ? []
            : files.map((file, i) =>
                identity(
                  file.path,
                  i + 1,
                  removed.has(hashes[i])
                    ? 1
                    : scenario === "extra-link"
                      ? 3
                      : 2,
                ),
              ),
        };
        return [
          lib,
          ...torrents.map((torrent, i) => ({
            root: torrent.content_path,
            device: "124",
            status: removed.has(torrent.hash) ? "missing" : "present",
            directories: [],
            files: removed.has(torrent.hash)
              ? []
              : [
                  identity(
                    torrent.content_path,
                    scenario === "copy" ? i + 10 : i + 1,
                    scenario === "extra-link" ? 3 : 2,
                  ),
                ],
          })),
        ];
      };
      nas.assertNativeCleanupAvailable = async () => {
        if (scenario === "nas-legacy")
          throw Error("NAS exact-file cleanup helper is unavailable");
      };
      nas.validateNativeLibraryTree = async (root, expected) => {
        assert.equal(root, library);
        assert.equal(expected.files.length, files.length);
        assert.equal(libraryGone, false);
      };
      nas.removeNativeLibraryTree = async (root, expected) => {
        assert.equal(root, library);
        assert.ok(removed.size === hashes.length);
        assert.equal(expected.files.length, files.length);
        libraryGone = true;
      };
      global.fetch = async (input, options) => {
        const url = new URL(input),
          method = options.method ?? "GET";
        assert.ok(url.hostname.endsWith(".invalid"));
        assert.equal(options.cache, "no-store");
        if (method !== "GET") {
          writes.push([url.hostname, url.pathname]);
          if (url.hostname === "qbit.invalid") {
            assert.equal(method, "POST");
            assert.equal(url.pathname, "/api/v2/torrents/delete");
            assert.equal(options.body.get("deleteFiles"), "true");
            const hash = options.body.get("hashes");
            assert.ok(hashes.includes(hash));
            removed.add(hash);
            if (
              (scenario === "first-timeout" && hash === hashes[0]) ||
              (scenario === "second-timeout" && hash === hashes[1])
            )
              throw Error("accepted but connection lost");
          } else if (url.hostname === `${instance}.invalid`) {
            assert.equal(removed.size, 2);
            assert.equal(method, "DELETE");
            assert.equal(url.pathname, "/api/v3/series/7");
            assert.equal(libraryGone, true);
            assert.equal(url.searchParams.get("deleteFiles"), "false");
            assert.equal(
              url.searchParams.get("addImportListExclusion"),
              "false",
            );
            seriesGone = true;
            if (scenario === "sonarr-timeout")
              throw Error("accepted but connection lost");
          } else if (url.hostname === "seerr.invalid") {
            assert.equal(seriesGone, true);
            assert.equal(method, "DELETE");
            assert.equal(url.pathname, "/api/v1/media/55");
            seerrGone = true;
            if (scenario === "seerr-timeout")
              throw Error("accepted but connection lost");
          } else throw Error("Wrong service mutated");
          return new Response(null, { status: 200 });
        }
        if (url.hostname === "seerr.invalid") {
          if (url.pathname === "/api/v1/auth/me")
            return Response.json({ permissions: 2 });
          if (url.pathname === "/api/v1/settings/sonarr")
            return Response.json([
              { id: 0, apiKey: "fake-tv", is4k: false },
              { id: 1, apiKey: "fake-anime", is4k: false },
            ]);
          if (url.pathname === "/api/v1/tv/4242")
            return Response.json({
              id: 4242,
              externalIds: { tvdbId: 9876 },
              mediaInfo: seerrGone
                ? undefined
                : {
                    id: 55,
                    tmdbId: 4242,
                    tvdbId: 9876,
                    mediaType: "tv",
                    status: seriesGone ? 7 : 4,
                    status4k: scenario === "4k" ? 5 : 1,
                    serviceId: seriesGone ? null : serverId,
                    externalServiceId: seriesGone ? null : 7,
                    serviceId4k: null,
                    externalServiceId4k: null,
                    requests: [{ id: 33, type: "tv", is4k: false, serverId }],
                    issues: [],
                    seasons: [{ id: 66, status4k: 1 }],
                  },
            });
          if (url.pathname === "/api/v1/request/33")
            return seerrGone
              ? new Response(null, { status: 404 })
              : Response.json({ id: 33 });
        }
        if (url.pathname === "/api/v3/movie") return Response.json([]);
        if (url.pathname === "/api/v3/series/7")
          return seriesGone
            ? new Response(null, { status: 404 })
            : Response.json(series);
        if (url.pathname === "/api/v3/series")
          return Response.json(
            url.hostname === `${instance}.invalid`
              ? seriesGone
                ? []
                : [series]
              : scenario === "same-tmdb"
                ? [{ ...series, id: 8 }]
                : [
                    {
                      ...series,
                      id: 8,
                      tvdbId: 99999,
                      tmdbId: 0,
                      path: `/data/media/${instance === "tv" ? "anime" : "series"}/Unrelated`,
                    },
                  ],
          );
        if (url.pathname === "/api/v3/episode") return Response.json(episodes);
        if (url.pathname === "/api/v3/episodefile") return Response.json(files);
        if (url.pathname === "/api/v3/config/mediamanagement")
          return Response.json({
            recycleBin: scenario === "recycle" ? "/recycle" : "",
          });
        if (url.pathname === "/api/v3/history/series")
          return Response.json(
            hashes.map((downloadId, i) => ({
              id: i + 1,
              seriesId: 7,
              episodeId: 11 + i,
              downloadId,
            })),
          );
        if (url.pathname === "/api/v3/history") {
          const downloadId = url.searchParams.get("downloadId"),
            i = hashes.indexOf(downloadId.toLowerCase());
          const owner =
            url.hostname === `${instance}.invalid` ||
            (scenario === "shared" && url.hostname !== "radarr.invalid");
          return Response.json({
            totalRecords: owner ? 1 : 0,
            records: owner
              ? [{ seriesId: 7, episodeId: 11 + i, downloadId }]
              : [],
          });
        }
        if (url.pathname === "/api/v2/torrents/info")
          return Response.json(
            torrents
              .filter((torrent) => !removed.has(torrent.hash))
              .map((torrent, i) =>
                scenario === "category" && i === 0
                  ? { ...torrent, category: "Other" }
                  : torrent,
              ),
          );
        if (url.pathname === "/api/v2/torrents/files") {
          const i = hashes.indexOf(url.searchParams.get("hash"));
          return Response.json([
            { name: `release-${i}.mkv`, size: 100, progress: 1 },
          ]);
        }
        throw Error(`Unexpected fake read ${url.pathname}`);
      };
      for (scenario of [
        "shared",
        "same-tmdb",
        "category",
        "extra-link",
        "copy",
        "4k",
        "recycle",
      ]) {
        await assert.rejects(preflight.prepareSeriesDeletion(instance, 7));
        assert.equal(writes.length, 0);
      }
      scenario = "nas-legacy";
      removed = new Set();
      libraryGone = false;
      seriesGone = false;
      seerrGone = false;
      writes = [];
      process.env.DELETE_STATE_DIR = fs.mkdtempSync(
        path.join(temp, instance + "-legacy-"),
      );
      const legacyPrepared = await service.prepareSeriesRemoval(instance, 7);
      const legacyResult = await service.executeSeriesRemoval(
        instance,
        7,
        legacyPrepared.token,
        legacyPrepared.confirmation,
        true,
      );
      assert.equal(legacyResult.status, "blocked");
      assert.equal(writes.length, 0);
      assert.equal(
        fs.existsSync(path.join(process.env.DELETE_STATE_DIR, "deletion.lock")),
        false,
      );
      for (scenario of [
        "normal",
        "first-timeout",
        "second-timeout",
        "sonarr-timeout",
        "seerr-timeout",
      ]) {
        removed = new Set();
        libraryGone = false;
        seriesGone = false;
        seerrGone = false;
        writes = [];
        process.env.DELETE_STATE_DIR = fs.mkdtempSync(
          path.join(temp, instance + "-"),
        );
        const prepared = await service.prepareSeriesRemoval(instance, 7);
        const result = await service.executeSeriesRemoval(
          instance,
          7,
          prepared.token,
          prepared.confirmation,
          true,
        );
        if (scenario === "normal") {
          assert.equal(result.status, "completed");
          assert.equal(result.library, "verified");
          assert.equal(result.sonarr, "verified");
          assert.equal(result.seerr, "verified");
          assert.equal(writes.length, 4);
          assert.equal(
            fs.existsSync(
              path.join(process.env.DELETE_STATE_DIR, "deletion.lock"),
            ),
            false,
          );
          await assert.rejects(
            service.executeSeriesRemoval(
              instance,
              7,
              prepared.token,
              prepared.confirmation,
              true,
            ),
          );
          assert.equal(writes.length, 4);
        } else {
          assert.equal(result.status, "needs-attention");
          assert.equal(
            fs.readFileSync(
              path.join(process.env.DELETE_STATE_DIR, "deletion.lock"),
              "utf8",
            ),
            result.id,
          );
          assert.equal(
            writes.length,
            scenario === "first-timeout"
              ? 1
              : scenario === "second-timeout"
                ? 2
                : scenario === "sonarr-timeout"
                  ? 3
                  : 4,
          );
          if (["first-timeout", "second-timeout"].includes(scenario))
            assert.equal(result.sonarr, "not-started");
        }
        assert.equal(
          (await store.readOperation(result.id)).status,
          result.status,
        );
      }
      process.env.SERIES_DELETION_ENABLED = "false";
      await assert.rejects(api.removeSeriesRecord(instance, 7), /disabled/);
      await assert.rejects(api.removeSeriesTorrent(hashes[0]), /disabled/);
      await assert.rejects(seerrApi.removeSeerrMedia(55, "series"), /disabled/);
      process.env.SERIES_DELETION_ENABLED = "true";
    }
  } finally {
    global.fetch = originalFetch;
    nas.inspectSeriesDeletionRoots = originalNas;
    nas.assertNativeCleanupAvailable = originalNativeCheck;
    nas.validateNativeLibraryTree = originalTreeValidation;
    nas.removeNativeLibraryTree = originalTreeRemoval;
    process.env = env;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
