import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { runProcess } from "../src/lib/server/process";
import { clippingArgs, ffmpegPath, probeClip } from "../src/lib/server/ffmpeg";

const testState = vi.hoisted(() => ({ source: "", fail: false }));
vi.mock("../src/lib/server/media-provider", async importOriginal => {
  const real = await importOriginal<typeof import("../src/lib/server/media-provider")>();
  return { ...real, mediaProvider: { getMediaSource: vi.fn(async () => {
    if (testState.fail) throw new Error("private video");
    return { videoUrl: testState.source, quality: "240p", metadata: { videoId: "jNQXAC9IVRw", title: "Test / Clip", duration: 8, channel: "Test", thumbnail: "", qualities: ["240p"] } };
  }) } };
});
vi.mock("../src/lib/server/ffmpeg", async importOriginal => {
  const real = await importOriginal<typeof import("../src/lib/server/ffmpeg")>();
  return { ...real, encodeClip: async (source: { videoUrl: string }, start: number, end: number, output: string) => {
    // Test-only source adapter. Production rejects local and arbitrary remote inputs.
    await runProcess(real.ffmpegPath(), real.clippingArgs(source, start, end - start, output, false));
    return real.probeClip(output);
  } };
});
let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "clip-integration-"));
  testState.source = path.join(directory, "source.mp4");
  process.env.MEDIA_TEMP_DIR = path.join(directory, "jobs");
  process.env.FILE_TTL_SECONDS = "2";
  process.env.MAX_CONCURRENT_JOBS = "1";
  const { config } = await import("../src/lib/server/config");
  Object.assign(config, { tempDir: process.env.MEDIA_TEMP_DIR, fileTtlSeconds: 2, maxConcurrentJobs: 1 });
  await runProcess(ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25:duration=8", "-f", "lavfi", "-i", "sine=frequency=440:duration=8", "-c:v", "libx264", "-c:a", "aac", "-shortest", testState.source]);
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

describe("real FFmpeg and job lifecycle", () => {
  it("seeks separate inputs and restricts network protocols", () => {
    const args = clippingArgs({ videoUrl: "https://rr1.googlevideo.com/v", audioUrl: "https://rr1.googlevideo.com/a" }, 1500, 70, "out.mp4");
    expect(args.filter(value => value === "-ss")).toHaveLength(2);
    expect(args).toContain("https,tls,tcp,crypto");
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
    expect(() => clippingArgs({ videoUrl: "http://localhost/internal" }, 0, 5, "out.mp4")).toThrow();
  });
  it("creates a real MP4, serves a download, expires and removes the file", async () => {
    const { createJob, getJob, cleanup } = await import("../src/lib/server/jobs");
    const { GET } = await import("../src/app/api/jobs/[id]/download/route");
    const input = { videoId: "jNQXAC9IVRw", startTime: 2, endTime: 5, quality: "240p", format: "mp4" as const };
    const job = createJob(input);
    expect(() => createJob(input)).toThrow("busy");
    let current = await getJob(job.jobId);
    for (let i = 0; i < 100 && ["queued", "processing"].includes(current.view.status); i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      current = await getJob(job.jobId);
    }
    expect(current.view.status, current.view.error).toBe("completed");
    const output = await probeClip(current.output);
    expect(output.duration).toBeCloseTo(3, 0);
    expect(output.quality).toBe("240p");
    const response = await GET(new Request("http://localhost/api/download"), { params: Promise.resolve({ id: job.jobId }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("content-disposition")).toContain("Test-Clip-2-5.mp4");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(await readFile(current.output));
    await new Promise(resolve => setTimeout(resolve, 2100));
    expect((await getJob(job.jobId)).view.status).toBe("expired");
    expect((await GET(new Request("http://localhost/api/download"), { params: Promise.resolve({ id: job.jobId }) })).status).toBe(410);
    await cleanup();
    await expect(stat(current.output)).rejects.toThrow();
  });
  it("surfaces a safe private video error and releases capacity", async () => {
    testState.fail = true;
    const { createJob, getJob } = await import("../src/lib/server/jobs");
    const job = createJob({ videoId: "jNQXAC9IVRw", startTime: 0, endTime: 3, quality: "240p", format: "mp4" });
    await new Promise(resolve => setTimeout(resolve, 100));
    expect((await getJob(job.jobId)).view).toMatchObject({ status: "failed", error: "This video is private." });
    await expect(getJob("../../etc/passwd")).rejects.toThrow("not found");
  });
});
