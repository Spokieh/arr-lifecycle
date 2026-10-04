/* eslint-disable @typescript-eslint/no-require-imports -- Compile server TS under Node's test runner. */
const ts = require("typescript"),
  fs = require("node:fs");
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
const os = require("node:os"),
  path = require("node:path");
const {
  assertInventories,
  assertLibraryAfterTorrent,
  confirmationFor,
} = require("../src/lib/deletion-policy.ts");
const { runMovieDeletion } = require("../src/lib/deletion-runner.ts");
const {
  authorizeDeletion,
  deletionBody,
} = require("../src/lib/server/deletion-access.ts");
const store = require("../src/lib/server/deletion-store.ts");
const nas = require("../src/lib/server/nas.ts");
const service = require("../src/lib/services/movie-deletion.ts");
const api = require("../src/lib/clients/deletion.ts");
const seerrService = require("../src/lib/services/seerr.ts");
const seerrApi = require("../src/lib/clients/seerr.ts");
const hash = "a".repeat(40),
  libraryRoot = "/data/media/movies/Fixture (2025)",
  torrentRoot = "/data/torrents/movies/Fixture";
const libraryFile = libraryRoot + "/movie.mkv",
  downloadFile = torrentRoot + "/movie.mkv";
const file = (path, extra = {}) => ({
  path,
  device: "124",
  inode: "123",
  links: 2,
  bytes: "100",
  modifiedNs: "456",
  ...extra,
});
const fixture = () => ({
  movieId: 400,
  tmdbId: 4242,
  title: "Fixture",
  year: 2025,
  movieFileId: 373,
  libraryFile,
  libraryRoot,
  torrentRoot,
  torrentHash: hash,
  torrentName: "Fixture",
  seerr: {
    tmdbId: 4242,
    radarrMovieId: 400,
    radarrServerId: 0,
    mediaId: 22,
    requestIds: [33],
    issueIds: [],
  },
  library: {
    root: libraryRoot,
    device: "124",
    status: "present",
    files: [file(libraryFile)],
    directories: [libraryRoot],
  },
  download: {
    root: torrentRoot,
    device: "124",
    status: "present",
    files: [file(downloadFile)],
    directories: [torrentRoot],
  },
});
const operation = () => ({
  id: "abcdefgh",
  movieId: 400,
  title: "Fixture",
  createdAt: "",
  updatedAt: "",
  status: "running",
  torrent: "not-started",
  library: "not-started",
  radarr: "not-started",
  message: "",
  plan: fixture(),
});

test("deletion refuses extra links, payload extras, size differences and a non-current inode", () => {
  const members = [{ path: downloadFile, size: 100 }];
  assert.doesNotThrow(() => assertInventories(fixture(), members));
  for (const change of [
    (p) => {
      p.library.files[0].links = 3;
      p.download.files[0].links = 3;
    },
    (p) => {
      p.download.files.push(
        file(torrentRoot + "/unlisted.nfo", { inode: "999", links: 1 }),
      );
    },
    (p) => {
      p.download.files[0].bytes = "101";
    },
    (p) => {
      p.download.files[0].inode = "999";
      p.download.files[0].links = 1;
      p.library.files[0].links = 1;
    },
    (p) => {
      p.download.files[0].modifiedNs = "457";
    },
  ]) {
    const plan = fixture();
    change(plan);
    assert.throws(() => assertInventories(plan, members));
  }
});

test("post-torrent verification accounts for removed links and detects replacement or leftover files", () => {
  const plan = fixture();
  const library = { ...plan.library, files: [file(libraryFile, { links: 1 })] },
    missing = {
      ...plan.download,
      status: "missing",
      files: [],
      directories: [],
    };
  assert.doesNotThrow(() => assertLibraryAfterTorrent(plan, library, missing));
  assert.throws(() => assertLibraryAfterTorrent(plan, library, plan.download));
  assert.throws(() =>
    assertLibraryAfterTorrent(
      plan,
      { ...library, files: [file(libraryFile, { links: 1, inode: "999" })] },
      missing,
    ),
  );
  assert.throws(() => assertLibraryAfterTorrent(plan, plan.library, missing));
});

