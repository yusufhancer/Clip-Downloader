import { expect, test } from "@playwright/test";

test("clip workflow, player timestamps, validation and download (controlled source)", async ({ page }) => {
  await page.route("https://www.youtube.com/iframe_api", route => route.fulfill({ contentType: "application/javascript", body: `window.YT={Player:class {constructor(el,opts){this.time=70;el.innerHTML='<div>Test video preview</div>';setTimeout(()=>opts.events.onReady({target:this}),0)}getCurrentTime(){return this.time}destroy(){}}};window.onYouTubeIframeAPIReady();` }));
  await page.route("**/api/video/info", route => route.fulfill({ json: { video: { videoId: "jNQXAC9IVRw", title: "A walk through the city", channel: "Sample source", thumbnail: "https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg", duration: 1800, qualities: ["360p", "720p"] }, limits: { maxClipDuration: 300, maxVideoDuration: 14400, fileTtlSeconds: 3600 } } }));
  let requestBody: unknown;
  await page.route("**/api/clips", async route => { requestBody = route.request().postDataJSON(); await route.fulfill({ status: 202, json: { jobId: "test-job", status: "processing", stage: "Processing selected clip…" } }); });
  await page.route("**/api/jobs/test-job", route => route.fulfill({ json: { jobId: "test-job", status: "completed", stage: "Your clip is ready.", filename: "sample-clip.mp4", duration: 70, quality: "720p", fileSize: 123456, downloadUrl: "/api/jobs/test-job/download", expiresAt: new Date(Date.now() + 3600000).toISOString() } }));
  await page.route("**/api/jobs/test-job/download", route => route.fulfill({ contentType: "video/mp4", body: Buffer.from("browser-test-download") }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Just the part you need." })).toBeVisible();
  await page.screenshot({ path: `test-results/empty-${test.info().project.name}.png`, fullPage: true });
  await page.getByLabel("YouTube URL").fill("https://evil.test/video");
  await page.getByRole("button", { name: "Load video" }).click();
  await expect(page.locator("#url-error")).toContainText("valid YouTube");
  await page.getByLabel("YouTube URL").fill("https://youtu.be/jNQXAC9IVRw");
  await page.getByRole("button", { name: "Load video" }).click();
  await expect(page.getByRole("heading", { name: "A walk through the city" })).toBeVisible();
  await expect(page.getByLabel("Video quality").locator("option")).toHaveCount(2);
  await page.getByRole("button", { name: "Set End", exact: false }).click();
  await expect(page.getByLabel("End", { exact: true })).toHaveValue("01:10");
  await page.getByRole("button", { name: "Set Start", exact: false }).click();
  await expect(page.getByLabel("Start", { exact: true })).toHaveValue("01:10");
  await expect(page.getByRole("button", { name: "Download Clip", exact: true })).toBeDisabled();
  await page.getByLabel("Start", { exact: true }).fill("25:00");
  await page.getByLabel("End", { exact: true }).fill("26:10");
  await expect(page.getByRole("status").filter({ hasText: "01:10" })).toBeVisible();
  await page.screenshot({ path: `test-results/loaded-${test.info().project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Download Clip", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your clip is ready." })).toBeVisible();
  expect(requestBody).toMatchObject({ startTime: 1500, endTime: 1570, quality: "720p", format: "mp4" });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download MP4", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("sample-clip.mp4");
  await page.getByRole("button", { name: "Create another clip" }).click();
  await expect(page.getByRole("button", { name: "Download Clip", exact: true })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "A walk through the city" })).toBeVisible();
});

test("metadata errors are readable inline", async ({ page }) => {
  await page.route("**/api/video/info", route => route.fulfill({ status: 422, json: { error: "This video is private." } }));
  await page.goto("/");
  await page.getByLabel("YouTube URL").fill("https://youtu.be/jNQXAC9IVRw");
  await page.getByRole("button", { name: "Load video" }).click();
  await expect(page.locator("#url-error")).toHaveText("This video is private.");
  await expect(page.getByRole("button", { name: "Load video" })).toBeEnabled();
});
