"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  ApiError,
  createDocumentFromUrl,
  createSession,
  getAuthToken,
  myAccount,
  uploadDocument,
  type SessionInfo,
} from "../../lib/api";

type Phase = "form" | "working" | "done";
type Intake = "file" | "url";

export default function SendPage() {
  const [phase, setPhase] = useState<Phase>("form");
  const [intake, setIntake] = useState<Intake>("file");
  const [title, setTitle] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [signerName, setSignerName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pageUrl, setPageUrl] = useState("");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);

  // Logged-in senders: prefill their email and attach documents to the
  // account (the API does this from the token automatically).
  useEffect(() => {
    if (!getAuthToken()) return;
    myAccount()
      .then((account) => {
        setAccountEmail(account.email);
        setSenderEmail(account.email);
      })
      .catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (intake === "file" && !file) return;
    setError("");
    setPhase("working");
    try {
      const doc =
        intake === "file"
          ? await uploadDocument(file!, title.trim(), senderEmail.trim())
          : await createDocumentFromUrl(
              pageUrl.trim(),
              title.trim(),
              senderEmail.trim()
            );
      const sess = await createSession(doc.id, signerName.trim(), "");
      setSession(sess);
      setPhase("done");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
      setPhase("form");
    }
  };

  const copyLink = async () => {
    if (!session) return;
    await navigator.clipboard.writeText(session.signing_url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "0.65rem 0.8rem",
    border: "1px solid #d1d5db",
    borderRadius: 8,
    fontSize: "1rem",
    boxSizing: "border-box",
  };

  return (
    <main
      style={{
        maxWidth: 640,
        margin: "0 auto",
        padding: "2rem 1.25rem",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: "1.75rem", marginBottom: "0.25rem" }}>
        Send a document for signature
      </h1>
      <p style={{ opacity: 0.65, marginTop: 0, marginBottom: "1.5rem" }}>
        Upload a PDF and get a signing link + QR code. The signer needs no
        account.
      </p>
      {accountEmail ? (
        <p style={{ fontSize: "0.9rem", opacity: 0.7, marginTop: "-1rem", marginBottom: "1.5rem" }}>
          Signed in as {accountEmail} — this document will appear in your{" "}
          <a href="/dashboard">dashboard</a>.
        </p>
      ) : (
        <p style={{ fontSize: "0.9rem", opacity: 0.7, marginTop: "-1rem", marginBottom: "1.5rem" }}>
          Sending without an account is fine.{" "}
          <a href="/login">Log in</a> if you want the document in your library.
        </p>
      )}

      {error && (
        <p
          style={{
            background: "#fef2f2",
            color: "#b91c1c",
            padding: "0.75rem 1rem",
            borderRadius: 8,
          }}
        >
          {error}
        </p>
      )}

      {phase !== "done" && (
        <form onSubmit={submit} style={{ display: "grid", gap: "1rem" }}>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {(["file", "url"] as Intake[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setIntake(mode)}
                style={{
                  flex: 1,
                  padding: "0.6rem",
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                  background: intake === mode ? "#111827" : "#fff",
                  color: intake === mode ? "#fff" : "inherit",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                {mode === "file" ? "Upload a file" : "From a web page"}
              </button>
            ))}
          </div>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            Document title
            <input
              style={inputStyle}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Contractor Agreement"
              required
            />
          </label>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            Your email <span style={{ opacity: 0.6 }}>(for the signed copy)</span>
            <input
              style={inputStyle}
              type="email"
              value={senderEmail}
              onChange={(e) => setSenderEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            Signer name <span style={{ opacity: 0.6 }}>(optional)</span>
            <input
              style={inputStyle}
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder="Jane Doe"
            />
          </label>
          {intake === "file" ? (
            <label style={{ display: "grid", gap: "0.35rem" }}>
              Document{" "}
              <span style={{ opacity: 0.6 }}>
                (PDF, DOC, DOCX — max 25 MB; Word docs convert to PDF)
              </span>
              <input
                key="file-input"
                style={inputStyle}
                type="file"
                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                required
              />
            </label>
          ) : (
            <label style={{ display: "grid", gap: "0.35rem" }}>
              Page URL{" "}
              <span style={{ opacity: 0.6 }}>
                (rendered to PDF — e.g. a terms page)
              </span>
              <input
                key="url-input"
                style={inputStyle}
                type="url"
                value={pageUrl}
                onChange={(e) => setPageUrl(e.target.value)}
                placeholder="https://example.com/terms"
                required
              />
            </label>
          )}
          <button
            type="submit"
            disabled={phase === "working"}
            style={{
              padding: "0.8rem",
              fontSize: "1.05rem",
              fontWeight: 600,
              color: "#fff",
              background: "#111827",
              border: "none",
              borderRadius: 8,
              cursor: phase === "working" ? "wait" : "pointer",
            }}
          >
            {phase === "working" ? "Creating…" : "Create signing link"}
          </button>
        </form>
      )}

      {phase === "done" && session && (
        <section style={{ display: "grid", gap: "1.25rem" }}>
          <div
            style={{
              background: "#f0fdf4",
              border: "1px solid #bbf7d0",
              borderRadius: 12,
              padding: "1.25rem",
              textAlign: "center",
            }}
          >
            <h2 style={{ margin: "0 0 1rem" }}>Ready to sign</h2>
            <div
              style={{
                display: "inline-block",
                background: "#fff",
                padding: 12,
                borderRadius: 8,
              }}
            >
              <QRCodeSVG value={session.signing_url} size={200} />
            </div>
            <p style={{ opacity: 0.7, margin: "1rem 0 0.25rem" }}>
              On a phone? Open the link directly. On a computer? Scan the QR
              code with your phone.
            </p>
          </div>
          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              alignItems: "center",
              background: "#f9fafb",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              padding: "0.75rem",
            }}
          >
            <code
              style={{
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: "0.85rem",
              }}
            >
              {session.signing_url}
            </code>
            <button
              onClick={copyLink}
              style={{
                padding: "0.5rem 0.9rem",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                background: "#fff",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {copied ? "Copied!" : "Copy link"}
            </button>
          </div>
          <p style={{ opacity: 0.6, fontSize: "0.9rem", margin: 0 }}>
            This link expires in 30 days. Send it to your signer by email or
            text — no account needed on their end.
          </p>
          <button
            onClick={() => {
              setPhase("form");
              setSession(null);
              setFile(null);
              setTitle("");
            }}
            style={{
              padding: "0.6rem",
              borderRadius: 8,
              border: "1px solid #d1d5db",
              background: "#fff",
              cursor: "pointer",
            }}
          >
            Send another document
          </button>
        </section>
      )}
    </main>
  );
}
