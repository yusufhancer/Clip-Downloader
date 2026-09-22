const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;
export function validVideoId(value: unknown): value is string {
  return typeof value === "string" && VIDEO_ID.test(value);
}
export function parseYouTubeUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    let id: string | null = null;
    if (host === "youtu.be") {
      if (/^\/[\w-]{11}\/?$/.test(url.pathname)) id = url.pathname.split("/")[1];
    } else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)) {
      if (url.pathname === "/watch") id = url.searchParams.get("v");
      else if (/^\/shorts\/[\w-]{11}\/?$/.test(url.pathname)) id = url.pathname.split("/")[2];
    }
    return validVideoId(id) ? id : null;
  } catch { return null; }
}
export function canonicalUrl(id: string): string {
  if (!validVideoId(id)) throw new Error("Invalid video ID.");
  return `https://www.youtube.com/watch?v=${id}`;
}
export function parseTimestamp(value: string): number | null {
  const input = value.trim();
  if (!/^\d{1,3}:\d{2}(?::\d{2})?$/.test(input)) return null;
  const parts = input.split(":").map(Number);
  if (parts.at(-1)! >= 60 || (parts.length === 3 && parts[1] >= 60)) return null;
  return parts.reduce((sum, part) => sum * 60 + part, 0);
}
export function formatTime(value: number): string {
  const total = Math.max(0, Math.floor(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [ ...(hours ? [String(hours).padStart(2, "0")] : []), String(minutes).padStart(2, "0"), String(seconds).padStart(2, "0") ].join(":");
}
export function validateTimes(start: number | null, end: number | null, duration: number, maxClip: number): string | null {
  if (start === null || end === null || !Number.isFinite(start) || !Number.isFinite(end)) return "Use MM:SS or HH:MM:SS for both times.";
  if (start < 0) return "Start time cannot be negative.";
  if (end <= start) return "End time must be greater than start time.";
  if (end > duration) return "Selected time exceeds the video duration.";
  if (end - start > maxClip) return `Selected clip is too long. Maximum: ${formatTime(maxClip)}.`;
  return null;
}
