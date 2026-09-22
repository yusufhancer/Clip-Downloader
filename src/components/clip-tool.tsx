"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipJob, Limits, VideoMetadata } from "@/lib/contracts";
import { formatTime, parseTimestamp, parseYouTubeUrl, validateTimes } from "@/lib/validation";
import { YouTubePlayer, type PlayerHandle } from "./youtube-player";

async function requestJson<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(75_000)]) : AbortSignal.timeout(75_000), cache: "no-store" });
  } catch { throw new Error("Could not connect to the server. Check your connection and try again."); }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "The request failed. Please try again.");
  if (!data) throw new Error("The server returned an unreadable response. Please try again.");
  return data as T;
}
function DownloadIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4" /></svg>;
}
export function ClipTool({ initialLimits }: { initialLimits: Limits }) {
  const [url, setUrl] = useState("");
  const [video, setVideo] = useState<VideoMetadata | null>(null);
  const [limits, setLimits] = useState(initialLimits);
  const [loading, setLoading] = useState(false);
  const [urlError, setUrlError] = useState("");
  const [actionError, setActionError] = useState("");
  const [start, setStart] = useState("00:00");
  const [end, setEnd] = useState("00:00");
  const [quality, setQuality] = useState("");
  const [player, setPlayer] = useState<PlayerHandle | null>(null);
  const [job, setJob] = useState<ClipJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [pollError, setPollError] = useState("");
  const [retry, setRetry] = useState(0);
  const loadLock = useRef(false);
  const submitLock = useRef(false);
  const downloadLock = useRef(false);
  const selectionHeading = useRef<HTMLHeadingElement>(null);
  const onPlayerReady = useCallback((value: PlayerHandle | null) => setPlayer(value), []);
  const processing = job?.status === "processing" || job?.status === "queued";
  const jobId = job?.jobId;
  const busy = loading || submitting || processing;
  const startSeconds = parseTimestamp(start);
  const endSeconds = parseTimestamp(end);
  const timeError = video ? validateTimes(startSeconds, endSeconds, video.duration, limits.maxClipDuration) : null;
  const clipDuration = startSeconds !== null && endSeconds !== null && endSeconds > startSeconds ? endSeconds - startSeconds : 0;

  useEffect(() => {
    if (!processing || !jobId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    async function poll() {
      try {
        const result = await requestJson<ClipJob>(`/api/jobs/${jobId}`, undefined, controller.signal);
        if (stopped) return;
        setJob(result);
        setPollError("");
        if (result.status === "processing" || result.status === "queued") timer = setTimeout(poll, 2000);
      } catch (error) {
        if (!stopped) setPollError(`${(error as Error).message} Your clip may still be processing.`);
      }
    }
    timer = setTimeout(poll, 800);
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [jobId, processing, retry]);

  useEffect(() => {
    if (job?.status !== "completed" || !job.expiresAt) return;
    const timer = setTimeout(() => setJob(current => current ? { ...current, status: "expired", stage: "This clip has expired. Create it again to download." } : null), Math.max(0, new Date(job.expiresAt).getTime() - Date.now()));
    return () => clearTimeout(timer);
  }, [job?.status, job?.expiresAt]);

  async function loadVideo(event: React.FormEvent) {
    event.preventDefault();
    if (loadLock.current || busy) return;
    setUrlError("");
    if (!parseYouTubeUrl(url)) { setUrlError("Enter a valid YouTube watch, Shorts, or youtu.be URL."); return; }
    loadLock.current = true;
    setLoading(true);
    setVideo(null);
    setJob(null);
    setPlayer(null);
    setActionError("");
    try {
      const data = await requestJson<{ video: VideoMetadata; limits: Limits }>("/api/video/info", { url: url.trim() });
      setVideo(data.video);
      setLimits(data.limits);
      setQuality(data.video.qualities.includes("720p") ? "720p" : data.video.qualities.at(-1)!);
      setStart("00:00");
      setEnd(formatTime(Math.min(30, data.video.duration, data.limits.maxClipDuration)));
      setTimeout(() => selectionHeading.current?.focus(), 0);
    } catch (error) { setUrlError((error as Error).message); }
    finally { setLoading(false); loadLock.current = false; }
  }
  function setCurrent(which: "start" | "end") {
    if (!player || !video) return;
    const current = player.getCurrentTime();
    if (!Number.isFinite(current)) return;
    const time = formatTime(Math.min(video.duration, Math.max(0, current)));
    (which === "start" ? setStart : setEnd)(time);
    setJob(null);
    setActionError("");
  }
  async function processClip(event: React.FormEvent) {
    event.preventDefault();
    if (submitLock.current || busy || !video || timeError) return;
    submitLock.current = true;
    setSubmitting(true);
    setActionError("");
    setPollError("");
    setJob(null);
    try { setJob(await requestJson<ClipJob>("/api/clips", { videoId: video.videoId, startTime: startSeconds, endTime: endSeconds, quality, format: "mp4" })); }
    catch (error) { setActionError((error as Error).message); }
    finally { setSubmitting(false); submitLock.current = false; }
  }
  async function download() {
    if (!job?.downloadUrl || downloadLock.current) return;
    downloadLock.current = true;
    setDownloading(true);
    setActionError("");
    try {
      const response = await fetch(job.downloadUrl);
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "The download failed. Please try again.");
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = job.filename || "clip.mp4";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) { setActionError(error instanceof Error ? error.message : "Download failed. Check your connection and try again."); }
    finally { setDownloading(false); downloadLock.current = false; }
  }
  function resetClip() { setJob(null); setActionError(""); setPollError(""); selectionHeading.current?.focus(); }

  return <main className="tool-shell mx-auto w-full max-w-6xl px-5 sm:px-8">
    <header className="intro">
      <p className="eyebrow">YOUTUBE CLIP DOWNLOADER</p>
      <h1>Just the part you need.</h1>
      <p className="intro-copy">Choose a moment. Save it as an MP4.</p>
    </header>

    <form className="source-form" onSubmit={loadVideo} aria-busy={loading}>
      <label htmlFor="youtube-url">YouTube URL</label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input id="youtube-url" type="text" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={event => { setUrl(event.target.value); setUrlError(""); }} disabled={busy} aria-invalid={!!urlError} aria-describedby={urlError ? "url-error" : "url-hint"} className="min-w-0 flex-1" />
        <button className="button button-dark" type="submit" disabled={busy || !url.trim()}>{loading ? "Loading video…" : "Load video"}<span aria-hidden="true">→</span></button>
      </div>
      {urlError ? <p id="url-error" className="error-text" role="alert">{urlError}</p> : <p id="url-hint" className="field-hint">YouTube videos & Shorts · Clips up to {formatTime(limits.maxClipDuration)}</p>}
    </form>
    {loading && <div className="loading-area" role="status"><span className="status-dot" />Loading video information…</div>}

    {!video && !loading && <section className="empty-state" aria-label="Getting started">
      <div className="empty-timeline" aria-hidden="true"><span /><i /><b /><i /><span /></div>
      <h2>A whole video. One useful moment.</h2>
      <p>Paste a link above to preview your video and select a clip.</p>
      <ol className="flow-guide"><li><span>01</span> Load video</li><li><span>02</span> Select a segment</li><li><span>03</span> Download MP4</li></ol>
    </section>}

    {video && <div className="workspace grid gap-7 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,1fr)]">
      <section className="preview-section" aria-label="Video preview">
        <div className="section-label"><span>01 / SOURCE</span><span className="mono">{formatTime(video.duration)}</span></div>
        <YouTubePlayer key={video.videoId} videoId={video.videoId} onReady={onPlayerReady} />
        <div className="video-info">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={video.thumbnail} alt="Video thumbnail" width="72" height="48" className="video-thumbnail" onError={event => { event.currentTarget.style.display = "none"; }} />
          <div className="min-w-0"><h2>{video.title}</h2><p>{video.channel || "YouTube"}<span aria-hidden="true"> · </span>{formatTime(video.duration)}</p></div>
        </div>
        <p className="preview-hint">Find your moment in the preview, then use Set Start and Set End.</p>
      </section>

      <section className="selection-section" aria-label="Clip settings">
        <div className="section-label"><span>02 / YOUR CLIP</span><span>MP4</span></div>
        <h2 className="selection-title" tabIndex={-1} ref={selectionHeading}>Select your segment</h2>
        <form onSubmit={processClip}>
          <fieldset disabled={busy || downloading}>
            <legend className="sr-only">Clip times and quality</legend>
            <div className="grid grid-cols-2 gap-4">
              <div><label htmlFor="start-time">Start</label><input className="timestamp" id="start-time" value={start} onChange={e => { setStart(e.target.value); setJob(null); }} spellCheck={false} autoComplete="off" aria-invalid={!!timeError} aria-describedby="time-help time-error" /><button className="text-button" type="button" disabled={!player || busy} onClick={() => setCurrent("start")}><span aria-hidden="true">[</span> Set Start</button></div>
              <div><label htmlFor="end-time">End</label><input className="timestamp" id="end-time" value={end} onChange={e => { setEnd(e.target.value); setJob(null); }} spellCheck={false} autoComplete="off" aria-invalid={!!timeError} aria-describedby="time-help time-error" /><button className="text-button" type="button" disabled={!player || busy} onClick={() => setCurrent("end")}><span aria-hidden="true">]</span> Set End</button></div>
            </div>
            <p className="field-hint" id="time-help">MM:SS or HH:MM:SS · Set buttons use the player position.</p>
            <p className="error-text" id="time-error" aria-live="polite">{timeError}</p>
            <div className="segment-track" aria-hidden="true"><span style={{ left: `${Math.min(100, Math.max(0, (startSeconds ?? 0) / video.duration * 100))}%`, width: `${timeError ? 0 : clipDuration / video.duration * 100}%` }} /></div>
            <div className="duration-row"><span>Clip duration</span><output className="mono" aria-live="polite">{timeError ? "—" : formatTime(clipDuration)}</output></div>
            <div className="quality-row"><div><label htmlFor="quality">Video quality</label><p className="field-hint">Original resolution · MP4</p></div><select id="quality" value={quality} onChange={e => { setQuality(e.target.value); setJob(null); }}>{video.qualities.map(item => <option key={item} value={item}>{item}</option>)}</select></div>
          </fieldset>
          {job?.status !== "completed" && <button className="button button-primary w-full" type="submit" disabled={busy || !!timeError || !quality}><DownloadIcon />{submitting ? "Starting…" : processing ? "Processing clip…" : "Download Clip"}</button>}
        </form>

        <div aria-live="polite" aria-atomic="true">
          {processing && <div className="job-status"><span className="status-dot" /><div><strong>{job.stage}</strong><p>Keep this page open. Your download will appear here.</p></div></div>}
          {job?.status === "failed" && <p className="error-text" role="alert">{job.error}</p>}
          {job?.status === "expired" && <p className="error-text">{job.stage}</p>}
        </div>
        {pollError && <div className="error-text" role="alert">{pollError}<button type="button" className="text-button" onClick={() => { setPollError(""); setRetry(x => x + 1); }}>Check status again</button></div>}
        {job?.status === "completed" && <section className="result" aria-label="Download result">
          <h3><span aria-hidden="true">✓</span> Your clip is ready.</h3>
          <p className="result-filename">{job.filename}</p>
          <p className="result-details">{formatTime(job.duration ?? 0)} <span>·</span> {job.quality} <span>·</span> {((job.fileSize ?? 0) / 1024 / 1024).toFixed(1)} MB</p>
          <button className="button button-primary w-full" onClick={download} disabled={downloading}><DownloadIcon />{downloading ? "Downloading…" : "Download MP4"}</button>
          <p className="field-hint">Available until {new Date(job.expiresAt!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Files are deleted automatically.</p>
          <button className="text-button" onClick={resetClip} disabled={downloading}>Create another clip <span aria-hidden="true">↗</span></button>
        </section>}
        {actionError && <p className="error-text" role="alert">{actionError}</p>}
        <p className="usage-note">Only download content you have permission or the legal right to use.</p>
      </section>
    </div>}
    <footer className="tool-footer"><span>Paste. Select. Download.</span><span>Temporary files. No account needed.</span></footer>
  </main>;
}
