#!/usr/bin/env node
/**
 * Re-capture receipt.png and demo.png with correct framing.
 * Run: node scripts/fix-screenshots.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "docs/images");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const VP = { width: 1920, height: 1080 };

async function shot(name, fn) {
  const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  console.log(`→ ${name}`);
  await fn(page);
  const out = resolve(OUT, name);
  await page.screenshot({ path: out, fullPage: false });
  console.log(`  saved ${out}`);
  await ctx.close();
}

// 1. Receipts tab — scroll to tabs section, click Receipts, screenshot
await shot("receipt.png", async (page) => {
  await page.goto("https://beacon.gudman.xyz", {
    waitUntil: "networkidle",
    timeout: 30000,
  }).catch(() => {});
  await page.waitForTimeout(3000);

  // Scroll the Receipts tab button into view and click it
  const tab = page.locator('button.tab[data-tab="cascades"]');
  await tab.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await tab.click();
  console.log("  receipts tab clicked");
  await page.waitForTimeout(2500);

  // Now scroll so the tab bar sits near the top of the viewport
  await page.evaluate(() => {
    const tabBar = document.querySelector(".tabs[role='tablist']");
    if (tabBar) {
      const rect = tabBar.getBoundingClientRect();
      window.scrollBy(0, rect.top - 10);
    }
  });
  await page.waitForTimeout(500);
});

// 2. Demo widget — scroll to the actual demo section on docs page
await shot("demo.png", async (page) => {
  await page.goto("https://beacon.gudman.xyz/docs.html", {
    waitUntil: "networkidle",
    timeout: 30000,
  }).catch(() => {});
  await page.waitForTimeout(3000);

  // Scroll the #demo section into view
  await page.evaluate(() => {
    const demo = document.querySelector("#demo");
    if (demo) {
      demo.scrollIntoView({ block: "start" });
      return;
    }
    // Fallback: find the "Call signal" button
    const btn = document.querySelector("#demo-call");
    if (btn) {
      btn.scrollIntoView({ block: "center" });
      return;
    }
    // Fallback: find heading with "Call a paid signal"
    const h = Array.from(document.querySelectorAll("h2, h3")).find(
      (el) => /call a paid signal/i.test(el.textContent || "")
    );
    if (h) h.scrollIntoView({ block: "start" });
  });

  await page.waitForTimeout(1000);

  // Nudge up slightly so the section heading is visible
  await page.evaluate(() => window.scrollBy(0, -30));
  await page.waitForTimeout(300);
});

await browser.close();
console.log("done.");
