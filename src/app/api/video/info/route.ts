import { mediaProvider } from "@/lib/server/media-provider";
import { AppError, mediaError } from "@/lib/server/errors";
import { errorResponse, json, rateLimit, readBody } from "@/lib/server/http";
import { publicLimits } from "@/lib/server/config";

export const runtime = "nodejs";
const shared = globalThis as typeof globalThis & { metadataActive?: number };
export async function POST(request: Request) {
  let reserved = false;
  try {
    rateLimit(request);
    const body = await readBody(request);
    if (typeof body.url !== "string" || body.url.length > 2048) throw new AppError("INVALID_URL", "Enter a valid YouTube URL.");
    if ((shared.metadataActive ?? 0) >= 4) throw new AppError("BUSY", "The server is currently busy. Please try again shortly.", 503);
    shared.metadataActive = (shared.metadataActive ?? 0) + 1;
    reserved = true;
    return json({ video: await mediaProvider.getMetadata(body.url), limits: publicLimits });
  } catch (error) { return errorResponse(mediaError(error)); }
  finally { if (reserved) shared.metadataActive = (shared.metadataActive ?? 1) - 1; }
}
