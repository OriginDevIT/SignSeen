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
        <SupportChat />
      </body>
    </html>
  );
}
