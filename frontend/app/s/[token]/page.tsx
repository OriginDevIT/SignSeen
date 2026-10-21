"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import SignaturePad, { type SignaturePadHandle } from "../../../components/SignaturePad";
import WitnessCamera from "../../../components/WitnessCamera";
import { isCameraSupported } from "../../../lib/camera";
import {
  ApiError,
  collectDeviceInfo,
  getSession,
  mediaUrl,
  setSignerEmail,
  sessionDocumentUrl,
  sessionPageUrl,
  submitSignature,
  type DocumentFieldInfo,
  type SessionInfo,
  type SignResult,
} from "../../../lib/api";
import { CEREMONY_STEPS } from "../../../lib/ceremony";

type Step = "loading" | "intro" | "sign" | "photo" | "submitting" | "done" | "waiting" | "unavailable";

const shell: React.CSSProperties = {
  maxWidth: 560,
  margin: "0 auto",
  padding: "2rem 1.25rem",
  fontFamily: "system-ui, sans-serif",
};

const primaryBtn: React.CSSProperties = {
  padding: "0.85rem",
  fontSize: "1.05rem",
  fontWeight: 600,
  color: "#fff",
  background: "#111827",
  border: "none",
  borderRadius: 10,
  cursor: "pointer",
  width: "100%",
};

const ghostBtn: React.CSSProperties = {
  padding: "0.7rem",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  cursor: "pointer",
  width: "100%",
};

