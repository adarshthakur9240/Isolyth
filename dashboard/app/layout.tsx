import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Isolyth — MCP Tool Server Dashboard",
  description:
    "Real-time monitoring dashboard for the Isolyth sandboxed MCP tool server. View metrics, traces, auth status, and tool performance.",
  keywords: ["MCP", "monitoring", "WebAssembly", "tool server", "telemetry"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Google Fonts — loaded client-side to avoid build-time network fetch */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
