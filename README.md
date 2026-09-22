---
title: YouTube Clip Downloader
emoji: 🎬
colorFrom: red
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# Clip Downloader

A one-page YouTube clip tool built with Next.js, TypeScript, Tailwind CSS, yt-dlp, and FFmpeg. No accounts, database, Redis, or external queue.

## Run locally

Requires Node.js 22 or newer (tested with Node 24), internet access, and a persistent Node process.

```sh
npm install
npm run setup:media
npm run dev
```

Open http://localhost:3000. The setup script installs the official yt-dlp executable in `.tools/` and verifies its published SHA-256 checksum. FFmpeg and FFprobe are supplied by npm dependencies. Override `YT_DLP_PATH`, `FFMPEG_PATH`, and `FFPROBE_PATH` to use system tools instead. Rerun `setup:media` to update yt-dlp when YouTube changes.

For production locally:

```sh
npm run build
npm start
```

Use one persistent Node instance with a writable `.clips/` directory. This MVP is not suitable for short-lived serverless functions or multiple server instances: jobs are held in memory and cannot survive a process restart. The UI uses job IDs and polling, so a durable queue/store can replace this layer later without changing the UI contract.

## Workflow

Paste a YouTube watch, youtu.be, or Shorts URL, load metadata, use the embedded preview, and choose start/end timestamps and a quality. Set Start/End reads the current player position. Download Clip starts an asynchronous job. When it completes, Download MP4 saves the generated file. Create another clip keeps the video loaded.

The media provider (`src/lib/server/media-provider.ts`) is the only component tied to yt-dlp. It resolves supported HTTPS Google video sources and advertises actual available resolutions. FFmpeg seeks before each input and encodes the requested duration into H.264/AAC MP4; it does not first save the full source video. Network transfer can include container headers and nearby keyframes, and source servers must support seeking. FFprobe verifies duration and streams before download is offered. The output shows the actual resulting resolution.

Only fixed-duration public videos with usable HTTPS video/audio formats are supported. Private, live, age-restricted, DRM-protected, or source-blocked videos may not be processable. Embedded playback can also be disabled by the uploader; manual timestamps remain usable. There is no restriction bypass or cookie import.

## Configuration

Copy `.env.example` to `.env.local` if needed. Defaults:

| Setting | Default |
| --- | --- |
| `MAX_CLIP_DURATION` | 300 seconds |
| `MAX_VIDEO_DURATION` | 14400 seconds |
| `MAX_CONCURRENT_JOBS` | 2 |
| `FILE_TTL_SECONDS` | 3600 seconds after completion |
| `RATE_LIMIT` | 20 metadata/create requests per window |
| `RATE_WINDOW_SECONDS` | 60 |
| `TRUST_PROXY` | false |
| `MEDIA_TEMP_DIR` | `.clips` |

Limits originate on the backend and are sent to the UI. Polls and downloads have separate, higher request allowances. Without a trusted proxy, rate limiting is shared by all visitors; only set `TRUST_PROXY=true` behind a proxy that overwrites `X-Forwarded-For`. Temporary hashed rate-limit keys expire after the window. No viewing history or account data is stored.

Files expire after the configured lifetime. Cleanup runs at startup and every minute while the server is running. Only UUID directories owned by the application are removed. Stopped servers cannot run cleanup; expired leftovers are removed on the next startup. Download URLs use unguessable job IDs: anyone possessing that URL can download it until expiration. Job state is lost on restart.

Set `NEXT_PUBLIC_SITE_URL` to the public origin for canonical SEO metadata. Keep the browser and API on the same origin. Run behind HTTPS in deployment. Each FFmpeg process is limited to two encoding threads and a 15-minute execution timeout.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Unit/integration tests cover URL allowlisting, timestamps, request boundaries, actual FFmpeg encoding, download bytes, capacity, and expiration. The FFmpeg integration test uses a generated local source through a test-only mocked provider; production never accepts local input URLs. Browser tests use controlled YouTube/API responses to verify desktop/mobile UI, player timestamp controls, validation, and a downloadable result. These tests do not prove current access to YouTube; live verification must be performed separately.

The timeline is a visual selection indicator, not a draggable range selector. MP3, accounts, history, batch clips, permanent storage, and advanced queues are intentionally outside this first MVP.

### Live checks

With the server running and a video you have permission to process:

```sh
node scripts/live-smoke.mjs "https://www.youtube.com/watch?v=VIDEO_ID"
node scripts/live-browser.mjs "https://www.youtube.com/watch?v=VIDEO_ID"
```

These scripts use real API requests, not mocks. They save verification artifacts to ignored `test-results/`. The browser script additionally checks the live embed, downloads through the UI, takes desktop/mobile screenshots, and checks for JavaScript errors and horizontal overflow. The environment must allow both the Node server and Chromium to access YouTube.

Verified on 2026-09-22 with a public 19-second sample: the 00:02–00:08 selection produced a downloadable 6.000-second MP4, 320×240 H.264 video with AAC audio. The live player initialized, Set Start read its initial position, and the browser saved the generated file without page errors. Nonzero Set Start/End values are also covered by controlled browser tests. This is a successful sample test, not a guarantee that every YouTube video or network will allow access.

## Upstream references

- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
- [yt-dlp documentation](https://github.com/yt-dlp/yt-dlp)
- [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference)
