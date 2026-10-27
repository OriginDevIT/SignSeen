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
  const [signerEmail, setSignerEmail] = useState("");
  const [signingMode, setSigningMode] = useState<"sequential" | "parallel">("sequential");
  const [file, setFile] = useState<File | null>(null);
  const [pageUrl, setPageUrl] = useState("");
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [docId, setDocId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [isPremium, setIsPremium] = useState(false);
  const [nextSignerName, setNextSignerName] = useState("");
  const [nextSignerEmail, setNextSignerEmail] = useState("");
  const [addingSigner, setAddingSigner] = useState(false);

  // Logged-in senders: prefill their email and attach documents to the
  // account (the API does this from the token automatically).
  useEffect(() => {
    if (!getAuthToken()) return;
    myAccount()
      .then((account) => {
        setAccountEmail(account.email);
        setSenderEmail(account.email);
        setIsPremium(account.is_premium);
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
          ? await uploadDocument(file!, title.trim(), senderEmail.trim(), signingMode)
          : await createDocumentFromUrl(
              pageUrl.trim(),
              title.trim(),
              senderEmail.trim(),
              signingMode
            );
      const sess = await createSession(doc.id, signerName.trim(), signerEmail.trim());
      setSessions([sess]);
      setDocId(doc.id);
      setPhase("done");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
      setPhase("form");
    }
  };

  const copyLink = async (sess: SessionInfo) => {
    await navigator.clipboard.writeText(sess.signing_url);
    setCopiedId(sess.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Premium senders can add more signers to the same document. Sessions
  // sign strictly in order: signer 2's link activates only after
  // signer 1 has signed, and the document seals at the final signature.
  const addSigner = async () => {
    if (!docId) return;
    // The add-signer block is not a <form>, so `required` on the input
    // would not block this click — guard here instead (the API also
    // rejects a missing signer email with 400).
    if (!nextSignerEmail.trim()) {
      setError("A signer email is required — the signer is emailed their signing link and the document to sign.");
      return;
    }
    setError("");
    setAddingSigner(true);
    try {
      const sess = await createSession(docId, nextSignerName.trim(), nextSignerEmail.trim());
      setSessions((prev) => [...prev, sess]);
      setNextSignerName("");
      setNextSignerEmail("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setAddingSigner(false);
    }
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
        Upload a PDF — the signer is emailed their signing link and the
        document to sign. The signer needs no account.
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
          <label style={{ display: "grid", gap: "0.35rem" }}>
            Signer email <span style={{ opacity: 0.6 }}>(required — the signer is emailed their signing link and the document to sign)</span>
            <input
              style={inputStyle}
              type="email"
              required
              value={signerEmail}
              onChange={(e) => setSignerEmail(e.target.value)}
              placeholder="jane@example.com"
            />
          </label>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            Signing order
            <select
              style={inputStyle}
              value={signingMode}
              onChange={(e) => setSigningMode(e.target.value as "sequential" | "parallel")}
            >
              <option value="sequential">Sequential — signers sign one after another, in order</option>
              <option value="parallel">Parallel — all signers can sign in any order</option>
            </select>
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

      {phase === "done" && sessions.length > 0 && (
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
            <h2 style={{ margin: "0 0 0.5rem" }}>Ready to sign</h2>
            <p style={{ opacity: 0.7, margin: 0 }}>
              {sessions.length > 1
                ? signingMode === "parallel"
                  ? "Signers can sign in any order — the document seals when everyone has signed."
                  : "Signers sign in order — each link activates after the previous signer has signed, and the document seals at the final signature."
                : "On a phone? Open the link directly. On a computer? Scan the QR code with your phone."}
            </p>
          </div>
          {sessions.map((sess) => (
            <div
              key={sess.id}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: "1.25rem",
                display: "grid",
                gap: "0.75rem",
                justifyItems: "center",
                textAlign: "center",
              }}
            >
              <div style={{ fontWeight: 600 }}>
                Signer {sess.order + 1}
                {sess.signer_name ? ` — ${sess.signer_name}` : ""}
              </div>
              <div
                style={{
                  background: "#fff",
                  padding: 12,
                  borderRadius: 8,
                  border: "1px solid #e5e7eb",
                  // Fixed-size QR overflows narrow phones; the SVG scales
                  // down with the viewport instead (#47).
                  width: "min(184px, 72vw)",
                  boxSizing: "border-box",
                }}
              >
                <QRCodeSVG
                  value={sess.signing_url}
                  size={160}
                  style={{ width: "100%", height: "auto", display: "block" }}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  alignItems: "center",
                  flexWrap: "wrap",
                  background: "#f9fafb",
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  padding: "0.75rem",
                  width: "100%",
                  boxSizing: "border-box",
                }}
              >
                <code
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflowWrap: "anywhere",
                    fontSize: "0.85rem",
                    textAlign: "left",
                  }}
                >
                  {sess.signing_url}
                </code>
                <button
                  onClick={() => copyLink(sess)}
                  style={{
                    padding: "0.5rem 0.9rem",
                    borderRadius: 8,
                    border: "1px solid #d1d5db",
                    background: "#fff",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {copiedId === sess.id ? "Copied!" : "Copy link"}
                </button>
              </div>
            </div>
          ))}
          <p style={{ opacity: 0.6, fontSize: "0.9rem", margin: 0 }}>
            Each signer has been emailed their signing link and the
            document to sign. Links expire in 30 days — no account
            needed on their end.
          </p>
          {docId && (
            <p style={{ fontSize: "0.95rem", margin: 0 }}>
              <a href={`/place-fields/${docId}`}>Place fields on this document →</a>{" "}
              <span style={{ opacity: 0.6 }}>
                (signature / initials / checkbox / text / date fields, each
                assigned to a signer — owner account required)
              </span>
            </p>
          )}
          {isPremium && (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              <label style={{ display: "grid", gap: "0.35rem" }}>
                Add another signer <span style={{ opacity: 0.6 }}>(premium — signs after the signer(s) above, in order)</span>
                <input
                  style={inputStyle}
                  value={nextSignerName}
                  onChange={(e) => setNextSignerName(e.target.value)}
                  placeholder="Next signer name (optional)"
                />
                <input
                  style={inputStyle}
                  type="email"
                  value={nextSignerEmail}
                  onChange={(e) => setNextSignerEmail(e.target.value)}
                  placeholder="Next signer email (required — emailed their link and the document on their turn)"
                />
              </label>
              <button
                onClick={addSigner}
                disabled={addingSigner}
                style={{
                  padding: "0.6rem",
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                  background: "#fff",
                  cursor: addingSigner ? "wait" : "pointer",
                  fontWeight: 600,
                }}
              >
                {addingSigner ? "Adding…" : "Add another signer"}
              </button>
            </div>
          )}
          <button
            onClick={() => {
              setPhase("form");
              setSessions([]);
              setDocId(null);
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
