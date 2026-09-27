import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

const base = process.env.BENCH_URL || "http://192.168.1.161:3210";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const health = await fetch(base + "/api/health");
  assert.deepEqual(await health.json(), { status: "ok", mode: "read-only" });
  await page.goto(base + "/movies/148");
  await page
    .getByRole("heading", { name: "Intimate Strangers", exact: true })
    .waitFor();
  const observations = page.getByRole("region", {
    name: "Filesystem observations",
  });
  await observations.getByText(/Hardlink verification: NOT VERIFIED/).waitFor();
  const details = await observations.innerText();
  assert.match(details, /Metadata observed/);
  assert.match(details, /SMB\/CIFS/);
  assert.ok(
    (await page.locator("body").innerText()).includes("Hash match verified"),
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Delete (not enabled yet)" })
      .isDisabled(),
    true,
  );
  for (const source of ["tv", "anime"]) {
    await page.goto(`${base}/shows?source=${source}`);
    const card = page
      .locator(`[data-media-card="${source === "tv" ? "TV" : "ANIME"}"] a`)
      .first();
    await card.waitFor();
    await card.click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("heading", { name: "Sonarr library", exact: true })
      .waitFor();
    await dialog
      .getByRole("region", { name: "Filesystem observations" })
      .getByText(/Hardlink verification: NOT VERIFIED/)
      .waitFor();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: deployed health, Radarr/qBittorrent exact match, Linux CIFS metadata, TV/anime modals and disabled deletion.",
  );
} finally {
  await browser.close();
}
