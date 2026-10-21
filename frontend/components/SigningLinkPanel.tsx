"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";

/**
 * Copy-link + QR actions for a pending document's signing URL.
 * Shown on the dashboard card and the /d/<id> tracking page, and
 * only ever rendered when the API returned a signing_url — the
 * server includes that field for the document's owner only.
 */
export default function SigningLinkPanel({
  signingUrl,
}: {
  signingUrl: string;
}) {
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  const copyLink = async () => {
    await navigator.clipboard.writeText(signingUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const smallBtn: React.CSSProperties = {
    padding: "0.45rem 0.8rem",
    fontSize: "0.85rem",
    borderRadius: 8,
    border: "1px solid #d1d5db",
    background: "#fff",
    cursor: "pointer",
    color: "inherit",
  };

  return (
    <div style={{ marginTop: "0.75rem" }}>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={copyLink}
          style={{ ...smallBtn, fontWeight: 600 }}
        >
          {copied ? "Copied!" : "Copy signing link"}
        </button>
        <button type="button" onClick={() => setShowQr((v) => !v)} style={smallBtn}>
          {showQr ? "Hide QR code" : "Show QR code"}
        </button>
      </div>
      {showQr && (
        <div
          style={{
            marginTop: "0.75rem",
            display: "flex",
            gap: "1rem",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              display: "inline-block",
              background: "#fff",
              padding: 10,
              borderRadius: 8,
              border: "1px solid #e5e7eb",
            }}
          >
            <QRCodeSVG value={signingUrl} size={160} />
          </div>
          <code
            style={{
              flex: 1,
              minWidth: "12rem",
              overflowWrap: "anywhere",
              fontSize: "0.8rem",
              opacity: 0.75,
            }}
          >
            {signingUrl}
          </code>
        </div>
      )}
    </div>
  );
}
