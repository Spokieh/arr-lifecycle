import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  for (const instance of ["tv", "anime"]) {
    await page.goto(`http://localhost:3000/shows?source=${instance}`);
    const card = page.locator(`a[href^="/shows/${instance}/"]`).first();
    await card.waitFor();
    const sharedCard = page.locator("[data-media-card]").first();
    assert.equal(await sharedCard.getAttribute("data-media-card"), instance === "anime" ? "ANIME" : "TV");
    assert.ok((await sharedCard.innerText()).includes("Not checked"));
    assert.match(await sharedCard.innerText(), /COMPLETE|PARTIAL|NO FILES|ON DISK|UNKNOWN/);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.waitForFunction((source) => {
      const image = document.querySelector(`a[href^="/shows/${source}/"] img`);
      return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
    }, instance);
    await card.click();
    await page.getByRole("dialog").waitFor();
    await page.waitForFunction(() => {
      const image = document.querySelector("dialog img");
      return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
    });
    assert.match(await page.locator("dialog img").getAttribute("src"), /^https:\/\/artworks\.thetvdb\.com\/banners\//);
    console.log(`PASS: ${instance} poster and modal backdrop loaded successfully.`);
  }
} finally { await browser.close(); }
