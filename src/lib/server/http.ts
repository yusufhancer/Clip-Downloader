import { createHash } from "node:crypto";
import { AppError } from "./errors";
import { config } from "./config";

const globalState = globalThis as typeof globalThis & { clipRates?: Map<string, { count: number; until: number }> };
const rates = globalState.clipRates ??= new Map();
export function rateLimit(request: Request, category = "work", multiplier = 1) {
  const now = Date.now();
  for (const [key, value] of rates) if (value.until <= now) rates.delete(key);
  // No client-supplied forwarding header is trusted unless explicitly configured.
  const ip = process.env.TRUST_PROXY === "true" ? (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "shared") : "shared";
  const key = category + createHash("sha256").update(ip).digest("hex");
  const entry = rates.get(key) ?? { count: 0, until: now + config.rateWindowSeconds * 1000 };
  if (entry.count >= config.rateLimit * multiplier) throw new AppError("RATE_LIMIT", "Too many requests. Please wait a minute and try again.", 429);
  if (rates.size > 10_000 && !rates.has(key)) throw new AppError("BUSY", "The server is currently busy. Please try again shortly.", 503);
  entry.count++;
  rates.set(key, entry);
}
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const origin = request.headers.get("origin");
  // Next can normalize request.url to localhost even when the browser uses 127.0.0.1.
  // Use the actual HTTP Host header for the browser-facing authority.
  const requestUrl = new URL(request.url);
  const expectedOrigin = `${requestUrl.protocol}//${request.headers.get("host") || requestUrl.host}`;
  if (origin && origin !== expectedOrigin) throw new AppError("ORIGIN", "This request is not allowed.", 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AppError("CONTENT_TYPE", "Send a JSON request.", 415);
  if (Number(request.headers.get("content-length")) > 4096) throw new AppError("REQUEST_SIZE", "The request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("INVALID_BODY", "The request is empty.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4096) { await reader.cancel(); throw new AppError("REQUEST_SIZE", "The request is too large.", 413); }
      chunks.push(value);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("INVALID_BODY", "The request is not valid JSON.");
  } finally { reader.releaseLock(); }
}
export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}
export function errorResponse(error: unknown) {
  const safe = error instanceof AppError ? error : new AppError("INTERNAL", "Something went wrong. Please try again.", 500);
  return Response.json({ error: safe.message, code: safe.code }, { status: safe.status, headers: { "Cache-Control": "no-store", ...(safe.status === 429 ? { "Retry-After": String(config.rateWindowSeconds) } : {}) } });
}
