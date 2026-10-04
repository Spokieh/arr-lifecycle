/* eslint-disable @typescript-eslint/no-require-imports -- Linux integration harness for server TS. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const childProcess = require("node:child_process");
const ts = require("typescript");

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

test(
  "series deletion executes the real NAS protocol and hardlink cleanup in isolated Linux fixtures",
  {
    skip: process.env.ARR_NATIVE_TESTS !== "1",
  },
  async (t) => {
    assert.equal(process.platform, "linux");
    const service = require("../src/lib/services/series-deletion.ts");
    const store = require("../src/lib/server/deletion-store.ts");
    const savedEnv = { ...process.env };
    const savedFetch = global.fetch;
    const savedSpawn = childProcess.spawn;
    try {
      Object.assign(process.env, {
        MOVIE_DELETION_ENABLED: "false",
        SERIES_DELETION_ENABLED: "true",
        NAS_INSPECTION_ENABLED: "true",
        RADARR_URL: "http://radarr.invalid",
        RADARR_API_KEY: "fixture-radarr",
        SONARR_URL: "http://tv.invalid",
        SONARR_API_KEY: "fixture-tv",
        SONARR_QBIT_CATEGORY: "SeriesRR",
        SONARR_ANIME_URL: "http://anime.invalid",
        SONARR_ANIME_API_KEY: "fixture-anime",
        SONARR_ANIME_QBIT_CATEGORY: "AnimeRR",
        QBIT_URL: "http://qbit.invalid",
        QBIT_USERNAME: "",
        QBIT_PASSWORD: "",
        SEERR_URL: "http://seerr.invalid",
        SEERR_API_KEY: "fixture-seerr",
      });
      for (const instance of ["tv", "anime"]) {
        for (const scenario of [
          "normal",
          "legacy",
          "partial-cleanup",
          "sonarr-timeout",
          "seerr-timeout",
        ]) {
          await t.test(`${instance}: ${scenario}`, async () => {
            const fixture = fs.mkdtempSync(
              path.join(os.tmpdir(), "arr-native-series-"),
            );
            const folder = instance === "tv" ? "series" : "anime";
            const libraryRoot = `/data/media/${folder}/Fixture`;
            const torrentRoot = `/data/torrents/${folder}/Pack`;
            const native = (virtual) => {
              assert.ok(virtual.startsWith("/data/"));
              const target = path.resolve(fixture, virtual.slice(6));
              assert.ok(target.startsWith(fixture + path.sep));
              return target;
            };
            const hash = "d".repeat(40);
            const serverId = instance === "tv" ? 0 : 1;
            const writes = [],
              nativeCommands = [];
            let torrentGone = false,
              seriesGone = false,
              seerrGone = false;
            const series = {
              id: 7,
              title: "Fixture",
              year: 2026,
              tvdbId: 9876,
              tmdbId: 4242,
              path: libraryRoot,
            };
            const episodes = [1, 2].map((number) => ({
              id: 10 + number,
              seriesId: 7,
              hasFile: true,
              episodeFileId: 20 + number,
            }));
            const files = [1, 2].map((number) => ({
              id: 20 + number,
              seriesId: 7,
              path: `${libraryRoot}/Season 01/episode-${number}.mkv`,
              size: 100,
            }));
            const history = episodes.map((episode, i) => ({
              id: i + 1,
              seriesId: 7,
              episodeId: episode.id,
              downloadId: hash,
            }));
            const torrent = {
              hash,
              name: "Pack",
              category: instance === "tv" ? "SeriesRR" : "AnimeRR",
              save_path: `/data/torrents/${folder}`,
              content_path: torrentRoot,
              progress: 1,
              state: "stalledUP",
            };
            const members = [1, 2].map((number) => ({
              name: `Pack/release-${number}.mkv`,
              size: 100,
              progress: 1,
            }));
            try {
              fs.mkdirSync(
                native(
                  `${libraryRoot}/Season 01/episode-1.trickplay/320 - 10x10`,
                ),
                { recursive: true },
              );
              fs.mkdirSync(native(torrentRoot), { recursive: true });
              for (const [index, file] of files.entries()) {
                fs.writeFileSync(
                  native(file.path),
                  Buffer.alloc(100, index + 1),
                );
                fs.linkSync(
                  native(file.path),
                  native(`${torrentRoot}/release-${index + 1}.mkv`),
                );
                assert.equal(fs.statSync(native(file.path)).nlink, 2);
              }
              fs.writeFileSync(
                native(
                  `${libraryRoot}/Season 01/episode-1.trickplay/320 - 10x10/0.jpg`,
                ),
                "thumbnail",
              );
              const unrelated = native(
                `/data/media/${folder}/Unrelated/keep.txt`,
              );
              fs.mkdirSync(path.dirname(unrelated), { recursive: true });
              fs.writeFileSync(unrelated, "must survive");
              process.env.DELETE_STATE_DIR = path.join(fixture, "journal");

              childProcess.spawn = (command, args, options) => {
                assert.equal(command, "ssh");
                assert.equal(args.at(-2), "dpcloudAdmin@192.168.1.99");
                const protocol = args.at(-1);
                assert.ok(
                  [
                    "arr-lifecycle-inspect-v3",
                    "arr-lifecycle-delete-v4",
                  ].includes(protocol),
                );
                nativeCommands.push(protocol);
                return savedSpawn(
                  "python3",
                  [
                    "-B",
                    path.join(__dirname, "nas-fixture-helper.py"),
                    protocol,
                  ],
                  {
                    ...options,
                    env: {
                      ...process.env,
                      ARR_TEST_NAS_ROOT: fixture,
                      ARR_TEST_SCENARIO: scenario,
                    },
                  },
                );
              };
              global.fetch = async (input, options = {}) => {
                const url = new URL(input);
                assert.ok(
                  url.hostname.endsWith(".invalid"),
                  "No request may reach a real service",
                );
                assert.equal(options.cache, "no-store");
                const method = options.method ?? "GET";
                if (method !== "GET") {
                  writes.push(`${method} ${url.hostname}${url.pathname}`);
                  const journalFiles = fs
                    .readdirSync(process.env.DELETE_STATE_DIR)
                    .filter((name) => name.endsWith(".json"));
                  assert.equal(journalFiles.length, 1);
                  const journal = JSON.parse(
                    fs.readFileSync(
                      path.join(process.env.DELETE_STATE_DIR, journalFiles[0]),
                      "utf8",
                    ),
                  );
                  if (url.hostname === "qbit.invalid") {
                    assert.equal(method, "POST");
                    assert.equal(url.pathname, "/api/v2/torrents/delete");
                    assert.equal(options.body.get("hashes"), hash);
                    assert.equal(options.body.get("deleteFiles"), "true");
                    assert.equal(journal.torrents[0].state, "requested");
                    for (let number = 1; number <= 2; number++)
                      fs.unlinkSync(
                        native(`${torrentRoot}/release-${number}.mkv`),
                      );
                    fs.rmdirSync(native(torrentRoot));
                    torrentGone = true;
                    for (const file of files)
                      assert.equal(fs.statSync(native(file.path)).nlink, 1);
                  } else if (url.hostname === `${instance}.invalid`) {
                    assert.equal(method, "DELETE");
                    assert.equal(url.pathname, "/api/v3/series/7");
                    assert.equal(url.searchParams.get("deleteFiles"), "false");
                    assert.equal(torrentGone, true);
                    assert.equal(fs.existsSync(native(libraryRoot)), false);
                    assert.equal(journal.library, "verified");
                    assert.equal(journal.sonarr, "requested");
                    seriesGone = true;
                    if (scenario === "sonarr-timeout")
                      throw new Error("Accepted but connection lost");
                  } else {
                    assert.equal(url.hostname, "seerr.invalid");
                    assert.equal(method, "DELETE");
                    assert.equal(url.pathname, "/api/v1/media/55");
                    assert.equal(seriesGone, true);
                    assert.equal(journal.sonarr, "verified");
                    assert.equal(journal.seerr, "requested");
                    seerrGone = true;
                    if (scenario === "seerr-timeout")
                      throw new Error("Accepted but connection lost");
                  }
                  return new Response(null, { status: 200 });
                }
                if (url.hostname === "seerr.invalid") {
                  if (url.pathname === "/api/v1/auth/me")
                    return Response.json({ permissions: 2 });
                  if (url.pathname === "/api/v1/settings/sonarr")
                    return Response.json([
                      { id: 0, apiKey: "fixture-tv", is4k: false },
                      { id: 1, apiKey: "fixture-anime", is4k: false },
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
                            status: 4,
                            status4k: 1,
                            serviceId: serverId,
                            externalServiceId: 7,
                            serviceId4k: null,
                            externalServiceId4k: null,
                            requests: [],
                            issues: [],
                            seasons: [],
                          },
                    });
                }
                if (url.pathname === "/api/v3/movie") return Response.json([]);
                if (url.pathname === "/api/v3/series")
                  return Response.json(
                    url.hostname === `${instance}.invalid` && !seriesGone
                      ? [series]
                      : [],
                  );
                if (url.pathname === "/api/v3/series/7")
                  return seriesGone
                    ? new Response(null, { status: 404 })
                    : Response.json(series);
                if (url.pathname === "/api/v3/episode")
                  return Response.json(episodes);
                if (url.pathname === "/api/v3/episodefile")
                  return Response.json(files);
                if (url.pathname === "/api/v3/config/mediamanagement")
                  return Response.json({ recycleBin: "" });
                if (url.pathname === "/api/v3/history/series")
                  return Response.json(history);
                if (url.pathname === "/api/v3/history")
                  return Response.json({
                    totalRecords:
                      url.hostname === `${instance}.invalid`
                        ? history.length
                        : 0,
                    records:
                      url.hostname === `${instance}.invalid` ? history : [],
                  });
                if (url.pathname === "/api/v2/torrents/info")
                  return Response.json(torrentGone ? [] : [torrent]);
                if (url.pathname === "/api/v2/torrents/files")
                  return Response.json(members);
                throw new Error(
                  `Unexpected simulated request ${url.hostname}${url.pathname}`,
                );
              };

              const prepared = await service.prepareSeriesRemoval(instance, 7);
              assert.equal(prepared.plan.library.files.length, 3);
              assert.equal(prepared.plan.torrents[0].inventory.files.length, 2);
              const result = await service.executeSeriesRemoval(
                instance,
                7,
                prepared.token,
                prepared.confirmation,
                true,
              );
              assert.equal(
                result.status,
                scenario === "normal"
                  ? "completed"
                  : scenario === "legacy"
                    ? "blocked"
                    : "needs-attention",
                result.message,
              );
              assert.equal(
                writes.length,
                scenario === "legacy"
                  ? 0
                  : scenario === "partial-cleanup"
                    ? 1
                    : scenario === "sonarr-timeout"
                      ? 2
                      : 3,
              );
              const lock = path.join(
                process.env.DELETE_STATE_DIR,
                "deletion.lock",
              );
              assert.equal(
                fs.existsSync(lock),
                !["normal", "legacy"].includes(scenario),
              );
              if (scenario === "normal") {
                assert.equal(result.library, "verified");
                assert.equal(result.sonarr, "verified");
                assert.equal(result.seerr, "verified");
                assert.equal(fs.existsSync(native(libraryRoot)), false);
                assert.equal(fs.existsSync(native(torrentRoot)), false);
              } else if (scenario === "partial-cleanup") {
                assert.equal(result.library, "requested");
                assert.equal(result.sonarr, "not-started");
                assert.equal(result.seerr, "not-started");
                assert.equal(fs.existsSync(native(libraryRoot)), true);
              }
              assert.equal(fs.readFileSync(unrelated, "utf8"), "must survive");
              assert.equal(
                (await store.readOperation(result.id)).status,
                result.status,
              );
              const writesBeforeReplay = writes.length,
                commandsBeforeReplay = nativeCommands.length;
              await assert.rejects(
                service.executeSeriesRemoval(
                  instance,
                  7,
                  prepared.token,
                  prepared.confirmation,
                  true,
                ),
              );
              assert.equal(writes.length, writesBeforeReplay);
              assert.equal(nativeCommands.length, commandsBeforeReplay);
            } finally {
              assert.equal(path.dirname(fixture), os.tmpdir());
              assert.ok(
                path.basename(fixture).startsWith("arr-native-series-"),
              );
              fs.rmSync(fixture, { recursive: true, force: true });
            }
          });
        }
      }
    } finally {
      process.env = savedEnv;
      global.fetch = savedFetch;
      childProcess.spawn = savedSpawn;
    }
  },
);
