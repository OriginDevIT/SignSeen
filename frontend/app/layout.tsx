import type { Metadata } from "next";
import SupportChat from "../components/SupportChat";

export const metadata: Metadata = {
  title: "SignSeen — Signed. Seen. Sealed.",
  description:
    "Open-source electronic signature with a photographic witness.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
        {children}
        {/* Discreet attribution (#48): the link's TEXT is transparent —
            matching any background — until hovered, fading in/out over
            0.5s via a color transition on the link itself (no hidden
            container), so it stays clickable while invisible. */}
        <style>{`
          .odit-attribution {
            color: transparent;
            transition: color 0.5s ease;
            text-decoration: none;
            font-size: 0.85rem;
          }
          .odit-attribution:hover,
          .odit-attribution:focus-visible {
            color: #6b7280;
          }
        `}</style>
        <footer style={{ textAlign: "center", padding: "1.5rem 1rem 2rem" }}>
          <a
            className="odit-attribution"
            href="https://origindev.com"
            target="_blank"
            rel="noreferrer"
          >
            GetSignSeen.com is an Origin Development
          </a>
        </footer>
        <SupportChat />
      </body>
    </html>
  );
}
