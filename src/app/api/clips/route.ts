import { createJob, parseClipRequest } from "@/lib/server/jobs";
import { errorResponse, json, rateLimit, readBody } from "@/lib/server/http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    rateLimit(request);
    const input = parseClipRequest(await readBody(request));
    return json(createJob(input), 202);
  } catch (error) { return errorResponse(error); }
}
