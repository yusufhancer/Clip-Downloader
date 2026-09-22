import { getJob } from "@/lib/server/jobs";
import { errorResponse, json, rateLimit } from "@/lib/server/http";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    rateLimit(request, "poll", 30);
    return json((await getJob((await context.params).id)).view);
  } catch (error) { return errorResponse(error); }
}
