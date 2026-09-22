export interface VideoMetadata {
  videoId: string;
  title: string;
  thumbnail: string;
  duration: number;
  channel: string;
  qualities: string[];
}
export interface Limits { maxClipDuration: number; maxVideoDuration: number; fileTtlSeconds: number }
export interface ClipRequest { videoId: string; startTime: number; endTime: number; quality: string; format: "mp4" }
export interface ClipJob {
  jobId: string;
  status: "queued" | "processing" | "completed" | "failed" | "expired";
  stage: string;
  error?: string;
  downloadUrl?: string;
  filename?: string;
  duration?: number;
  quality?: string;
  fileSize?: number;
  expiresAt?: string;
}
