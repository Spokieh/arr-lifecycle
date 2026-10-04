import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

const base = process.env.BENCH_URL || "http://192.168.1.161:3210";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const health = await fetch(base + "/api/health");
  const healthStatus = await health.json();
  assert.equal(healthStatus.status, "ok");
  const deletionEnabled = healthStatus.deletion?.movies === true;
  await page.goto(base + "/movies/148");
  await page
    .getByRole("heading", { name: "Intimate Strangers", exact: true })
    .waitFor();
  const observations = page.getByRole("region", {
    name: "Filesystem observations",
  });
  await observations
    .getByText(/SMB hardlink verification: NOT VERIFIED/)
    .waitFor();
  const details = await observations.innerText();
  assert.match(details, /Metadata observed/);
  assert.match(details, /SMB\/CIFS/);
  assert.ok(
    (await page.locator("body").innerText()).includes("Hash match verified"),
  );
  const movieAction = page.getByRole("button", {
    name: deletionEnabled ? "Prepare deletion" : "Delete (not enabled yet)",
  });
  assert.equal(await movieAction.isVisible(), true);
  assert.equal(await movieAction.isDisabled(), !deletionEnabled);
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
      .getByText(/SMB hardlink verification: NOT VERIFIED/)
      .waitFor();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
  }
  await page.goto(base + "/movies/400");
  await page
    .getByRole("heading", { name: "Zootopia 2", exact: true })
    .waitFor();
  const native = page.getByRole("region", { name: "Native NAS evidence" });
  await native
    .getByText("1 library ↔ torrent hardlink group(s) confirmed on ZFS", {
      exact: true,
    })
    .waitFor();
  const evidence = await native.innerText();
  assert.match(evidence, /2 known path\(s\); 0 additional live link\(s\)/);
  assert.match(evidence, /fulcrum-zootopia\.2\.2025\.webrip\.ma-sample\.mkv/);
  assert.equal(await movieAction.isVisible(), true);
  assert.equal(await movieAction.isDisabled(), !deletionEnabled);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: deployed health, Radarr/qBittorrent exact match, CIFS diagnostics, native ZFS hardlink proof for Zootopia 2, TV/anime modals and deletion feature state. No deletion executed.",
  );
} finally {
  await browser.close();
}
