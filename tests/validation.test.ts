import { describe, expect, it } from "vitest";
import { parseTimestamp, parseYouTubeUrl, validateTimes, formatTime } from "../src/lib/validation";
import { isSupportedMediaUrl } from "../src/lib/server/media-provider";
import { parseClipRequest } from "../src/lib/server/jobs";
import { readBody } from "../src/lib/server/http";

describe("YouTube URL allowlist", () => {
  it.each(["https://youtube.com/watch?v=jNQXAC9IVRw", "https://www.youtube.com/watch?v=jNQXAC9IVRw&t=3", "https://youtu.be/jNQXAC9IVRw", "https://m.youtube.com/shorts/jNQXAC9IVRw"]) ("accepts %s", url => expect(parseYouTubeUrl(url)).toBe("jNQXAC9IVRw"));
  it.each(["https://youtube.com.evil.test/watch?v=jNQXAC9IVRw", "https://youtube.com@127.0.0.1/watch?v=jNQXAC9IVRw", "http://localhost/watch?v=jNQXAC9IVRw", "https://192.168.1.1", "file:///etc/passwd", "https://youtube.com:1234/watch?v=jNQXAC9IVRw", "https://youtu.be/jNQXAC9IVRw/extra", "https://youtube.com/watch?v=bad", "https://youtu.be/$(whoami)"]) ("rejects %s", url => expect(parseYouTubeUrl(url)).toBeNull());
  it("only accepts HTTPS Google video media", () => {
    expect(isSupportedMediaUrl("https://rr1.googlevideo.com/videoplayback?foo=bar")).toBe(true);
    for (const value of ["http://rr1.googlevideo.com/a", "https://googlevideo.com.evil.test/a", "https://localhost/a", "https://user:pass@rr1.googlevideo.com/a"]) expect(isSupportedMediaUrl(value)).toBe(false);
  });
});
describe("timestamp validation", () => {
  it("converts the PRD example and supports hours", () => {
    expect(parseTimestamp("25:00")).toBe(1500);
    expect(parseTimestamp("26:10")).toBe(1570);
    expect(parseTimestamp("01:25:00")).toBe(5100);
    expect(formatTime(1570 - 1500)).toBe("01:10");
  });
  it.each(["-1:00", "1:60", "1:99:00", "NaN", "", "3", "0:0", "1:20.5"]) ("rejects malformed input %s", value => expect(parseTimestamp(value)).toBeNull());
  it("rejects invalid bounds, oversized clips, and non-finite values", () => {
    expect(validateTimes(1500, 1570, 1800, 300)).toBeNull();
    for (const [start, end] of [[0, 0], [-1, 20], [20, 10], [0, 1801], [0, 301], [NaN, 20], [0, Infinity]]) expect(validateTimes(start, end, 1800, 300)).toBeTruthy();
  });
  it("revalidates API inputs without type coercion", () => {
    const valid = { videoId: "jNQXAC9IVRw", startTime: 0, endTime: 5, quality: "720p", format: "mp4" };
    expect(parseClipRequest(valid)).toMatchObject(valid);
    for (const patch of [{ startTime: "0" }, { endTime: 0 }, { quality: "720p;whoami" }, { format: "mp3" }, { videoId: "../../oops" }]) expect(() => parseClipRequest({ ...valid, ...patch })).toThrow();
  });
});
describe("request boundaries", () => {
  it("accepts the browser host when Next normalizes its internal URL", async () => {
    const request = new Request("http://localhost:3000/api/clips", { method: "POST", headers: { "content-type": "application/json", "host": "127.0.0.1:3000", "origin": "http://127.0.0.1:3000" }, body: "{}" });
    await expect(readBody(request)).resolves.toEqual({});
  });
  it("rejects foreign origins and oversized or malformed JSON", async () => {
    const request = (body: string, origin = "http://localhost") => new Request("http://localhost/api/clips", { method: "POST", headers: { "content-type": "application/json", origin }, body });
    await expect(readBody(request("{}", "https://evil.test"))).rejects.toThrow("not allowed");
    await expect(readBody(request("x".repeat(5000)))).rejects.toThrow("too large");
    await expect(readBody(request("{"))).rejects.toThrow("not valid JSON");
    await expect(readBody(request("[]"))).rejects.toThrow("not valid JSON");
    await expect(readBody(request('{"value":1}'))).resolves.toEqual({ value: 1 });
  });
});
