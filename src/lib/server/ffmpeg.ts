import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import type { MediaSource } from "./media-provider";
import { isSupportedMediaUrl } from "./media-provider";
import { runProcess } from "./process";
import { AppError } from "./errors";

export const ffmpegPath = () => process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";
export const ffprobePath = () => process.env.FFPROBE_PATH || ffprobeStatic.path;
export function clippingArgs(source: Pick<MediaSource, "videoUrl" | "audioUrl">, start: number, duration: number, output: string, remote = true): string[] {
  const inputs = [source.videoUrl, ...(source.audioUrl ? [source.audioUrl] : [])];
  if (remote && inputs.some(url => !isSupportedMediaUrl(url))) throw new AppError("UNSUPPORTED_SOURCE", "The video source is not supported.", 422);
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y"];
  for (const input of inputs) {
    if (remote) args.push("-protocol_whitelist", "https,tls,tcp,crypto", "-rw_timeout", "20000000");
    // Input seeking avoids decoding/downloading the entire preceding video.
    args.push("-ss", String(start), "-i", input);
  }
  args.push("-t", String(duration), "-map", "0:v:0", "-map", source.audioUrl ? "1:a:0" : "0:a:0", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:a", "aac", "-b:a", "128k", "-threads", "2", "-movflags", "+faststart", "-map_metadata", "-1", output);
  return args;
}
export async function encodeClip(source: MediaSource, start: number, end: number, output: string) {
  await runProcess(ffmpegPath(), clippingArgs(source, start, end - start, output), 15 * 60_000);
  return probeClip(output);
}
export async function probeClip(output: string) {
  const json = await runProcess(ffprobePath(), ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", output]);
  const data = JSON.parse(json) as { format?: { duration?: string }; streams?: { codec_type: string; height?: number }[] };
  const duration = Number(data.format?.duration);
  const height = data.streams?.find(stream => stream.codec_type === "video")?.height;
  if (!Number.isFinite(duration) || duration <= 0 || !height || !data.streams?.some(stream => stream.codec_type === "audio")) throw new AppError("INVALID_OUTPUT", "The generated clip was incomplete. Please try again.", 502);
  return { duration, quality: `${height}p` };
}
