import path from "node:path";
function positiveInt(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid server configuration: ${name}`);
  return value;
}
export const config = {
  maxClipDuration: positiveInt("MAX_CLIP_DURATION", 300),
  maxVideoDuration: positiveInt("MAX_VIDEO_DURATION", 14400),
  maxConcurrentJobs: positiveInt("MAX_CONCURRENT_JOBS", 2),
  fileTtlSeconds: positiveInt("FILE_TTL_SECONDS", 3600),
  rateLimit: positiveInt("RATE_LIMIT", 20),
  rateWindowSeconds: positiveInt("RATE_WINDOW_SECONDS", 60),
  // Generated media is runtime data, never a build/deployment input.
  tempDir: path.resolve(/* turbopackIgnore: true */ process.env.MEDIA_TEMP_DIR ?? ".clips"),
};
export const publicLimits = {
  maxClipDuration: config.maxClipDuration,
  maxVideoDuration: config.maxVideoDuration,
  fileTtlSeconds: config.fileTtlSeconds,
};
