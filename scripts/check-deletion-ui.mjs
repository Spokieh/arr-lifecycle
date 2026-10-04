// Deployed UI, intercepted prepare/execute responses. Never deletes real media.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const base = process.env.BENCH_URL || "http://192.168.1.161:3210";
const instance = process.env.UI_SERIES_INSTANCE;
assert.ok(!instance || ["tv", "anime"].includes(instance));
const seriesId = instance === "anime" ? 14 : 71;
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  const calls = [],
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const id = "00000000-0000-4000-8000-000000000001";
  const identity = {
    device: "124",
    inode: "123",
    links: 2,
    bytes: "100",
    modifiedNs: "456",
  };
  const plan = {
    movieId: 148,
    title: "UI test fixture",
    year: 2025,
    movieFileId: 373,
    libraryFile: "/data/media/movies/Fixture/movie.mkv",
    libraryRoot: "/data/media/movies/Fixture",
    torrentRoot: "/data/torrents/movies/Fixture",
    torrentHash: "a".repeat(40),
    torrentName: "UI test torrent",
    seerr: {
      tmdbId: 4242,
      radarrMovieId: 148,
      radarrServerId: 0,
      mediaId: 22,
      requestIds: [33],
      issueIds: [],
    },
    library: {
      files: [{ ...identity, path: "/data/media/movies/Fixture/movie.mkv" }],
    },
    download: {
      files: [{ ...identity, path: "/data/torrents/movies/Fixture/movie.mkv" }],
    },
  };
  if (instance) {
    Object.assign(plan, { kind: "series", instance, seriesId,
      episodeFiles: [{ id: 1 }],
      torrents: [{ hash: "a".repeat(40), name: "UI test torrent", category: instance === "anime" ? "AnimeRR" : "SeriesRR", inventory: plan.download }],
    });
    delete plan.movieId;
  }
  const phrase = `DELETE UI test fixture (2025)${instance ? ` [Sonarr ${instance === "anime" ? "Anime" : "TV"}]` : ""}`;
  await page.route(instance ? "**/api/shows/*/*/deletion" : "**/api/movies/*/deletion", async (route) => {
    const body = route.request().postDataJSON();
    calls.push(body.action);
    if (body.action === "prepare") {
      await route.fulfill({
        json: {
          prepared: {
            operationId: id,
            token: "c".repeat(64),
            expiresAt: new Date(Date.now() + 120000).toISOString(),
            confirmation: phrase,
            plan,
          },
        },
      });
    } else if (body.action === "execute") {
      assert.equal(body.confirmation, phrase);
      assert.equal(body.acknowledged, true);
      await route.fulfill({
        json: {
          operation: {
            id,
            movieId: 148,
            title: "UI test fixture",
            status: "needs-attention",
            torrent: "verified",
            radarr: "verified",
            ...(instance ? { kind: "series", instance, seriesId, torrents: [{hash: "a".repeat(40), state: "verified"}], sonarr: "verified" } : {}),
            seerr: "requested",
            message: "Simulated partial failure",
            plan,
          },
        },
      });
    } else {
      await route.abort();
    }
  });
  await page.goto(base + (instance ? `/shows/${instance}/${seriesId}` : "/movies/148"));
  await page
    .getByRole("region", { name: "Seerr connection and match" })
    .getByText(/Connected · v/)
    .waitFor();
  const prepare = page.getByRole("button", {
    name: "Prepare deletion",
    exact: true,
  });
  await prepare.waitFor();
  assert.equal(await prepare.isEnabled(), true);
  await prepare.click();
  const remove = page.getByRole("button", {
    name: "Confirm delete",
    exact: true,
  });
  await remove.waitFor();
  await page.getByText(/Seerr: media #22/).waitFor();
  assert.equal(await remove.isDisabled(), true);
  await page.getByLabel(/Type DELETE/).fill("wrong confirmation");
  await page.getByRole("checkbox").check();
  assert.equal(await remove.isDisabled(), true);
  await page.getByLabel(/Type DELETE/).fill(phrase);
  assert.equal(await remove.isEnabled(), true);
  await remove.click();
  await page.getByText("Simulated partial failure", { exact: true }).waitFor();
  assert.equal(await prepare.isDisabled(), true);
  await page.getByText("Operation status / recovery", { exact: true }).click();
  assert.equal(
    await page.getByRole("button", { name: "Check operation status" }).count(),
    1,
  );
  assert.deepEqual(calls, ["prepare", "execute"]);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: prepare without access code, exact phrase, acknowledgement, single execution and partial-failure UI. All mutation responses intercepted.",
  );
} finally {
  await browser.close();
}
