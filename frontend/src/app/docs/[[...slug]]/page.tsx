import { notFound } from "next/navigation";
import path from "path";
import fs from "fs";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";

const CONTENT_DIR = path.join(process.cwd(), "content", "user-guide");

const DOC_PAGES = [
  { slug: [], file: "index.md", title: "Introduction" },
  { slug: ["quick-start"], file: "quick-start.md", title: "Quick Start" },
  { slug: ["connecting-streams"], file: "connecting-streams.md", title: "Connecting a Telemetry Stream" },
  { slug: ["monitoring-overview"], file: "monitoring-overview.md", title: "Monitoring the Overview" },
  { slug: ["investigating-channels"], file: "investigating-channels.md", title: "Investigating a Channel" },
  { slug: ["handling-alerts"], file: "handling-alerts.md", title: "Handling Alerts" },
  { slug: ["multi-source"], file: "multi-source.md", title: "Multi-Source Operations" },
  { slug: ["reference"], file: "reference.md", title: "Reference" },
] as const;

function getPageForSlug(slug: string[] | undefined) {
  const key = slug?.join("/") ?? "";
  return DOC_PAGES.find((p) => p.slug.join("/") === key);
}

export default async function DocsPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const page = getPageForSlug(slug);

  if (!page) {
    notFound();
  }

  const filePath = path.join(CONTENT_DIR, page.file);
  let content: string;

  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    notFound();
  }

  return (
    <div className="flex min-h-0 gap-12 px-4 py-8 sm:px-6">
      <aside className="sticky top-16 shrink-0 self-start">
        <nav
          className="flex flex-col gap-1 text-sm text-muted-foreground"
          aria-label="Documentation"
        >
          {DOC_PAGES.map((p) => {
            const href = p.slug.length === 0 ? "/docs" : `/docs/${p.slug.join("/")}`;
            const isActive =
              (slug?.length ?? 0) === p.slug.length &&
              (slug ?? []).every((s, i) => p.slug[i] === s);
            return (
              <Link
                key={href}
                href={href}
                className={
                  "block rounded-md px-3 py-2 -ml-3 transition-colors " +
                  (isActive
                    ? "bg-muted text-foreground font-medium"
                    : "hover:bg-muted/50 hover:text-foreground")
                }
              >
                {p.title}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 justify-center">
        <article className="w-full max-w-3xl prose prose-invert prose-slate dark:prose-invert">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => (
              <h1 className="mb-6 text-2xl font-bold tracking-tight">{children}</h1>
            ),
            h2: ({ children }) => (
              <h2 className="mb-4 mt-8 text-xl font-semibold">{children}</h2>
            ),
            h3: ({ children }) => (
              <h3 className="mb-3 mt-6 text-lg font-medium">{children}</h3>
            ),
            p: ({ children }) => <p className="mb-4 leading-7">{children}</p>,
            ul: ({ children }) => (
              <ul className="mb-4 list-disc space-y-1 pl-6">{children}</ul>
            ),
            ol: ({ children }) => (
              <ol className="mb-4 list-decimal space-y-1 pl-6">{children}</ol>
            ),
            li: ({ children }) => <li className="leading-7">{children}</li>,
            code: ({ children, className }) =>
              className ? (
                <code
                  className={`rounded bg-muted px-1.5 py-0.5 font-mono text-sm ${className}`}
                >
                  {children}
                </code>
              ) : (
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">
                  {children}
                </code>
              ),
            pre: ({ children }) => (
              <pre className="mb-4 overflow-x-auto rounded-lg border border-border bg-muted/50 p-4 text-sm">
                {children}
              </pre>
            ),
            a: ({ href, children }) => {
              const h = href ?? "#";
              const isExternal = h.startsWith("http://") || h.startsWith("https://");
              return isExternal ? (
                <a
                  href={h}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-4 hover:no-underline"
                >
                  {children}
                </a>
              ) : (
                <Link
                  href={h}
                  className="text-primary underline underline-offset-4 hover:no-underline"
                >
                  {children}
                </Link>
              );
            },
            blockquote: ({ children }) => (
              <blockquote className="border-l-4 border-muted-foreground/50 pl-4 italic text-muted-foreground">
                {children}
              </blockquote>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
        </article>
      </div>
    </div>
  );
}
