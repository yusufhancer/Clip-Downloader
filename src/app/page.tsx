import { ClipTool } from "@/components/clip-tool";
import { publicLimits } from "@/lib/server/config";
import Link from "next/link";

export const dynamic = "force-dynamic";
export default function Home() {
  return <>
    <nav className="brand-bar" aria-label="Brand"><div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 sm:px-8"><Link className="brand" href="/" aria-label="Clip Downloader home"><svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true"><path d="M7 5H4v16h3M19 5h3v16h-3" stroke="currentColor" strokeWidth="2" /><path d="m10 8 8 5-8 5V8Z" fill="currentColor" /></svg>Clip Downloader</Link><span className="brand-note">A little less video.</span></div></nav>
    <ClipTool initialLimits={publicLimits} />
  </>;
}
