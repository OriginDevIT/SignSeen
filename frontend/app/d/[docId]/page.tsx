"use client";

import { use, useEffect, useState } from "react";
import HomeHeader from "../../../components/HomeHeader";
import SigningLinkPanel from "../../../components/SigningLinkPanel";
import {
  getDocument,
  mediaUrl,
  VERIFY_REASON_TEXT,
  verifyStoredDocument,
  type DocumentInfo,
  type VerifyVerdict,
} from "../../../lib/api";

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
  const [verdict, setVerdict] = useState<VerifyVerdict | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");

  useEffect(() => {
    getDocument(docId)
      .then(setDoc)
      .catch((err) => setError(err instanceof Error ? err.message : "Not found"));
  }, [docId]);

  async function handleVerify() {
    setVerifyError("");
    setVerdict(null);
    setVerifying(true);
    try {
      setVerdict(await verifyStoredDocument(docId));
    } catch (err) {
      setVerifyError(
        err instanceof Error ? err.message : "Verification failed"
      );
    } finally {
      setVerifying(false);
    }
  }

  if (error) {
    return (
      <main style={page}>
        <HomeHeader />
        <h1>Document not found</h1>
        <p style={{ opacity: 0.6 }}>{error}</p>
      </main>
    );
  }
  if (!doc) {
    return (
      <main style={page}>
        <HomeHeader />
        <p>Loading…</p>
      </main>
    );
  }

  const signedUrl = mediaUrl(doc.signed_file);

  return (
    <main style={page}>
      <HomeHeader />
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
        {doc.status === "pending" && doc.signing_url && (
          <SigningLinkPanel signingUrl={doc.signing_url} />
        )}
        {doc.status === "signed" && signedUrl && (
          <>
            <div
              style={{
                display: "flex",
                gap: "0.75rem",
                flexWrap: "wrap",
                marginTop: "1.25rem",
              }}
            >
              <a href={signedUrl} download style={button}>
                Download signed PDF
              </a>
              <button
                type="button"
                onClick={handleVerify}
                disabled={verifying}
                style={{
                  ...button,
                  background: "#fff",
                  color: "#1f2937",
                  border: "1px solid #d1d5db",
                }}
              >
                {verifying ? "Verifying…" : "Verify this document"}
              </button>
            </div>
            {verdict && verdict.valid && (
              <div
                style={{
                  marginTop: "1rem",
                  border: "1px solid #16a34a",
                  background: "#f0fdf4",
                  borderRadius: "0.5rem",
                  padding: "0.75rem 1rem",
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  Valid - this is a genuine document sealed by SignSeen.
                </div>
                <div style={{ fontSize: "0.9rem", opacity: 0.8 }}>
                  Signed{" "}
                  {verdict.signed_at
                    ? new Date(verdict.signed_at).toLocaleString()
                    : ""}
                  {verdict.signer_count
                    ? ` · ${verdict.signer_count} signer${
                        verdict.signer_count === 1 ? "" : "s"
                      }`
                    : ""}
                </div>
              </div>
            )}
            {verdict && !verdict.valid && (
              <div
                style={{
                  marginTop: "1rem",
                  border: "1px solid #b91c1c",
                  background: "#fef2f2",
                  borderRadius: "0.5rem",
                  padding: "0.75rem 1rem",
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  Invalid - this file could not be verified as a document
                  sealed by SignSeen.
                </div>
                <div style={{ fontSize: "0.9rem" }}>
                  {verdict.reason
                    ? VERIFY_REASON_TEXT[verdict.reason]
                    : "This file could not be verified."}
                </div>
              </div>
            )}
            {verifyError && (
              <p role="alert" style={{ margin: "1rem 0 0" }}>
                {verifyError}
              </p>
            )}
          </>
        )}
      </div>
      {doc.sessions && doc.sessions.length > 0 && (
        <div style={card}>
          <div style={{ fontWeight: 600, marginBottom: "0.75rem" }}>Signers</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {doc.sessions.map((s) => (
              <div
                key={s.id}
                style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}
              >
                <span>
                  {s.order + 1}. {s.signer_name || s.signer_email || "Signer"}
                </span>
                <span style={{ opacity: 0.7 }}>
                  {s.status}
                  {s.status === "signed" && s.signed_at
                    ? ` - ${new Date(s.signed_at).toLocaleString()}`
                    : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <p
        style={{
          display: "flex",
          gap: "1rem",
          alignItems: "center",
          flexWrap: "wrap",
          margin: 0,
        }}
      >
        <a href="/dashboard">View in dashboard</a>
        <a
          href="/send"
          style={{
            padding: "0.6rem 0.9rem",
            borderRadius: 8,
            border: "1px solid #d1d5db",
            background: "#fff",
            color: "inherit",
            textDecoration: "none",
          }}
        >
          Send another document
        </a>
      </p>
    </main>
  );
}
