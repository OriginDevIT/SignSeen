import type { ReactNode } from "react";

/**
 * Shared shell for the legal pages (/terms, /privacy). Content is
 * drafted in-house (issue #37) and is pending attorney review before
 * public launch — the drafts double as the review copy.
 */
export default function LegalDoc({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <main
      style={{
        maxWidth: "44rem",
        margin: "0 auto",
        padding: "2.5rem 1.25rem 4rem",
        lineHeight: 1.65,
        color: "#111827",
      }}
    >
      <style>{`
        .legal h2 { font-size: 1.15rem; margin: 2rem 0 0.5rem; }
        .legal p, .legal li { font-size: 0.98rem; }
        .legal ul { padding-left: 1.25rem; }
        .legal li { margin: 0.3rem 0; }
      `}</style>
      <p style={{ margin: 0 }}>
        <a href="/" style={{ color: "#2563eb", textDecoration: "none" }}>
          ← SignSeen
        </a>
      </p>
      <h1 style={{ fontSize: "2rem", margin: "1rem 0 0.25rem" }}>{title}</h1>
      <p style={{ opacity: 0.6, margin: "0 0 1.5rem" }}>
        Last updated: {updated}
      </p>
      <div className="legal">{children}</div>
      <p
        style={{
          marginTop: "3rem",
          paddingTop: "1rem",
          borderTop: "1px solid #e5e7eb",
          fontSize: "0.9rem",
          opacity: 0.7,
        }}
      >
        <a href="/terms">Terms of Service</a> · <a href="/privacy">Privacy Policy</a>
      </p>
    </main>
  );
}
