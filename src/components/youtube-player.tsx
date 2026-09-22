"use client";

import { useEffect, useRef, useState } from "react";
export interface PlayerHandle { getCurrentTime(): number; destroy(): void }
interface PlayerApi { Player: new (element: HTMLElement, options: { videoId: string; width: string; height: string; playerVars: Record<string, string | number>; events: { onReady(event: { target: PlayerHandle }): void; onError(): void } }) => PlayerHandle }
declare global { interface Window { YT?: PlayerApi; onYouTubeIframeAPIReady?: () => void } }
let apiPromise: Promise<PlayerApi> | undefined;
function loadApi(): Promise<PlayerApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise<PlayerApi>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Player timed out")), 20_000);
      window.onYouTubeIframeAPIReady = () => { clearTimeout(timer); resolve(window.YT!); };
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => { clearTimeout(timer); reject(new Error("Player unavailable")); };
      document.head.appendChild(script);
    }).catch(error => { apiPromise = undefined; throw error; });
  }
  return apiPromise;
}
export function YouTubePlayer({ videoId, onReady }: { videoId: string; onReady: (player: PlayerHandle | null) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let disposed = false;
    let player: PlayerHandle | undefined;
    onReady(null);
    loadApi().then(api => {
      if (disposed || !container.current) return;
      const mount = document.createElement("div");
      container.current.replaceChildren(mount);
      player = new api.Player(mount, {
        videoId, width: "100%", height: "100%",
        playerVars: { origin: window.location.origin, playsinline: 1, rel: 0 },
        events: {
          onReady: event => { if (!disposed) { onReady(event.target); const iframe = container.current?.querySelector("iframe"); if (iframe) iframe.title = "YouTube video preview"; } },
          onError: () => { if (!disposed) { setError(true); onReady(null); } },
        },
      });
    }).catch(() => { if (!disposed) setError(true); });
    return () => { disposed = true; onReady(null); player?.destroy(); };
  }, [videoId, onReady]);
  return <>
    <div className="player-frame" ref={container} aria-label="YouTube video preview">
      <p className="player-placeholder">{error ? "Preview unavailable" : "Loading video preview…"}</p>
    </div>
    {error && <p className="inline-note" role="status">YouTube preview is unavailable. You can still enter start and end times manually.</p>}
  </>;
}