test("Seerr requires exact TMDB, movie/server identity, full records and no 4K/blocklisted variant", () => {
  const media = () => ({
    id: 22,
    tmdbId: 4242,
    mediaType: "movie",
    status: 5,
    status4k: 1,
    serviceId: 0,
    externalServiceId: 400,
    serviceId4k: null,
    externalServiceId4k: null,
    requests: [{ id: 33, type: "movie", is4k: false, serverId: null }],
    issues: [],
  });
  const map = (info) =>
    seerrService.seerrMediaPlan({ id: 4242, mediaInfo: info }, 4242, 400, 0);
  assert.deepEqual(map(media()), fixture().seerr);
  assert.equal(map(undefined).mediaId, null);
  assert.equal(
    map({ ...media(), status: 7, serviceId: null, externalServiceId: null })
      .mediaId,
    22,
  );
  for (const change of [
    { tmdbId: 4243 },
    { mediaType: "tv" },
    { status: 6 },
    { status4k: 5 },
    { serviceId: 1 },
    { externalServiceId: 401 },
    { externalServiceId4k: 402 },
    { requests: [{ id: 33, type: "movie", is4k: true, serverId: null }] },
    { requests: [{ id: 33, type: "movie", is4k: false, serverId: 1 }] },
    { requests: undefined },
    { issues: undefined },
  ])
    assert.throws(() => map({ ...media(), ...change }));
  assert.throws(() => seerrService.seerrMediaPlan({ id: 4243 }, 4242, 400, 0));
});

test("runner journals before writes, stops on ambiguity and never retries mutations", async () => {
  for (const failAt of [
    "none",
    "preflight",
    "beforeFirstMutation",
    "torrent",
    "verifyTorrent",
    "checkLibrary",
    "removeLibrary",
    "verifyLibrary",
    "radarr",
    "verifyComplete",
    "seerr",
    "verifySeerr",
    "journal",
  ]) {
    const calls = [],
      op = operation();
    const action = async (name) => {
      calls.push(name);
      if (failAt === name) throw Error("simulated " + name);
    };
    const deps = {
      preflight: async () => {
        await action("preflight");
        return fixture();
      },
      beforeFirstMutation: () => action("beforeFirstMutation"),
      persist: async (value) => {
        calls.push(`persist:${value.torrent}:${value.radarr}`);
        if (failAt === "journal") throw Error("disk full");
      },
      removeTorrent: () => action("torrent"),
      verifyTorrent: () => action("verifyTorrent"),
      checkLibrary: () => action("checkLibrary"),
      removeLibrary: () => action("removeLibrary"),
      verifyLibrary: () => action("verifyLibrary"),
      removeMovieRecord: () => action("radarr"),
      verifyComplete: () => action("verifyComplete"),
      removeSeerr: () => action("seerr"),
      verifySeerr: () => action("verifySeerr"),
    };
    if (failAt === "journal") {
      await assert.rejects(runMovieDeletion(op, deps), /disk full/);
      assert.equal(calls.includes("torrent"), false);
      continue;
    }
    await runMovieDeletion(op, deps);
    assert.ok(calls.filter((value) => value === "torrent").length <= 1);
    assert.ok(calls.filter((value) => value === "radarr").length <= 1);
    if (calls.includes("torrent"))
      assert.ok(
        calls.indexOf("persist:requested:not-started") <
          calls.indexOf("torrent"),
      );
    if (calls.includes("radarr"))
      assert.ok(
        calls.indexOf("persist:verified:requested") < calls.indexOf("radarr"),
      );
    if (calls.includes("seerr")) {
      assert.ok(calls.indexOf("verifyComplete") < calls.indexOf("seerr"));
      assert.equal(op.seerr === "requested" || op.seerr === "verified", true);
      assert.ok(calls.some((value) => value === "persist:verified:verified"));
    }
    if (["seerr", "verifySeerr"].includes(failAt)) {
      assert.equal(op.torrent, "verified");
      assert.equal(op.radarr, "verified");
      assert.equal(op.seerr, "requested");
      assert.equal(calls.filter((value) => value === "seerr").length, 1);
    }
    if (
      [
        "preflight",
        "beforeFirstMutation",
        "torrent",
        "verifyTorrent",
        "checkLibrary",
        "removeLibrary",
        "verifyLibrary",
      ].includes(failAt)
    )
      assert.equal(calls.includes("radarr"), false);
    assert.equal(
      op.status,
      failAt === "none"
        ? "completed"
        : ["preflight", "beforeFirstMutation"].includes(failAt)
          ? "blocked"
          : "needs-attention",
    );
  }
  const op = operation();
  let writes = 0;
  await runMovieDeletion(op, {
    preflight: async () => ({ ...fixture(), movieFileId: 999 }),
    persist: async () => {},
    removeTorrent: async () => {
      writes++;
    },
  });
  assert.equal(writes, 0);
  assert.equal(op.status, "blocked");
});

