import type { Metadata } from "next";
import "./globals.css";
import { hotel } from "@/config/hotel";

export const metadata: Metadata = {
  title: { default: hotel.name, template: "%s | " + hotel.shortName },
  description: "Hotel stays, dining and events on Gayaza-Kla Road.",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-icon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
