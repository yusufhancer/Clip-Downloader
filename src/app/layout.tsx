import type { Metadata } from "next";
import "./globals.css";

const site = process.env.NEXT_PUBLIC_SITE_URL;
export const metadata: Metadata = {
  title: "Clip Downloader — Download the part you need",
  description: "Preview a YouTube video, select start and end times, and download your selected segment as an MP4.",
  ...(site ? { metadataBase: new URL(site), alternates: { canonical: "/" } } : {}),
  openGraph: { title: "Clip Downloader", description: "Paste. Select. Download. Just the part you need.", type: "website" },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
