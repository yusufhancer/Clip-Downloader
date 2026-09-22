export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export function mediaError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const text = error instanceof Error ? error.message : "";
  if (/ENOENT/.test(text)) return new AppError("MEDIA_SETUP", "Media tools are not installed. The server needs its media setup completed.", 503);
  if (/private video/i.test(text)) return new AppError("PRIVATE_VIDEO", "This video is private.", 422);
  if (/not available|unavailable|removed|does not exist/i.test(text)) return new AppError("UNAVAILABLE", "This video is unavailable.", 422);
  if (/sign in|bot|403|429|challenge|PO Token/i.test(text)) return new AppError("SOURCE_BLOCKED", "YouTube is currently refusing access to this video. Please try again later or use another video.", 502);
  if (/timed out|timeout|ENOTFOUND|ECONN|network|resolve/i.test(text)) return new AppError("SOURCE_NETWORK", "Could not reach the video source. Please try again.", 502);
  return new AppError("MEDIA_FAILURE", "The video could not be processed. Please try another video or try again later.", 502);
}
