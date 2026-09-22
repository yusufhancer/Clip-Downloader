import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const source = process.argv[2];
if (!source) throw new Error("Usage: node scripts/live-browser.mjs <YouTube URL you have permission to process>");
await mkdir("test-results", { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1365, height: 1000 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", async response => {
    if (response.url().includes("/api/video/info") && !response.ok()) console.log("Metadata request failed:", response.status(), await response.text());
  });
  await page.goto(process.env.TEST_BASE_URL || "http://127.0.0.1:3000");
  await page.getByLabel("YouTube URL").fill(source);
  await page.getByRole("button", { name: "Load video" }).click();
  try { await page.getByRole("heading", { name: "Select your segment" }).waitFor({ timeout: 90_000 }); }
  catch (error) { await page.screenshot({ path: "test-results/live-failure.png", fullPage: true }); console.log(await page.locator("main").innerText()); throw error; }
  let previewReady = true;
  try {
    await page.getByRole("button", { name: "Set Start", exact: false }).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => button.textContent.includes("Set Start") && !button.disabled), { timeout: 30_000 });
    await page.getByRole("button", { name: "Set Start", exact: false }).click();
    console.log("Live player ready; Set Start returned:", await page.getByLabel("Start", { exact: true }).inputValue());
  } catch { previewReady = false; console.log("Live embedded player unavailable; testing manual timestamp path."); }
  await page.getByLabel("Start", { exact: true }).fill("00:02");
  await page.getByLabel("End", { exact: true }).fill("00:08");
  await page.screenshot({ path: "test-results/live-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Download Clip", exact: true }).click();
  await page.getByRole("heading", { name: "Your clip is ready." }).waitFor({ timeout: 180_000 });
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download MP4", exact: true }).click();
  const download = await event;
  await download.saveAs(path.resolve("test-results", "live-browser-clip.mp4"));
  await page.screenshot({ path: "test-results/live-completed.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/live-mobile.png", fullPage: true });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error("Mobile content overflows");
  if (errors.length) throw new Error(`Browser errors: ${errors.join(", ")}`);
  console.log(JSON.stringify({ previewReady, downloaded: download.suggestedFilename(), pageErrors: errors, mobileOverflow: false }));
} finally { await browser.close(); }
