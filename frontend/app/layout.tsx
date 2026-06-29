import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Observability Platform",
  description:
    "Observability over TokenHelm / tokenhelm-prompt events: cost, prompt, agent, workflow, and session analytics derived from immutable ObservationEvents.",
};

/**
 * Shared dashboard shell + cross-page nav. Later phases light up the prompt/agent/
 * workflow/session/model/recommendation/alert pages; in the MVP only Overview is
 * implemented (the others are placeholders linked here for orientation).
 */
// `ready` items are live links; others are placeholders for later phases and render
// as muted, non-clickable labels so the MVP nav has no broken links.
const NAV = [
  { href: "/", label: "Overview", ready: true },
  { href: "/prompts", label: "Prompts", ready: true },
  { href: "/agents", label: "Agents", ready: true },
  { href: "/workflows", label: "Workflows", ready: true },
  { href: "/sessions", label: "Sessions", ready: true },
  { href: "/models", label: "Models", ready: true },
  { href: "/recommendations", label: "Recommendations", ready: true },
  { href: "/alerts", label: "Alerts", ready: true },
];

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100">
        <header className="border-b border-slate-800 bg-slate-900/60">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
            <span className="text-sm font-semibold text-slate-100">AI Observability</span>
            <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-400">
              {NAV.map((item) =>
                item.ready ? (
                  <Link key={item.href} href={item.href} className="hover:text-slate-100">
                    {item.label}
                  </Link>
                ) : (
                  <span
                    key={item.href}
                    title="Coming in a later phase"
                    className="cursor-not-allowed text-slate-600"
                  >
                    {item.label}
                  </span>
                ),
              )}
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
