import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { getJob } from "@/lib/server/jobs";
import { errorResponse, rateLimit } from "@/lib/server/http";
import { AppError } from "@/lib/server/errors";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    rateLimit(request, "download", 3);
    const job = await getJob((await context.params).id);
    if (job.view.status === "expired") throw new AppError("EXPIRED", "This clip has expired. Please create it again.", 410);
    if (job.view.status !== "completed") throw new AppError("NOT_READY", "The clip is not ready to download.", 409);
    const info = await stat(job.output).catch(() => { throw new AppError("EXPIRED", "This clip is no longer available. Please create it again.", 410); });
    const stream = Readable.toWeb(createReadStream(job.output)) as ReadableStream<Uint8Array>;
    return new Response(stream, { headers: { "Content-Type": "video/mp4", "Content-Length": String(info.size), "Content-Disposition": `attachment; filename="${job.view.filename}"`, "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