test("Seerr rechecks the confirmed records after Radarr, handles already-removed records and never retries a write", async () => {
  const env = { ...process.env };
  const original = { ...seerrApi };
  let writes = 0;
  let scenario = "normal";
  try {
    process.env.RADARR_URL = "http://radarr.invalid";
    process.env.RADARR_API_KEY = "fake";
    seerrApi.freshSeerrUser = async () => ({ permissions: 2 });
    seerrApi.freshSeerrRadarrServers = async () => [
      { id: 0, apiKey: "fake", is4k: false },
    ];
    seerrApi.freshSeerrMovie = async () => {
      if (scenario === "unavailable") throw Error("unavailable");
      return {
        id: 4242,
        mediaInfo:
          scenario === "absent"
            ? undefined
            : {
                id: 22,
                tmdbId: 4242,
                mediaType: "movie",
                status: 7,
                status4k: 1,
                serviceId: null,
                externalServiceId: null,
                serviceId4k: null,
                externalServiceId4k: null,
                requests: [
                  {
                    id: scenario === "changed" ? 34 : 33,
                    type: "movie",
                    is4k: false,
                    serverId: null,
                  },
                ],
                issues: [],
              },
      };
    };
    seerrApi.removeSeerrMedia = async () => {
      writes++;
      if (scenario === "uncertain") throw Error("accepted but connection lost");
    };
    seerrApi.seerrRequestIsAbsent = async () => true;
    for (scenario of ["changed", "unavailable"])
      await assert.rejects(seerrService.removeConfirmedSeerr(fixture().seerr));
    assert.equal(writes, 0);
    scenario = "normal";
    await seerrService.removeConfirmedSeerr(fixture().seerr);
    assert.equal(writes, 1);
    scenario = "uncertain";
    await assert.rejects(
      seerrService.removeConfirmedSeerr(fixture().seerr),
      /connection lost/,
    );
    assert.equal(writes, 2);
    scenario = "absent";
    await seerrService.removeConfirmedSeerr(fixture().seerr);
    assert.equal(writes, 2);
    seerrApi.seerrRequestIsAbsent = async () => false;
    await assert.rejects(
      seerrService.removeConfirmedSeerr(fixture().seerr),
      /unverified/,
    );
    assert.equal(writes, 2);
  } finally {
    Object.assign(seerrApi, original);
    process.env = env;
  }
});

test("deletion requires enable flag and exact origin, and bounds JSON", async () => {
  const original = { ...process.env };
  try {
    process.env.MOVIE_DELETION_ENABLED = "false";
    const make = (origin = "http://app.invalid") =>
      new Request("http://app.invalid/api/movies/400/deletion", {
        method: "POST",
        headers: { origin },
      });
    await assert.rejects(authorizeDeletion(make()), /disabled/);
    process.env.MOVIE_DELETION_ENABLED = "true";
    process.env.APP_ORIGIN = "http://app.invalid";
    await assert.rejects(
      authorizeDeletion(make("http://evil.invalid")),
      /origin/,
    );
    await authorizeDeletion(make());
    await assert.rejects(
      deletionBody(
        new Request("http://app.invalid", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: " ".repeat(4097),
        }),
      ),
      /too large/,
    );
  } finally {
    process.env = original;
  }
});

