import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import ffprobe from "ffprobe-static";

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
const source = process.argv[2];
if (!source) throw new Error("Usage: node scripts/live-smoke.mjs <YouTube URL you have permission to process>");
async function api(endpoint, body) {
  const response = await fetch(base + endpoint, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(90_000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
const { video } = await api("/api/video/info", { url: source });
console.log("Metadata:", JSON.stringify({ title: video.title, duration: video.duration, qualities: video.qualities }));
const startTime = 2;
const endTime = Math.min(8, Math.floor(video.duration));
const quality = video.qualities.includes("720p") ? "720p" : video.qualities.at(-1);
let job = await api("/api/clips", { videoId: video.videoId, startTime, endTime, quality, format: "mp4" });
const deadline = Date.now() + 16 * 60_000;
let previous = "";
while (["queued", "processing"].includes(job.status)) {
  if (Date.now() > deadline) throw new Error("Live smoke test timed out");
  if (job.stage !== previous) { console.log(job.stage); previous = job.stage; }
  await new Promise(resolve => setTimeout(resolve, 1000));
  job = await api(`/api/jobs/${job.jobId}`);
}
if (job.status !== "completed") throw new Error(job.error || job.stage);
const response = await fetch(base + job.downloadUrl);
if (!response.ok) throw new Error(`Download failed: ${response.status}`);
const directory = path.resolve("test-results");
await mkdir(directory, { recursive: true });
const output = path.join(directory, "live-clip.mp4");
await writeFile(output, Buffer.from(await response.arrayBuffer()));
const probe = spawnSync(process.env.FFPROBE_PATH || ffprobe.path, ["-v", "error", "-show_entries", "format=duration,size:stream=codec_name,codec_type,width,height", "-of", "json", output], { encoding: "utf8", shell: false, windowsHide: true });
if (probe.status !== 0) throw new Error("FFprobe failed to inspect the downloaded clip");
const result = JSON.parse(probe.stdout);
if (Math.abs(Number(result.format.duration) - (endTime - startTime)) > 1) throw new Error("Incorrect output duration");
console.log("Downloaded and verified:", output, JSON.stringify(result));
