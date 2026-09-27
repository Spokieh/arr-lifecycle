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
const { matchMovie } = require("../src/lib/services/matching.ts");
const { cached } = require("../src/lib/server/cache.ts");
const { request } = require("../src/lib/server/http.ts");
const movie = { id: 148, title: "Intimate Strangers", year: 2018 };
const hash = "a".repeat(40);
const torrent = {
  hash,
  name: "Intimate.Strangers.2018.mkv",
  category: "MoviesRR",
};
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
