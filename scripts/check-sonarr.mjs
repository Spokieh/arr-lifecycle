// Isolated local fake APIs + a temporary production app. Never contacts real services.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const hash = "a".repeat(40),
  animeHash = "b".repeat(40);
const calls = [];
let animeDown = false,
  qbitDown = false;
const api = createServer((req, res) => {
  calls.push({ method: req.method, path: req.url });
  const url = new URL(req.url, "http://localhost");
  if (req.method !== "GET") {
    res.writeHead(405).end();
    return;
  }
  const anime = url.pathname.startsWith("/anime/");
  if ((anime && animeDown) || (url.pathname.startsWith("/qbit/") && qbitDown)) {
    res.writeHead(503).end();
    return;
  }
  const json = (value) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(value));
  };
  if (url.pathname.endsWith("/app/version")) {
    res.end("v5.2.3");
    return;
  }
  if (url.pathname.endsWith("/torrents/info")) {
    json(
      [hash, animeHash].map((hash, index) => ({
        hash,
        name: index ? "Anime season pack" : "TV season pack",
        category: index ? "Anime" : "TV",
        state: "stalledUP",
        ratio: 1.5,
        seeding_time: 86400,
        size: 1024,
        total_size: 1024,
        save_path: "/downloads",
        content_path: "/downloads/pack",
      })),
    );
    return;
  }
  if (url.pathname.endsWith("/system/status")) {
    json({ version: "4.0.0" });
    return;
  }
  const series = {
    id: 7,
    title: anime ? "Anime fixture" : "TV fixture",
    year: 2024,
    path: "/media/show",
    monitored: true,
    statistics: { sizeOnDisk: 2048 },
    overview: "Read-only fixture",
  };
  const episodes = [1, 2].map((id) => ({
    id,
    seriesId: 7,
    seasonNumber: 1,
    episodeNumber: id,
    title: `Episode ${id}`,
    hasFile: true,
    monitored: true,
    episodeFileId: id,
  }));
  if (url.pathname.endsWith("/api/v3/series")) {
    json([series]);
    return;
  }
  if (url.pathname.endsWith("/series/7")) {
    json(series);
    return;
  }
  if (url.pathname.endsWith("/episode")) {
    json(episodes);
    return;
  }
  if (url.pathname.endsWith("/episodefile")) {
    json(
      episodes.map((episode) => ({
        id: episode.id,
        seriesId: 7,
        path: `/media/show/${episode.id}.mkv`,
        size: 1024,
      })),
    );
    return;
  }
  if (url.pathname.endsWith("/history/series")) {
    json(
      episodes.map((episode) => ({
        id: episode.id,
        seriesId: 7,
        episodeId: episode.id,
        eventType: "downloadFolderImported",
        date: "2026-01-01T00:00:00Z",
        downloadId: anime ? animeHash : hash,
      })),
    );
    return;
  }
  res.writeHead(404).end();
});
api.listen(0, "127.0.0.1");
await once(api, "listening");
const apiBase = `http://127.0.0.1:${api.address().port}`;
const port = process.env.SONARR_TEST_PORT || "3101";
const base = `http://127.0.0.1:${port}`;
const app = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    port,
  ],
  {
    windowsHide: true,
    stdio: "pipe",
    env: {
      ...process.env,
      SONARR_URL: apiBase + "/tv",
      SONARR_API_KEY: "fixture-tv-key",
      SONARR_QBIT_CATEGORY: "TV",
      SONARR_ANIME_URL: apiBase + "/anime",
      SONARR_ANIME_API_KEY: "fixture-anime-key",
      SONARR_ANIME_QBIT_CATEGORY: "Anime",
      QBIT_URL: apiBase + "/qbit",
      QBIT_USERNAME: "",
      QBIT_PASSWORD: "",
    },
  },
);
let output = "";
app.stdout.on("data", (data) => {
  output += data;
});
app.stderr.on("data", (data) => {
  output += data;
});
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (app.exitCode !== null) throw new Error(output);
    if (output.includes("Ready")) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, output);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base + "/shows");
  await page
    .getByRole("link", { name: "TV fixture (tv)", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .locator("summary")
    .filter({ hasText: "Season 1" })
    .filter({ hasText: "2/2 on disk" })
    .waitFor();
  await dialog
    .getByRole("heading", { name: "TV fixture", exact: true })
    .waitFor();
  assert.ok((await dialog.innerText()).includes(hash));
  assert.ok(!(await dialog.innerText()).includes(animeHash));
  await dialog.locator("summary").filter({ hasText: hash }).click();
  await dialog.getByText(/Shared hash across episodes/).waitFor();
  assert.equal(
    await dialog
      .getByRole("button", { name: "Delete (not enabled yet)" })
      .isDisabled(),
    true,
  );
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByRole("link", { name: "Anime fixture (anime)", exact: true })
    .click();
  await dialog
    .getByRole("heading", { name: "Anime fixture", exact: true })
    .waitFor();
  assert.ok((await dialog.innerText()).includes(animeHash));
  await page.goto(base + "/shows/tv/7");
  await page
    .getByRole("heading", { name: "TV fixture", exact: true })
    .waitFor();
  assert.equal(await dialog.count(), 0);
  const html = await page.content();
  assert.ok(
    !html.includes("fixture-tv-key") && !html.includes("fixture-anime-key"),
  );
  animeDown = true;
  await page.goto(base + "/shows");
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await page.getByText(/Sonarr \(anime\): HTTP 503/).waitFor();
  await page
    .getByRole("link", { name: "TV fixture (tv)", exact: true })
    .waitFor();
  qbitDown = true;
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await page.getByText(/qBittorrent: HTTP 503/).waitFor();
  await page
    .getByRole("link", { name: "TV fixture (tv)", exact: true })
    .click();
  await dialog.getByText("Lookup incomplete. No match is verified.").waitFor();
  assert.ok(!(await dialog.innerText()).includes("Hash match verified"));
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok((await dialog.boundingBox()).width <= 390);
  assert.deepEqual(errors, []);
  assert.ok(calls.every((call) => call.method === "GET"));
  console.log(
    "PASS: two isolated Sonarr instances, series/episodes/hash evidence, shared pack warning, modal/direct route/mobile, outage isolation, no exposed keys, upstream GET-only.",
  );
} finally {
  if (browser) await browser.close();
  if (app.exitCode === null) {
    app.kill();
    await once(app, "exit");
  }
  api.closeAllConnections();
  await new Promise((resolve) => api.close(resolve));
}
