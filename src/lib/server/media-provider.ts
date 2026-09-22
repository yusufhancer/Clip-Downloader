import path from "node:path";
import type { VideoMetadata } from "../contracts";
import { canonicalUrl, parseYouTubeUrl } from "../validation";
import { config } from "./config";
import { AppError, mediaError } from "./errors";
import { runProcess } from "./process";

export interface MediaSource { videoUrl: string; audioUrl?: string; quality: string; metadata: VideoMetadata }
export interface MediaSourceProvider {
  getMetadata(url: string): Promise<VideoMetadata>;
  getMediaSource(videoId: string, quality: string): Promise<MediaSource>;
}
interface SourceFormat {
  url?: string; protocol?: string; height?: number; vcodec?: string; acodec?: string; tbr?: number;
}
interface SourceInfo {
  id: string; title?: string; duration?: number; channel?: string; uploader?: string;
  is_live?: boolean; live_status?: string; formats?: SourceFormat[];
}
export function isSupportedMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && url.hostname.endsWith(".googlevideo.com");
  } catch { return false; }
}
function formats(info: SourceInfo) {
  return (info.formats ?? []).filter(format => format.protocol === "https" && format.url && isSupportedMediaUrl(format.url));
}
function metadata(info: SourceInfo): VideoMetadata {
  if (info.is_live || info.live_status === "is_upcoming" || !info.duration || !Number.isFinite(info.duration)) {
    throw new AppError("UNSUPPORTED_VIDEO", "Live streams and videos without a fixed duration are not supported.", 422);
  }
  if (info.duration > config.maxVideoDuration) throw new AppError("VIDEO_TOO_LONG", "The video is longer than supported.", 422);
  const available = formats(info);
  const hasAudio = available.some(format => format.acodec && format.acodec !== "none");
  const qualities = [...new Set(available.filter(format => hasAudio && format.vcodec && format.vcodec !== "none" && format.height && format.height > 0).map(format => format.height!))].sort((a, b) => a - b).map(height => `${height}p`);
  if (!qualities.length) throw new AppError("UNSUPPORTED_MEDIA", "No downloadable video quality is available for this video.", 422);
  return { videoId: info.id, title: info.title || "YouTube video", duration: info.duration, channel: info.channel || info.uploader || "", thumbnail: `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg`, qualities };
}
class YtDlpProvider implements MediaSourceProvider {
  private async inspect(id: string): Promise<SourceInfo> {
    const executable = process.env.YT_DLP_PATH || path.resolve(".tools", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
    try {
      const json = await runProcess(executable, ["--ignore-config", "--no-playlist", "--skip-download", "--dump-single-json", "--no-warnings", "--socket-timeout", "20", "--retries", "1", "--js-runtimes", `node:${process.execPath}`, "--", canonicalUrl(id)], 60_000);
      const info = JSON.parse(json) as SourceInfo;
      if (info.id !== id) throw new AppError("SOURCE_MISMATCH", "The video source returned an unexpected result.", 502);
      return info;
    } catch (error) { throw mediaError(error); }
  }
  async getMetadata(url: string) {
    const id = parseYouTubeUrl(url);
    if (!id) throw new AppError("INVALID_URL", "Enter a valid YouTube watch, Shorts, or youtu.be URL.");
    return metadata(await this.inspect(id));
  }
  async getMediaSource(videoId: string, quality: string) {
    const info = await this.inspect(videoId);
    const meta = metadata(info);
    if (!meta.qualities.includes(quality)) throw new AppError("QUALITY_UNAVAILABLE", "That quality is no longer available. Load the video again and choose another quality.", 422);
    const available = formats(info);
    const video = available.filter(f => f.height === Number(quality.slice(0, -1)) && f.vcodec && f.vcodec !== "none").sort((a, b) => (b.tbr ?? 0) - (a.tbr ?? 0))[0];
    const audio = available.filter(f => f.acodec && f.acodec !== "none" && f.vcodec === "none").sort((a, b) => (b.tbr ?? 0) - (a.tbr ?? 0))[0];
    const combined = video?.acodec && video.acodec !== "none";
    if (!video?.url || (!combined && !audio?.url)) throw new AppError("QUALITY_UNAVAILABLE", "The selected video and audio could not be retrieved.", 422);
    return { videoUrl: video.url, audioUrl: combined ? undefined : audio!.url, quality, metadata: meta };
  }
}
export const mediaProvider: MediaSourceProvider = new YtDlpProvider();
