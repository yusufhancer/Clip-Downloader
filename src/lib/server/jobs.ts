import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { ClipJob, ClipRequest } from "../contracts";
import { validVideoId, validateTimes } from "../validation";
import { config } from "./config";
import { AppError, mediaError } from "./errors";
import { mediaProvider } from "./media-provider";
import { encodeClip } from "./ffmpeg";

interface StoredJob { view: ClipJob; directory: string; output: string; createdAt: number; expires: number }
interface JobState { jobs: Map<string, StoredJob>; active: number; timer?: ReturnType<typeof setInterval>; cleaning?: Promise<void> }
const globalState = globalThis as typeof globalThis & { clipJobs?: JobState };
const state: JobState = globalState.clipJobs ??= { jobs: new Map(), active: 0 };
const JOB_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function parseClipRequest(body: Record<string, unknown>): ClipRequest {
  if (!validVideoId(body.videoId)) throw new AppError("INVALID_VIDEO", "Load a valid YouTube video first.");
  if (body.format !== "mp4") throw new AppError("INVALID_FORMAT", "Only MP4 output is supported.");
  if (typeof body.quality !== "string" || !/^\d{2,4}p$/.test(body.quality)) throw new AppError("INVALID_QUALITY", "Choose an available video quality.");
  if (typeof body.startTime !== "number" || typeof body.endTime !== "number") throw new AppError("INVALID_TIME", "Start and end times must be numbers.");
  const error = validateTimes(body.startTime, body.endTime, config.maxVideoDuration, config.maxClipDuration);
  if (error) throw new AppError("INVALID_TIME", error);
  return body as unknown as ClipRequest;
}
async function cleanFiles() {
  await mkdir(config.tempDir, { recursive: true });
  const now = Date.now();
  for (const [id, job] of state.jobs) {
    if (["queued", "processing"].includes(job.view.status)) continue;
    if (job.expires <= now) {
      await rm(job.directory, { recursive: true, force: true }).catch(() => undefined);
      job.view = { jobId: id, status: "expired", stage: "This clip has expired. Create it again to download." };
      if (now - job.expires > config.fileTtlSeconds * 1000) state.jobs.delete(id);
    }
  }
  // Remove only UUID directories owned by this application, including leftovers after a restart.
  for (const entry of await readdir(config.tempDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !JOB_ID.test(entry.name) || state.jobs.has(entry.name)) continue;
    const directory = path.join(config.tempDir, entry.name);
    const info = await stat(directory);
    if (now - info.mtimeMs > config.fileTtlSeconds * 1000) await rm(directory, { recursive: true, force: true });
  }
}
export async function cleanup() {
  if (!state.cleaning) state.cleaning = cleanFiles().finally(() => { state.cleaning = undefined; });
  await state.cleaning;
}
export function initializeJobs() {
  if (!state.timer) {
    state.timer = setInterval(() => { void cleanup().catch(() => undefined); }, 60_000);
    state.timer.unref();
    void cleanup().catch(() => undefined);
  }
}
export function createJob(input: ClipRequest): ClipJob {
  initializeJobs();
  if (state.active >= config.maxConcurrentJobs) throw new AppError("BUSY", "The server is currently busy. Please try again shortly.", 503);
  const jobId = randomUUID();
  const directory = path.join(config.tempDir, jobId);
  const job: StoredJob = { view: { jobId, status: "queued", stage: "Preparing video…" }, directory, output: path.join(directory, "clip.mp4"), createdAt: Date.now(), expires: Infinity };
  state.jobs.set(jobId, job);
  state.active++;
  void processJob(job, input);
  return { ...job.view };
}
async function processJob(job: StoredJob, input: ClipRequest) {
  try {
    job.view.status = "processing";
    const source = await mediaProvider.getMediaSource(input.videoId, input.quality);
    const error = validateTimes(input.startTime, input.endTime, source.metadata.duration, config.maxClipDuration);
    if (error) throw new AppError("INVALID_TIME", error);
    await mkdir(job.directory, { recursive: true });
    job.view.stage = "Processing selected clip…";
    const result = await encodeClip(source, input.startTime, input.endTime, job.output);
    job.view.stage = "Finalizing…";
    const file = await stat(job.output);
    const expected = input.endTime - input.startTime;
    if (!file.size || Math.abs(result.duration - expected) > 1.5) throw new AppError("INCOMPLETE_CLIP", "The source returned an incomplete clip. Please try again.", 502);
    const title = source.metadata.title.normalize("NFKD").replace(/[^a-zA-Z0-9 _-]/g, "").trim().replace(/\s+/g, "-").slice(0, 70) || "youtube";
    job.expires = Date.now() + config.fileTtlSeconds * 1000;
    job.view = { jobId: job.view.jobId, status: "completed", stage: "Your clip is ready.", downloadUrl: `/api/jobs/${job.view.jobId}/download`, filename: `${title}-${input.startTime}-${input.endTime}.mp4`, duration: result.duration, quality: result.quality, fileSize: file.size, expiresAt: new Date(job.expires).toISOString() };
  } catch (error) {
    job.view.status = "failed";
    job.view.stage = "Clip processing failed.";
    job.view.error = mediaError(error).message;
    job.expires = Date.now() + config.fileTtlSeconds * 1000;
    await rm(job.directory, { recursive: true, force: true }).catch(() => undefined);
  } finally { state.active--; }
}
export async function getJob(id: string): Promise<StoredJob> {
  initializeJobs();
  if (!JOB_ID.test(id)) throw new AppError("NOT_FOUND", "This clip was not found or the server has restarted. Please create it again.", 404);
  const job = state.jobs.get(id);
  if (!job) throw new AppError("NOT_FOUND", "This clip was not found or the server has restarted. Please create it again.", 404);
  if (job.expires <= Date.now()) {
    job.view = { jobId: id, status: "expired", stage: "This clip has expired. Create it again to download." };
    void cleanup().catch(() => undefined);
  }
  return job;
}
