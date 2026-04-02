import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppProviders } from "@/components/app-providers";
import { Nav } from "@/components/nav";
import { KeyboardShortcutsHandler } from "@/components/keyboard-shortcuts-handler";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Telemetry Operations Platform",
  description: "Search and explore spacecraft telemetry with semantic search and LLM explanations",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} flex min-h-screen flex-col antialiased`}
      >
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var m=localStorage.getItem("operator_mode");if(m==="high-contrast"||m==="large-type")document.body.setAttribute("data-operator-mode",m);})();`,
          }}
        />
        <a href="#main-content" className="sr-only">
          Skip to main content
        </a>
        <AppProviders>
          <TooltipProvider>
            <Nav />
            <KeyboardShortcutsHandler />
            <main id="main-content" tabIndex={-1} className="min-h-0 flex-1">
              {children}
            </main>
          </TooltipProvider>
        </AppProviders>
      </body>
    </html>
  );
}