test("confirmation is exact, expiring, single-use and bound to the service configuration", () => {
  const prepared = store.rememberPlan(fixture(), "binding");
  assert.throws(() =>
    store.consumePlan(400, prepared.token, "wrong", true, "binding"),
  );
  assert.throws(() =>
    store.consumePlan(
      401,
      prepared.token,
      prepared.confirmation,
      true,
      "binding",
    ),
  );
  assert.throws(() =>
    store.consumePlan(
      400,
      prepared.token,
      prepared.confirmation,
      true,
      "changed",
    ),
  );
  assert.throws(() =>
    store.consumePlan(
      400,
      prepared.token,
      prepared.confirmation,
      false,
      "binding",
    ),
  );
  store.consumePlan(
    400,
    prepared.token,
    prepared.confirmation,
    true,
    "binding",
  );
  assert.throws(() =>
    store.consumePlan(
      400,
      prepared.token,
      prepared.confirmation,
      true,
      "binding",
    ),
  );
  const expired = store.rememberPlan(fixture(), "binding");
  expired.expiresAt = new Date(0).toISOString();
  assert.throws(() =>
    store.consumePlan(
      400,
      expired.token,
      expired.confirmation,
      true,
      "binding",
    ),
  );
});

test("full service uses fresh reads, one write per service, durable status and replay rejection (fake APIs/NAS only)", async () => {
  const originalEnv = { ...process.env },
    originalFetch = global.fetch,
    originalNas = nas.inspectDeletionRoots,
    originalNativeCheck = nas.assertNativeCleanupAvailable,
    originalTreeValidation = nas.validateNativeLibraryTree,
    originalTreeRemoval = nas.removeNativeLibraryTree;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "arr-deletion-test-"));
  const writes = [];
  let torrentGone = false,
    libraryGone = false,
    movieGone = false,
    seerrGone = false;
  let scenario = "normal";
  try {
    Object.assign(process.env, {
      MOVIE_DELETION_ENABLED: "true",
      DELETE_STATE_DIR: temp,
      RADARR_URL: "http://radarr.invalid",
      RADARR_API_KEY: "fake",
      SONARR_URL: "http://tv.invalid",
      SONARR_API_KEY: "fake",
      SONARR_ANIME_URL: "http://anime.invalid",
      SONARR_ANIME_API_KEY: "fake",
      QBIT_URL: "http://qbit.invalid",
      QBIT_USERNAME: "",
      QBIT_PASSWORD: "",
      SEERR_URL: "http://seerr.invalid",
      SEERR_API_KEY: "fake-seerr",
    });
    const movie = {
      id: 400,
      title: "Fixture",
      year: 2025,
      tmdbId: 4242,
      hasFile: true,
      path: libraryRoot,
      movieFile: { id: 373, path: libraryFile },
    };
    const torrent = {
      hash,
      name: "Fixture",
      category: "MoviesRR",
      content_path: torrentRoot,
      save_path: "/data/torrents/movies",
      progress: 1,
      state: "stalledUP",
    };
    global.fetch = async (input, options) => {
      const url = new URL(input),
        method = options.method ?? "GET";
      assert.ok(
        url.hostname.endsWith(".invalid"),
        "No real services may be contacted by this test",
      );
      assert.equal(options.cache, "no-store");
      if (method !== "GET") {
        writes.push([url.hostname, url.pathname, method]);
        if (url.hostname === "qbit.invalid") {
          assert.equal(url.pathname, "/api/v2/torrents/delete");
          assert.equal(method, "POST");
          assert.equal(options.body.get("hashes"), hash);
          assert.equal(options.body.get("deleteFiles"), "true");
          torrentGone = true;
          if (scenario === "uncertain")
            throw Error("connection lost after acceptance");
        } else if (url.hostname === "seerr.invalid") {
          assert.equal(movieGone, true);
          assert.equal(url.pathname, "/api/v1/media/22");
          assert.equal(method, "DELETE");
          seerrGone = true;
          if (scenario === "seerr-uncertain")
            throw Error("Seerr connection lost after acceptance");
        } else {
          assert.equal(torrentGone, true);
          assert.equal(libraryGone, true);
          assert.equal(url.pathname, "/api/v3/movie/400");
          assert.equal(method, "DELETE");
          assert.equal(url.searchParams.get("deleteFiles"), "false");
          assert.equal(url.searchParams.get("addImportExclusion"), "false");
          movieGone = true;
        }
        return new Response(null, { status: 200 });
      }
      if (url.hostname === "seerr.invalid") {
        if (scenario === "seerr-unavailable") throw Error("Seerr unavailable");
        if (url.pathname === "/api/v1/auth/me")
          return Response.json({ permissions: 2 });
        if (url.pathname === "/api/v1/settings/radarr")
          return Response.json([{ id: 0, apiKey: "fake", is4k: false }]);
        if (url.pathname === "/api/v1/movie/4242")
          return Response.json({
            id: 4242,
            mediaInfo: seerrGone
              ? undefined
              : {
                  id: 22,
                  tmdbId: 4242,
                  mediaType: "movie",
                  status: movieGone ? 7 : 5,
                  status4k: scenario === "seerr-4k" ? 5 : 1,
                  serviceId: movieGone ? null : 0,
                  externalServiceId: movieGone ? null : 400,
                  serviceId4k: null,
                  externalServiceId4k: null,
                  requests: [
                    { id: 33, type: "movie", is4k: false, serverId: null },
                  ],
                  issues: [],
                },
          });
        if (url.pathname === "/api/v1/request/33")
          return seerrGone
            ? new Response(null, { status: 404 })
            : Response.json({ id: 33 });
      }
      if (url.pathname === "/api/v3/movie/400")
        return movieGone
          ? new Response(null, { status: 404 })
          : Response.json(movie);
      if (url.pathname === "/api/v3/movie")
        return Response.json(movieGone ? [] : [movie]);
      if (url.pathname === "/api/v3/series") return Response.json([]);
      if (url.pathname === "/api/v3/config/mediamanagement")
        return Response.json({
          recycleBin: scenario === "recycle" ? "/recycle" : "",
        });
      if (url.pathname === "/api/v3/history/movie")
        return Response.json([{ id: 1, movieId: 400, downloadId: hash }]);
      if (url.pathname === "/api/v3/history")
        return Response.json(
          url.hostname === "radarr.invalid"
            ? {
                totalRecords: 1,
                records: [
                  {
                    movieId: scenario === "shared-movie" ? 401 : 400,
                    downloadId: hash,
                  },
                ],
              }
            : scenario === "shared-show"
              ? {
                  totalRecords: 1,
                  records: [{ seriesId: 7, downloadId: hash }],
                }
              : { totalRecords: 0, records: [] },
        );
      if (url.pathname === "/api/v2/torrents/info")
        return Response.json(
          torrentGone
            ? []
            : scenario === "overlap"
              ? [torrent, { ...torrent, hash: "b".repeat(40) }]
              : [torrent],
        );
      if (url.pathname === "/api/v2/torrents/files")
        return Response.json([
          { name: "Fixture/movie.mkv", size: 100, progress: 1 },
        ]);
      throw Error(`Unexpected fake request ${url.pathname}`);
    };
    nas.inspectDeletionRoots = async () => {
      const plan = fixture();
      if (torrentGone) {
        plan.download = {
          ...plan.download,
          status: "missing",
          files: [],
          directories: [],
        };
        plan.library.files[0].links = 1;
      }
      if (libraryGone)
        plan.library = {
          ...plan.library,
          status: "missing",
          files: [],
          directories: [],
        };
      return [plan.library, plan.download];
    };
    nas.assertNativeCleanupAvailable = async () => {};
    nas.validateNativeLibraryTree = async (root, expected) => {
      assert.equal(root, libraryRoot);
      assert.equal(expected.files.length, 1);
      assert.equal(libraryGone, false);
    };
    nas.removeNativeLibraryTree = async (root, expected) => {
      assert.equal(root, libraryRoot);
      assert.equal(torrentGone, true);
      assert.deepEqual(
        expected.files.map((entry) => entry.links),
        [1],
      );
      libraryGone = true;
    };
    for (const blocked of [
      "recycle",
      "shared-movie",
      "shared-show",
      "overlap",
      "seerr-unavailable",
      "seerr-4k",
    ]) {
      scenario = blocked;
      await assert.rejects(service.prepareDeletion(400));
      assert.equal(writes.length, 0);
    }
    scenario = "normal";
    const prepared = await service.prepareDeletion(400);
    assert.equal(writes.length, 0);
    const result = await service.executeDeletion(
      400,
      prepared.token,
      confirmationFor(prepared.plan),
      true,
    );
    assert.equal(result.status, "completed");
    assert.equal(result.library, "verified");
    assert.equal(result.seerr, "verified");
    assert.equal(writes.length, 3);
    assert.equal((await store.readOperation(result.id)).status, "completed");
    assert.equal(fs.existsSync(path.join(temp, "deletion.lock")), false);
    await assert.rejects(
      service.executeDeletion(400, prepared.token, prepared.confirmation, true),
    );
    assert.equal(writes.length, 3);
    process.env.MOVIE_DELETION_ENABLED = "false";
    await assert.rejects(api.removeMovieRecord(400), /disabled/);
    await assert.rejects(api.removeTorrentAndData(hash), /disabled/);
    await assert.rejects(seerrApi.removeSeerrMedia(22), /disabled/);
    assert.equal(writes.length, 3);
    process.env.MOVIE_DELETION_ENABLED = "true";
    torrentGone = false;
    libraryGone = false;
    movieGone = false;
    seerrGone = false;
    scenario = "uncertain";
    const uncertain = await service.prepareDeletion(400);
    const stopped = await service.executeDeletion(
      400,
      uncertain.token,
      uncertain.confirmation,
      true,
    );
    assert.equal(stopped.status, "needs-attention");
    assert.equal(stopped.torrent, "requested");
    assert.equal(stopped.radarr, "not-started");
    assert.equal(movieGone, false);
    assert.equal(writes.length, 4);
    assert.equal(
      (await store.readOperation(stopped.id)).status,
      "needs-attention",
    );
    assert.equal(
      fs.readFileSync(path.join(temp, "deletion.lock"), "utf8"),
      stopped.id,
    );
  } finally {
    global.fetch = originalFetch;
    nas.inspectDeletionRoots = originalNas;
    nas.assertNativeCleanupAvailable = originalNativeCheck;
    nas.validateNativeLibraryTree = originalTreeValidation;
    nas.removeNativeLibraryTree = originalTreeRemoval;
    process.env = originalEnv;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("durable lock survives process state and refuses concurrent deletion", async () => {
  const previous = process.env.DELETE_STATE_DIR;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "arr-lock-test-"));
  try {
    process.env.DELETE_STATE_DIR = temp;
    const id = "00000000-0000-4000-8000-000000000001";
    await store.acquireDeletionLock(id);
    await assert.rejects(
      store.acquireDeletionLock("00000000-0000-4000-8000-000000000002"),
      /locked/,
    );
    assert.equal(fs.readFileSync(path.join(temp, "deletion.lock"), "utf8"), id);
    await assert.rejects(
      store.releaseDeletionLock("00000000-0000-4000-8000-000000000002"),
      /ownership/,
    );
    await store.releaseDeletionLock(id);
  } finally {
    if (previous === undefined) delete process.env.DELETE_STATE_DIR;
    else process.env.DELETE_STATE_DIR = previous;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
