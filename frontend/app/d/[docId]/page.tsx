"use client";

import { use, useEffect, useState } from "react";
import { getDocument, mediaUrl, type DocumentInfo } from "../../../lib/api";

const page: React.CSSProperties = {
  maxWidth: "40rem",
  margin: "0 auto",
  padding: "2rem 1rem",
  display: "flex",
  flexDirection: "column",
  gap: "1rem",
};

const card: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: "0.5rem",
  padding: "1.25rem",
};

const button: React.CSSProperties = {
  padding: "0.7rem 1.2rem",
  fontSize: "1rem",
  border: "none",
  borderRadius: "0.375rem",
  background: "#2563eb",
  color: "#fff",
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-block",
};

export default function TrackDocumentPage({
  params,
}: {
  params: Promise<{ docId: string }>;
}) {
  const { docId } = use(params);
  const [doc, setDoc] = useState<DocumentInfo | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getDocument(docId)
      .then(setDoc)
      .catch((err) => setError(err instanceof Error ? err.message : "Not found"));
  }, [docId]);

  if (error) {
    return (
      <main style={page}>
        <h1>Document not found</h1>
        <p style={{ opacity: 0.6 }}>{error}</p>
      </main>
    );
  }
  if (!doc) {
    return (
      <main style={page}>
        <p>Loading…</p>
      </main>
    );
  }

  const signedUrl = mediaUrl(doc.signed_file);

  return (
    <main style={page}>
      <h1 style={{ margin: 0 }}>{doc.title}</h1>
      <div style={card}>
        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: "0.8rem", opacity: 0.6 }}>Status</div>
            <div style={{ fontWeight: 600 }}>{doc.status}</div>
          </div>
          <div>
            <div style={{ fontSize: "0.8rem", opacity: 0.6 }}>Sent by</div>
            <div>{doc.sender_email}</div>
          </div>
          <div>
            <div style={{ fontSize: "0.8rem", opacity: 0.6 }}>Created</div>
            <div>{new Date(doc.created_at).toLocaleString()}</div>
          </div>
        </div>
        {doc.status === "signed" && signedUrl && (
          <a href={signedUrl} style={{ ...button, marginTop: "1.25rem" }}>
            Download signed PDF
          </a>
        )}
      </div>
    </main>
  );
}
