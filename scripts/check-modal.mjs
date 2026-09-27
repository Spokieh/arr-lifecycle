import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const base = process.env.BENCH_URL || "http://localhost:3000";
try {
  await page.goto(base + "/movies?q=Intimate");
  const link = page.getByRole("link", {
    name: "Intimate Strangers",
    exact: true,
  });
  await link.waitFor();
  await link.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await dialog
    .getByRole("heading", { name: "Intimate Strangers", exact: true })
    .waitFor();
  await page.waitForFunction(() => {
    const img = document.querySelector("dialog img");
    return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0;
  });
  await page.screenshot({ path: "modal-preview.png" });
  assert.equal(await page.locator("#movie-search").inputValue(), "Intimate");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(new URL(page.url()).searchParams.get("q"), "Intimate");
  await page.goForward();
  await dialog.waitFor();
  await page.getByRole("button", { name: "Close movie details" }).click();
  await dialog.waitFor({ state: "hidden" });
  await link.click();
  await dialog.waitFor();
  await page.mouse.click(5, 5);
  await dialog.waitFor({ state: "hidden" });
  await link.click();
  await dialog.waitFor();
  await page.goBack();
  await dialog.waitFor({ state: "hidden" });
  await page.goto(base + "/movies/148");
  await page
    .getByRole("heading", { name: "Intimate Strangers", exact: true })
    .waitFor();
  assert.equal(await dialog.count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/movies?q=Intimate");
  await link.click();
  await dialog.waitFor();
  const box = await dialog.boundingBox();
  assert.ok(box.width <= 390);
  await page.getByRole("button", { name: "Close movie details" }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: open, Escape, close button, backdrop, back/forward, preserved search, direct link, mobile, no browser errors.",
  );
} finally {
  await browser.close();
}
