import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
const base = process.env.BENCH_URL || "http://localhost:3000";
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  const start = performance.now();
  await page.goto(base + "/movies?match=matched&file=yes&sort=size-desc");
  const nav = page.getByRole("navigation", { name: "Movie pages" });
  await nav.waitFor();
  assert.equal(
    await page.getByText("Matching unavailable", { exact: true }).count(),
    0,
  );
  const counts = (await nav.innerText()).match(/(\d+) of (\d+) movies/);
  assert.ok(
    counts && Number(counts[1]) > 24,
    "Live library should contain matches beyond page one",
  );
  console.log(
    `Full-library matching: ${Math.round(performance.now() - start)}ms, ${counts[1]} of ${counts[2]} movies`,
  );
  await nav.getByRole("link", { name: "Next", exact: true }).click();
  await page.waitForURL(/page=2/);
  assert.equal(new URL(page.url()).searchParams.get("sort"), "size-desc");
  const firstCard = page.locator('a[href^="/movies/"]').first();
  await firstCard.click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(new URL(page.url()).searchParams.get("page"), "2");
  const before = await page.locator("time").getAttribute("datetime");
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await page.waitForFunction(
    (previous) =>
      document.querySelector("time")?.getAttribute("datetime") !== previous,
    before,
  );
  assert.equal(new URL(page.url()).searchParams.get("match"), "matched");
  await page.getByLabel("Torrent match").selectOption("all");
  await page.getByLabel("Library file").selectOption("no");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.waitForURL(/file=no/);
  assert.equal(new URL(page.url()).searchParams.has("page"), false);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: full-library match filter, pagination, modal state, refresh timestamp, filter reset, mobile width, no browser errors.",
  );
} finally {
  await browser.close();
}
