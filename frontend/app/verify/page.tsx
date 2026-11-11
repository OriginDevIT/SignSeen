"use client";

import { useRef, useState } from "react";
import {
  ApiError,
  MAX_VERIFY_FILE_BYTES,
  VERIFY_REASON_TEXT,
  verifyDocument,
  type VerifyVerdict,
} from "../../lib/api";

const page: React.CSSProperties = {
  maxWidth: 640,
  margin: "0 auto",
  padding: "2rem 1.25rem",
  fontFamily: "system-ui, sans-serif",
  display: "flex",
  flexDirection: "column",
  gap: "1rem",
};

const dropzone: React.CSSProperties = {
  border: "2px dashed #9ca3af",
  borderRadius: 12,
  padding: "2.5rem 1.25rem",
  textAlign: "center",
  cursor: "pointer",
};

const button: React.CSSProperties = {
  padding: "0.7rem 1.25rem",
  fontSize: "1rem",
  border: "none",
  borderRadius: 8,
  background: "#111827",
  color: "#fff",
  cursor: "pointer",
};

const ghost: React.CSSProperties = {
  ...button,
  background: "#f3f4f6",
  color: "#111",
};

const card: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: "1.25rem",
};

export default function VerifyPage() {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<VerifyVerdict | null>(null);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = (candidate: File | null | undefined) => {
    setVerdict(null);
    setError("");
    if (!candidate) return;
    const looksPdf =
      candidate.type === "application/pdf" ||
      candidate.name.toLowerCase().endsWith(".pdf");
    if (!looksPdf) {
      setFile(null);
      setError("That doesn't look like a PDF — choose a .pdf file.");
      return;
    }
    if (candidate.size > MAX_VERIFY_FILE_BYTES) {
      setFile(null);
      setError("That file is larger than 15 MB.");
      return;
    }
    setFile(candidate);
  };

  const check = async () => {
    if (!file || busy) return;
    setError("");
    setVerdict(null);
    setBusy(true);
    try {
      setVerdict(await verifyDocument(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setFile(null);
    setVerdict(null);
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <main style={page}>
      <h1 style={{ fontSize: "1.75rem", margin: 0 }}>
        Verify a signed document
      </h1>
      <p style={{ opacity: 0.75, margin: 0, lineHeight: 1.6 }}>
        Upload a PDF and check whether it is a genuine document sealed by
        SignSeen. No account needed.
      </p>
      <p style={{ margin: 0, lineHeight: 1.6 }}>
        We don&apos;t store your document. It is uploaded, checked, and
        deleted right away — nothing is kept, and no record of the check
        is saved.
      </p>
      <p style={{ margin: 0, lineHeight: 1.6, opacity: 0.75 }}>
        A copy of a genuine sealed document verifies as valid. This check
        proves the file is a genuine document sealed by SignSeen — not
        that it is the only or original copy.
      </p>

      <div
        role="button"
        tabIndex={0}
        aria-label="Choose a PDF to verify"
        style={{
          ...dropzone,
          borderColor: dragOver ? "#111827" : "#9ca3af",
          background: dragOver ? "#f9fafb" : "#fff",
        }}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          pick(e.dataTransfer.files?.[0]);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          style={{ display: "none" }}
          onChange={(e) => pick(e.target.files?.[0])}
        />
        {file ? (
          <div>
            <div style={{ fontWeight: 600 }}>{file.name}</div>
            <div style={{ opacity: 0.65, fontSize: "0.9rem" }}>
              {(file.size / (1024 * 1024)).toFixed(2)} MB — click to choose
              a different file, or drop another here.
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontWeight: 600 }}>
              Drop a PDF here, or click to choose one
            </div>
            <div style={{ opacity: 0.65, fontSize: "0.9rem" }}>
              PDF only, up to 15 MB.
            </div>
          </div>
        )}
      </div>

      {error && (
        <p
          style={{
            background: "#fef2f2",
            color: "#b91c1c",
            padding: "0.75rem 1rem",
            borderRadius: 8,
            margin: 0,
          }}
        >
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button onClick={check} disabled={!file || busy} style={button}>
          {busy ? "Checking…" : "Verify this document"}
        </button>
        {(file || verdict) && (
          <button onClick={reset} disabled={busy} style={ghost}>
            Check another document
          </button>
        )}
      </div>

      {verdict && verdict.valid && (
        <div
          style={{
            ...card,
            borderColor: "#16a34a",
            background: "#f0fdf4",
          }}
        >
          <h2 style={{ margin: "0 0 0.75rem", fontSize: "1.25rem" }}>
            Valid — this is a genuine document sealed by SignSeen.
          </h2>
          <dl style={{ margin: 0, display: "grid", gap: "0.5rem" }}>
            <div>
              <dt style={{ fontWeight: 600 }}>Document</dt>
              <dd style={{ margin: 0 }}>{verdict.document_title}</dd>
            </div>
            <div>
              <dt style={{ fontWeight: 600 }}>Signed</dt>
              <dd style={{ margin: 0 }}>
                {verdict.signed_at
                  ? new Date(verdict.signed_at).toLocaleString()
                  : ""}
              </dd>
            </div>
            <div>
              <dt style={{ fontWeight: 600 }}>Signers</dt>
              <dd style={{ margin: 0 }}>{verdict.signer_count}</dd>
            </div>
            <div>
              <dt style={{ fontWeight: 600 }}>Signer email</dt>
              <dd style={{ margin: 0 }}>{verdict.signer_email}</dd>
            </div>
          </dl>
        </div>
      )}

      {verdict && !verdict.valid && (
        <div
          style={{
            ...card,
            borderColor: "#b91c1c",
            background: "#fef2f2",
          }}
        >
          <h2 style={{ margin: "0 0 0.5rem", fontSize: "1.25rem" }}>
            Invalid — this file could not be verified as a document sealed
            by SignSeen.
          </h2>
          <p style={{ margin: 0 }}>
            {verdict.reason
              ? VERIFY_REASON_TEXT[verdict.reason]
              : "This file could not be verified."}
          </p>
        </div>
      )}
    </main>
  );
}