function StepDots({ active }: { active: number }) {
  return (
    <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", marginBottom: "1.5rem" }}>
      {CEREMONY_STEPS.map((label, i) => (
        <div key={label} style={{ textAlign: "center", flex: 1 }}>
          <div
            style={{
              height: 6,
              borderRadius: 3,
              background: i <= active ? "#111827" : "#e5e7eb",
            }}
          />
          <div
            style={{
              fontSize: "0.75rem",
              marginTop: "0.3rem",
              fontWeight: i === active ? 700 : 400,
              opacity: i <= active ? 1 : 0.5,
            }}
          >
            {label}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SignPage() {
  const params = useParams();
  const token = params.token as string;

  const [step, setStep] = useState<Step>("loading");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState("");
  const [signatureUrl, setSignatureUrl] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoConsent, setPhotoConsent] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [result, setResult] = useState<SignResult | null>(null);
  const [copyEmail, setCopyEmail] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "sending" | "sent">("idle");
  const [copyError, setCopyError] = useState("");

  const [fieldValues, setFieldValues] = useState<Record<string, string | boolean>>({});
  const fieldPadRefs = useRef(new Map<string, SignaturePadHandle>());

  const padRef = useRef<SignaturePadHandle>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getSession(token)
      .then((s) => {
        setSession(s);
        // Date fields default to today (editable), per the ceremony spec.
        const today = new Date().toISOString().slice(0, 10);
        setFieldValues((prev) => {
          const next = { ...prev };
          for (const f of s.fields ?? []) {
            if (f.type === "date" && next[f.id] === undefined) {
              next[f.id] = today;
            }
          }
          return next;
        });
        setStep(s.usable ? "intro" : s.waiting ? "waiting" : "unavailable");
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Could not load this signing session.");
        setStep("unavailable");
      });
  }, [token]);

  const startSigning = () => setStep("sign");

  const confirmSignature = () => {
    const pad = padRef.current;
    if (!pad || pad.isEmpty()) return;
    setSignatureUrl(pad.toDataURL());
    setStep("photo");
  };

  // "Take photo": prefer the in-app camera (defaults to the front
  // camera for real, unlike the capture="user" hint some phones
  // ignore); fall back to the file picker where getUserMedia is
  // unavailable. Denial inside the camera also lands on the fallback.
  const openPhotoCapture = () => {
    if (isCameraSupported()) {
      setCameraOpen(true);
    } else {
      photoInputRef.current?.click();
    }
  };

  const onPhotoPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setPhotoUrl(reader.result as string);
    reader.readAsDataURL(f);
  };

  const fieldComplete = (f: DocumentFieldInfo): boolean => {
    const v = fieldValues[f.id];
    if (f.type === "checkbox") return v === true;
    if (f.type === "text") return typeof v === "string" && v.trim().length > 0;
    return typeof v === "string" && v.length > 0;
  };

  const sessionFields = session?.fields ?? [];
  const hasFields = sessionFields.length > 0;
  const allRequiredComplete = sessionFields
    .filter((f) => f.required)
    .every(fieldComplete);

  const captureFieldPad = (f: DocumentFieldInfo) => {
    const pad = fieldPadRefs.current.get(f.id);
    if (!pad || pad.isEmpty()) return;
    setFieldValues((prev) => ({ ...prev, [f.id]: pad.toDataURL() }));
  };

  const submit = async () => {
    setError("");
    setStep("submitting");
    try {
      const res = await submitSignature(token, {
        signature: signatureUrl,
        photo: photoUrl ?? undefined,
        photoConsent: photoUrl ? photoConsent : undefined,
        deviceInfo: collectDeviceInfo(),
        fieldValues: sessionFields
          .filter((f) => fieldValues[f.id] !== undefined && fieldValues[f.id] !== "")
          .map((f) => ({ field_id: f.id, value: fieldValues[f.id] })),
      });
      setResult(res);
      setStep("done");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Submission failed. Please try again.");
      setStep("photo");
    }
  };

  if (step === "loading") {
    return (
      <main style={shell}>
        <p style={{ textAlign: "center", opacity: 0.6 }}>Loading signing session…</p>
      </main>
    );
  }

  if (step === "waiting") {
    return (
      <main style={shell}>
        <h1 style={{ textAlign: "center" }}>This link isn&apos;t active yet</h1>
        <p style={{ textAlign: "center", opacity: 0.65 }}>
          This document is signed in order, and an earlier signer
          hasn&apos;t signed yet. Your link activates as soon as they do —
          please check back later.
        </p>
      </main>
    );
  }

  if (step === "unavailable" || !session) {
    return (
      <main style={shell}>
        <h1 style={{ textAlign: "center" }}>This link is no longer active</h1>
        <p style={{ textAlign: "center", opacity: 0.65 }}>
          {error ||
            "It may have already been signed or expired. Please ask the sender for a new link."}
        </p>
      </main>
    );
  }

  const submitCopyEmail = async () => {
    setCopyError("");
    setCopyState("sending");
    try {
      await setSignerEmail(token, copyEmail.trim());
      setCopyState("sent");
    } catch (err) {
      setCopyError(err instanceof ApiError ? err.message : "Could not send the copy.");
      setCopyState("idle");
    }
  };

  const signedPdfUrl = result ? mediaUrl(result.document.signed_file) : null;
  // Sender branding (premium accounts): logo/name header + the accent
  // color on primary actions. All-empty branding = SignSeen defaults.
  const branding = session.branding;
  const hasBranding = !!(branding && (branding.name || branding.logo));
  const brandBtn: React.CSSProperties = branding?.color
    ? { ...primaryBtn, background: branding.color }
    : primaryBtn;
  // The email that links this document to a later account: one the
  // signer just left at completion, or the one the sender addressed
  // the session to (their copy already went out at seal time).
  const archiveEmail =
    copyState === "sent" ? copyEmail.trim() : session?.signer_email || "";
  const signupHref = archiveEmail
    ? `/signup?email=${encodeURIComponent(archiveEmail)}`
    : "/signup";

  return (
    <main style={shell}>
      {hasBranding && (
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            justifyContent: "center",
            marginBottom: "1.25rem",
          }}
        >
          {branding.logo && (
            <img
              src={mediaUrl(branding.logo) ?? ""}
              alt={branding.name || "Sender logo"}
              style={{ maxHeight: 48, maxWidth: 160, objectFit: "contain" }}
            />
          )}
          {branding.name && (
            <div
              style={{
                fontWeight: 700,
                fontSize: "1.15rem",
                ...(branding.color ? { color: branding.color } : {}),
              }}
            >
              {branding.name}
            </div>
          )}
        </header>
      )}
      {step !== "done" && <StepDots active={step === "intro" ? 0 : step === "sign" ? 0 : step === "photo" ? 1 : 2} />}

      {error && (
        <p style={{ background: "#fef2f2", color: "#b91c1c", padding: "0.75rem 1rem", borderRadius: 8 }}>
          {error}
        </p>
      )}

      {step === "intro" && (
        <section style={{ display: "grid", gap: "1rem" }}>
          <h1 style={{ margin: 0, fontSize: "1.6rem" }}>{session.document_title}</h1>
          {session.signer_name && <p style={{ margin: 0, opacity: 0.7 }}>Prepared for {session.signer_name}</p>}
          <p style={{ opacity: 0.7 }}>
            Review the document, then sign with your finger or mouse and snap a
            quick photo as a witness. No account needed.
          </p>
          <a
            href={sessionDocumentUrl(token)}
            target="_blank"
            rel="noreferrer"
            style={{ ...ghostBtn, textAlign: "center", textDecoration: "none", color: "inherit", boxSizing: "border-box" }}
          >
            View document (PDF)
          </a>
          <button onClick={startSigning} style={brandBtn}>
            Start signing
          </button>
        </section>
      )}

      {step === "sign" && (
        <section style={{ display: "grid", gap: "1rem" }}>
          <h2 style={{ margin: 0 }}>1. Signed — draw your signature</h2>
          <SignaturePad ref={padRef} />
          {hasFields && (
            <div style={{ display: "grid", gap: "1rem" }}>
              <h3 style={{ margin: 0 }}>Your fields on this document</h3>
              {[...new Set(sessionFields.map((f) => f.page))]
                .sort((a, b) => a - b)
                .map((pg) => (
                  <div
                    key={pg}
                    style={{
                      position: "relative",
                      border: "1px solid #e5e7eb",
                      borderRadius: 8,
                      overflow: "hidden",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={sessionPageUrl(token, pg)}
                      alt={`Document page ${pg}`}
                      style={{ width: "100%", display: "block" }}
                    />
                    {sessionFields
                      .filter((f) => f.page === pg)
                      .map((f) => (
                        <div
                          key={f.id}
                          style={{
                            position: "absolute",
                            left: `${f.x * 100}%`,
                            top: `${f.y * 100}%`,
                            transform: "translate(-2px, -50%)",
                            background: fieldComplete(f) ? "#15803d" : "#111827",
                            color: "#fff",
                            fontSize: "0.7rem",
                            padding: "0.15rem 0.45rem",
                            borderRadius: 999,
                            pointerEvents: "none",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {f.type}
                          {f.required ? " *" : ""}
                        </div>
                      ))}
                  </div>
                ))}
              {sessionFields.map((f) => (
                <div
                  key={f.id}
                  style={{
                    display: "grid",
                    gap: "0.4rem",
                    border: "1px solid #e5e7eb",
                    borderRadius: 8,
                    padding: "0.75rem",
                  }}
                >
                  <span style={{ fontWeight: 600, textTransform: "capitalize" }}>
                    {f.type} <span style={{ opacity: 0.6, fontWeight: 400 }}>(page {f.page}{f.required ? ", required" : ", optional"})</span>
                  </span>
                  {(f.type === "signature" || f.type === "initials") &&
                    (typeof fieldValues[f.id] === "string" && fieldValues[f.id] ? (
                      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={fieldValues[f.id] as string}
                          alt={`${f.type} preview`}
                          style={{ height: 48, border: "1px solid #e5e7eb", borderRadius: 6 }}
                        />
                        <button
                          onClick={() =>
                            setFieldValues((prev) => ({ ...prev, [f.id]: "" }))
                          }
                          style={{ ...ghostBtn, width: "auto" }}
                        >
                          Redo
                        </button>
                      </div>
                    ) : (
                      <>
                        <SignaturePad
                          ref={(h) => {
                            if (h) fieldPadRefs.current.set(f.id, h);
                          }}
                        />
                        <button
                          onClick={() => captureFieldPad(f)}
                          style={{ ...ghostBtn }}
                        >
                          Use this {f.type}
                        </button>
                      </>
                    ))}
                  {f.type === "checkbox" && (
                    <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={fieldValues[f.id] === true}
                        onChange={(e) =>
                          setFieldValues((prev) => ({ ...prev, [f.id]: e.target.checked }))
                        }
                      />
                      Check the box
                    </label>
                  )}
                  {f.type === "text" && (
                    <input
                      type="text"
                      value={(fieldValues[f.id] as string) || ""}
                      onChange={(e) =>
                        setFieldValues((prev) => ({ ...prev, [f.id]: e.target.value }))
                      }
                      placeholder="Type here"
                      style={{
                        padding: "0.65rem 0.8rem",
                        border: "1px solid #d1d5db",
                        borderRadius: 8,
                        fontSize: "1rem",
                        boxSizing: "border-box",
                        width: "100%",
                      }}
                    />
                  )}
                  {f.type === "date" && (
                    <input
                      type="date"
                      value={(fieldValues[f.id] as string) || ""}
                      onChange={(e) =>
                        setFieldValues((prev) => ({ ...prev, [f.id]: e.target.value }))
                      }
                      style={{
                        padding: "0.65rem 0.8rem",
                        border: "1px solid #d1d5db",
                        borderRadius: 8,
                        fontSize: "1rem",
                        boxSizing: "border-box",
                        width: "100%",
                      }}
                    />
                  )}
                </div>
              ))}
              {!allRequiredComplete && (
                <p style={{ opacity: 0.65, margin: 0, fontSize: "0.9rem" }}>
                  Complete every required field (marked *) to continue.
                </p>
              )}
            </div>
          )}
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button onClick={() => padRef.current?.clear()} style={{ ...ghostBtn, width: "auto", flex: 1 }}>
              Clear
            </button>
            <button
              onClick={confirmSignature}
              disabled={hasFields && !allRequiredComplete}
              style={{
                ...brandBtn,
                width: "auto",
                flex: 2,
                opacity: hasFields && !allRequiredComplete ? 0.45 : 1,
                cursor: hasFields && !allRequiredComplete ? "not-allowed" : "pointer",
              }}
            >
              Looks good — continue
            </button>
          </div>
        </section>
      )}

      {step === "photo" && (
        <section style={{ display: "grid", gap: "1rem" }}>
          <h2 style={{ margin: 0 }}>2. Seen — snap a witness photo</h2>
          <p style={{ opacity: 0.7, margin: 0 }}>
            A quick photo of you signing acts as a photographic witness. Optional, but recommended.
          </p>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="user"
            onChange={onPhotoPicked}
            style={{ display: "none" }}
          />
          {cameraOpen ? (
            <WitnessCamera
              onCapture={(url) => {
                setPhotoUrl(url);
                setCameraOpen(false);
              }}
              onFallback={() => {
                setCameraOpen(false);
                photoInputRef.current?.click();
              }}
              onCancel={() => setCameraOpen(false)}
            />
          ) : photoUrl ? (
            <img
              src={photoUrl}
              alt="Witness photo preview"
              style={{ width: "100%", borderRadius: 12, maxHeight: 320, objectFit: "cover" }}
            />
          ) : (
            <div
              style={{
                border: "2px dashed #9ca3af",
                borderRadius: 12,
                height: 180,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: 0.6,
              }}
            >
              No photo yet
            </div>
          )}
          <label
            style={{
              display: "flex",
              gap: "0.5rem",
              alignItems: "flex-start",
              fontSize: "0.9rem",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={photoConsent}
              onChange={(e) => setPhotoConsent(e.target.checked)}
              style={{ marginTop: "0.2rem" }}
            />
            <span>
              I consent to having my photo captured as a witness to this
              signature. The photo is stamped into the signed document.
            </span>
          </label>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button
              onClick={openPhotoCapture}
              disabled={!photoConsent}
              style={{
                ...ghostBtn,
                flex: 1,
                opacity: photoConsent ? 1 : 0.45,
                cursor: photoConsent ? "pointer" : "not-allowed",
              }}
            >
              {photoUrl ? "Retake" : "Take photo"}
            </button>
            <button
              onClick={submit}
              disabled={hasFields && !allRequiredComplete}
              style={{
                ...brandBtn,
                flex: 2,
                opacity: hasFields && !allRequiredComplete ? 0.45 : 1,
                cursor: hasFields && !allRequiredComplete ? "not-allowed" : "pointer",
              }}
            >
              {photoUrl ? "Seal it — submit" : "Skip photo & submit"}
            </button>
          </div>
        </section>
      )}

      {step === "submitting" && (
        <p style={{ textAlign: "center", opacity: 0.6 }}>Sealing your signature…</p>
      )}

      {step === "done" && result && (
        <section style={{ display: "grid", gap: "1rem", textAlign: "center" }}>
          <div style={{ fontSize: "3rem" }}>✓</div>
          {result.document_final ? (
            <>
              <h1 style={{ margin: 0 }}>Signed. Seen. Sealed.</h1>
              <p style={{ opacity: 0.7, margin: 0 }}>
                Your signature is stamped on the document with a tamper-evident
                audit trail.
              </p>
            </>
          ) : (
            <>
              <h1 style={{ margin: 0 }}>Signature recorded</h1>
              <p style={{ opacity: 0.7, margin: 0 }}>
                Your signature is recorded — this document is waiting for
                the remaining signer(s). It will be sealed once everyone
                in the signing order has signed.
              </p>
            </>
          )}
          <div
            style={{
              background: "#f9fafb",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              padding: "0.75rem",
              fontSize: "0.8rem",
              wordBreak: "break-all",
              textAlign: "left",
            }}
          >
            <strong>Audit seal:</strong> {result.audit_seal}
            <br />
            <strong>Chain valid:</strong> {result.chain_valid ? "yes" : "no"}
          </div>
          {signedPdfUrl && (
            <a
              href={signedPdfUrl}
              target="_blank"
              rel="noreferrer"
              style={{ ...brandBtn, textDecoration: "none", boxSizing: "border-box" }}
            >
              Download signed PDF
            </a>
          )}
          {session?.signer_email ? (
            <p style={{ fontSize: "0.9rem", opacity: 0.65, margin: 0 }}>
              {result.document_final
                ? `A copy was emailed to ${session.signer_email}.`
                : `A copy will be emailed to ${session.signer_email} when the document is fully signed.`}
            </p>
          ) : copyState === "sent" ? (
            <p style={{ fontSize: "0.9rem", opacity: 0.65, margin: 0 }}>
              {result.document_final
                ? `Copy sent to ${copyEmail.trim()} — check your inbox.`
                : `Thanks — your copy will be emailed to ${copyEmail.trim()} when the document is fully signed.`}
            </p>
          ) : (
            <div style={{ display: "grid", gap: "0.5rem", textAlign: "left" }}>
              <label style={{ fontSize: "0.9rem", fontWeight: 600 }}>
                Get a copy by email <span style={{ opacity: 0.6, fontWeight: 400 }}>(optional, no account needed)</span>
                <input
                  type="email"
                  value={copyEmail}
                  onChange={(e) => setCopyEmail(e.target.value)}
                  placeholder="you@example.com"
                  style={{
                    width: "100%",
                    padding: "0.65rem 0.8rem",
                    border: "1px solid #d1d5db",
                    borderRadius: 8,
                    fontSize: "1rem",
                    boxSizing: "border-box",
                    marginTop: "0.35rem",
                  }}
                />
              </label>
              {copyError && (
                <p style={{ color: "#b91c1c", fontSize: "0.9rem", margin: 0 }}>{copyError}</p>
              )}
              <button
                onClick={submitCopyEmail}
                disabled={copyState === "sending" || !copyEmail.trim()}
                style={{
                  ...ghostBtn,
                  opacity: copyEmail.trim() ? 1 : 0.5,
                  cursor: copyEmail.trim() ? "pointer" : "not-allowed",
                }}
              >
                {copyState === "sending" ? "Sending…" : "Email me a copy"}
              </button>
            </div>
          )}
          <p style={{ fontSize: "0.9rem", opacity: 0.65, margin: 0 }}>
            Want to keep this document in your own library?{" "}
            <a href={signupHref}>Create a free account</a> — you&apos;ll find the
            documents you&apos;ve sent and received there.
          </p>
        </section>
      )}
    </main>
  );
}
