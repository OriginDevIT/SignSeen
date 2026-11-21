"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import SignaturePad, { type SignaturePadHandle } from "../../../components/SignaturePad";
import FieldModal from "../../../components/FieldModal";
import PhotoStep from "../../../components/PhotoStep";
import {
  ApiError,
  collectDeviceInfo,
  getDocument,
  getSession,
  getSessionEvents,
  mediaUrl,
  setSignerEmail,
  sessionDocumentUrl,
  sessionFieldImageUrl,
  sessionPageUrl,
  submitSignature,
  type DocumentFieldInfo,
  type SessionInfo,
  type SignResult,
} from "../../../lib/api";
import { CEREMONY_STEPS } from "../../../lib/ceremony";
import { fieldBox } from "../../../lib/fieldBox";

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

/** Continue-on-your-phone QR (#94): a signer who opened the signing
 * link on a desktop scans it to continue signing on their phone. The
 * QR stays behind a button so signers already on a phone never see it
 * unless they ask for it. Same QR block as the other renderings in
 * the app. */
function PhoneQr({ signingUrl }: { signingUrl: string }) {
  const [showQr, setShowQr] = useState(false);
  if (!signingUrl) return null;
  return (
    <div>
      <button
        type="button"
        onClick={() => setShowQr((v) => !v)}
        style={{
          padding: "0.6rem 0.9rem",
          fontSize: "0.85rem",
          borderRadius: 8,
          border: "1px solid #d1d5db",
          background: "#fff",
          cursor: "pointer",
        }}
      >
        {showQr ? "Hide QR code" : "Continue on your phone"}
      </button>
      {showQr && (
        <div
          style={{
            marginTop: "0.75rem",
            display: "grid",
            gap: "0.75rem",
            justifyItems: "center",
          }}
        >
          <p style={{ margin: 0, fontSize: "0.9rem", opacity: 0.7, textAlign: "center" }}>
            Scan the code with your phone to open the same signing link
            and continue signing there.
          </p>
          <div
            style={{
              background: "#fff",
              padding: 10,
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              // Fixed-size QR overflows narrow phones; the SVG scales
              // down with the viewport instead (#47).
              width: "min(182px, 72vw)",
              boxSizing: "border-box",
            }}
          >
            <QRCodeSVG
              value={signingUrl}
              size={160}
              style={{ width: "100%", height: "auto", display: "block" }}
            />
          </div>
          <code
            style={{
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

/** The stored value inside a completed field's box. */
function completedFieldValue(f: DocumentFieldInfo, token: string) {
  if (f.type === "signature" || f.type === "initials") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={sessionFieldImageUrl(token, f.id)}
        alt={`${f.type} completed by an earlier signer`}
        style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
      />
    );
  }
  if (f.type === "checkbox") {
    return (
      <span style={{ fontSize: "1.1rem", lineHeight: 1 }}>
        {f.value === "true" ? "✓" : "—"}
      </span>
    );
  }
  return (
    <span
      style={{
        fontSize: "0.85rem",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        display: "block",
        width: "100%",
        textAlign: "center",
      }}
    >
      {f.value}
    </span>
  );
}

/** A field an earlier signer already completed (#105): read-only and
 * non-clickable, visually distinct from the signer's own fields
 * (dashed border / grey pill instead of the solid dark box), with
 * the stored value rendered inside. */
function CompletedField({ field: f, token }: { field: DocumentFieldInfo; token: string }) {
  const label = `${f.type} field on page ${f.page}, completed by an earlier signer`;
  const b = fieldBox(f);
  if (b === null) {
    // Click-placed field: marker pill, grey instead of dark.
    const pillText =
      f.type === "signature" || f.type === "initials"
        ? `${f.type} ✓`
        : f.type === "checkbox"
          ? `checkbox ${f.value === "true" ? "✓" : "—"}`
          : `${f.type}: ${f.value}`;
    return (
      <div
        data-testid="completed-field-pill"
        aria-label={label}
        title={pillText}
        style={{
          position: "absolute",
          left: `${f.x * 100}%`,
          top: `${f.y * 100}%`,
          transform: "translate(-2px, -50%)",
          background: "#6b7280",
          color: "#fff",
          fontSize: "0.7rem",
          padding: "0.15rem 0.45rem",
          borderRadius: 999,
          whiteSpace: "nowrap",
          maxWidth: "70%",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {pillText}
      </div>
    );
  }
  return (
    <div
      data-testid="completed-field-box"
      aria-label={label}
      title={`${f.type} — completed by an earlier signer`}
      style={{
        position: "absolute",
        left: `${b.x * 100}%`,
        top: `${b.y * 100}%`,
        width: `${b.width * 100}%`,
        height: `${b.height * 100}%`,
        border: "2px dashed #6b7280",
        background: "rgba(255, 255, 255, 0.7)",
        borderRadius: 2,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0.1rem 0.25rem",
        boxSizing: "border-box",
      }}
    >
      {completedFieldValue(f, token)}
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
  // Rendered page aspect (width/height) per page, from the preview
  // image's natural size — used to size field pads to drawn boxes.
  // Letter (612/792) until the image reports its own size.
  const [pageAspects, setPageAspects] = useState<Record<number, number>>({});
  // Field whose modal is open, if any.
  const [modalField, setModalField] = useState<DocumentFieldInfo | null>(null);
  // Whether the signer has opened a field modal since entering the
  // sign step. The entry scroll below must not fire after that: a
  // fast signer who completes a field inside its 100ms window would
  // otherwise be yanked back to the first field.
  const fieldActedRef = useRef(false);
  // A signature/initials image drawn anywhere in this ceremony —
  // offered for reuse in later field modals and the document pad.
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [savedInitials, setSavedInitials] = useState<string | null>(null);

  const padRef = useRef<SignaturePadHandle>(null);
  const fieldBoxRefs = useRef(new Map<string, HTMLDivElement>());
  const continueRef = useRef<HTMLButtonElement>(null);

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

  // Cross-device completion: while the ceremony is open on this
  // device, re-check the session — a signer who continued on their
  // phone submits there, and this page should move to the done view
  // instead of sitting on the signing form. Polls only while the
  // ceremony is in an active step; the page's own submit flow is
  // untouched. When the session turns signed, the done view is built
  // from the same public endpoints the submit response draws on: the
  // document (for the signed file) and the audit trail (for the seal
  // — the sealed event's hash when the document is final, else the
  // submitted event's hash, mirroring the submit response). A failed
  // poll changes nothing; the next interval retries.
  const POLL_INTERVAL_MS = 5000;
  useEffect(() => {
    if (step !== "intro" && step !== "sign" && step !== "photo") return;
    let cancelled = false;
    let inFlight = false;
    const check = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const s = await getSession(token);
        if (cancelled || s.status !== "signed") return;
        const [doc, trail] = await Promise.all([
          getDocument(s.document),
          getSessionEvents(token),
        ]);
        if (cancelled) return;
        const sealed = trail.events.find(
          (e) => e.event_type === "document.sealed"
        );
        const submitted = trail.events.find(
          (e) => e.event_type === "signature.submitted"
        );
        setSession(s);
        setResult({
          status: "signed",
          document_final: s.document_status === "signed",
          document: doc,
          audit_seal: sealed?.hash ?? submitted?.hash ?? "",
          chain_valid: trail.chain_valid,
        });
        setStep("done");
      } catch {
        // A failed poll changes nothing; the next interval retries.
      } finally {
        inFlight = false;
      }
    };
    const id = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [step, token]);

  const startSigning = () => setStep("sign");

  const confirmSignature = () => {
    // A signature already chosen (drawn here or reused from a field
    // modal) goes straight on; otherwise the pad must hold ink.
    if (signatureUrl) {
      setStep("photo");
      return;
    }
    const pad = padRef.current;
    if (!pad || pad.isEmpty()) return;
    const url = pad.toDataURL();
    setSignatureUrl(url);
    setSavedSignature(url);
    setStep("photo");
  };

  // Whether the sender requires a witness photo for this document
  // (#73, per-document, set at send time). The photo step hides
  // "Skip photo" and blocks submit until a photo is attached.
  const photoRequired = session?.photo_required ?? false;

  // "Take photo": open the in-app camera (front camera requested
  // exactly, unlike the capture="user" hint some phones ignore). A
  // camera that cannot start shows a continue-on-your-phone QR
  // inside the camera instead of an upload path.
  const openPhotoCapture = () => {
    setCameraOpen(true);
  };

  const fieldComplete = (
    f: DocumentFieldInfo,
    values: Record<string, string | boolean> = fieldValues
  ): boolean => {
    const v = values[f.id];
    if (f.type === "checkbox") return v === true;
    if (f.type === "text") return typeof v === "string" && v.trim().length > 0;
    return typeof v === "string" && v.length > 0;
  };

  const sessionFields = session?.fields ?? [];
  const hasFields = sessionFields.length > 0;
  // Fields other signers already completed (#105): read-only, never
  // counted toward this signer's progress or the continue gate.
  const completedFields = session?.completed_fields ?? [];
  // The fields section renders when there is anything to show on the
  // document — the signer's own fields, or earlier signers' completed
  // ones (a signer with no fields of their own still sees those).
  const showFieldsSection = hasFields || completedFields.length > 0;
  const allRequiredComplete = sessionFields
    .filter((f) => f.required)
    .every((f) => fieldComplete(f));

  const scrollToField = (f: DocumentFieldInfo) => {
    fieldBoxRefs.current
      .get(f.id)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // Opening a field modal counts as the signer acting: the entry
  // scroll below must not yank the page afterwards.
  const openFieldModal = (f: DocumentFieldInfo) => {
    fieldActedRef.current = true;
    setModalField(f);
  };

  // Entering the sign step scrolls to the first field still to
  // complete, so the signer starts where the work is — unless the
  // signer already opened a field inside the 100ms window.
  useEffect(() => {
    if (step !== "sign" || !hasFields) return;
    fieldActedRef.current = false;
    const t = setTimeout(() => {
      const first = sessionFields.find((f) => !fieldComplete(f));
      if (first && !fieldActedRef.current) scrollToField(first);
    }, 100);
    return () => clearTimeout(t);
    // Only on entering the sign step: the field list is fixed for
    // the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  /** Save one field's modal value, then scroll to the next field
   * still to complete — or to the continue button when this was the
   * last one. A drawn signature/initials image joins the reuse pool
   * for later modals and the document pad. */
  const saveFieldValue = (f: DocumentFieldInfo, value: string | boolean) => {
    const nextValues = { ...fieldValues, [f.id]: value };
    setFieldValues(nextValues);
    if (f.type === "signature" && typeof value === "string" && value) {
      setSavedSignature(value);
    }
    if (f.type === "initials" && typeof value === "string" && value) {
      setSavedInitials(value);
    }
    setModalField(null);
    const idx = sessionFields.findIndex((x) => x.id === f.id);
    const after = [...sessionFields.slice(idx + 1), ...sessionFields.slice(0, idx + 1)];
    const next = after.find((x) => !fieldComplete(x, nextValues));
    setTimeout(() => {
      if (next) {
        scrollToField(next);
      } else {
        continueRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    }, 50);
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

  // The signing link for the camera's continue-on-your-phone QR:
  // the session's canonical URL, or this page's URL (the signer is
  // already on the signing link).
  const signingLink =
    session?.signing_url ||
    (typeof window !== "undefined" ? window.location.href : "");
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
          <PhoneQr signingUrl={signingLink} />
        </section>
      )}

      {step === "sign" && (
        <section style={{ display: "grid", gap: "1rem" }}>
          <PhoneQr signingUrl={signingLink} />
          {showFieldsSection && (
            <div style={{ display: "grid", gap: "1rem" }}>
              <h2 style={{ margin: 0 }}>
                {hasFields
                  ? "1. Your fields on this document"
                  : "1. Fields already completed on this document"}
              </h2>
              {hasFields ? (
                <p style={{ opacity: 0.65, margin: 0 }}>
                  Tap a field on the document to complete it.
                </p>
              ) : (
                <p style={{ opacity: 0.65, margin: 0 }}>
                  An earlier signer completed these fields — they are shown for reference.
                </p>
              )}
              {hasFields && completedFields.length > 0 && (
                <p style={{ opacity: 0.65, margin: 0, fontSize: "0.9rem" }}>
                  Fields already completed by an earlier signer are shown with a dashed border and cannot be changed.
                </p>
              )}
              {[...new Set([...sessionFields, ...completedFields].map((f) => f.page))]
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
                      onLoad={(e) => {
                        const img = e.currentTarget;
                        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                          const aspect = img.naturalWidth / img.naturalHeight;
                          setPageAspects((prev) =>
                            prev[pg] === aspect ? prev : { ...prev, [pg]: aspect }
                          );
                        }
                      }}
                      style={{ width: "100%", display: "block" }}
                    />
                    {sessionFields
                      .filter((f) => f.page === pg)
                      .map((f) => {
                        const b = fieldBox(f);
                        const bg = fieldComplete(f) ? "#15803d" : "#111827";
                        if (b === null) {
                          // Click-placed field: no stored size, marker pill.
                          return (
                            <div
                              key={f.id}
                              ref={(el) => {
                                if (el) fieldBoxRefs.current.set(f.id, el);
                                else fieldBoxRefs.current.delete(f.id);
                              }}
                              role="button"
                              tabIndex={0}
                              aria-label={`${f.type} field on page ${f.page}${f.required ? ", required" : ""}${fieldComplete(f) ? ", completed" : ", not completed yet"}`}
                              data-testid="field-pill"
                              onClick={() => openFieldModal(f)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  openFieldModal(f);
                                }
                              }}
                              style={{
                                position: "absolute",
                                left: `${f.x * 100}%`,
                                top: `${f.y * 100}%`,
                                transform: "translate(-2px, -50%)",
                                background: bg,
                                color: "#fff",
                                fontSize: "0.7rem",
                                padding: "0.15rem 0.45rem",
                                borderRadius: 999,
                                cursor: "pointer",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {f.type}
                              {f.required ? " *" : ""}
                            </div>
                          );
                        }
                        return (
                          <div
                            key={f.id}
                            ref={(el) => {
                              if (el) fieldBoxRefs.current.set(f.id, el);
                              else fieldBoxRefs.current.delete(f.id);
                            }}
                            role="button"
                            tabIndex={0}
                            aria-label={`${f.type} field on page ${f.page}${f.required ? ", required" : ""}${fieldComplete(f) ? ", completed" : ", not completed yet"}`}
                            data-testid="field-box"
                            onClick={() => openFieldModal(f)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                openFieldModal(f);
                              }
                            }}
                            style={{
                              position: "absolute",
                              left: `${b.x * 100}%`,
                              top: `${b.y * 100}%`,
                              width: `${b.width * 100}%`,
                              height: `${b.height * 100}%`,
                              border: `2px solid ${bg}`,
                              background: "rgba(17, 24, 39, 0.08)",
                              borderRadius: 2,
                              cursor: "pointer",
                              overflow: "hidden",
                            }}
                          >
                            <span
                              style={{
                                display: "block",
                                background: bg,
                                color: "#fff",
                                fontSize: "0.7rem",
                                padding: "0.1rem 0.4rem",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {f.type}
                              {f.required ? " *" : ""}
                            </span>
                          </div>
                        );
                      })}
                    {completedFields
                      .filter((f) => f.page === pg)
                      .map((f) => (
                        <CompletedField key={f.id} field={f} token={token} />
                      ))}
                  </div>
                ))}
              {hasFields && !allRequiredComplete && (
                <p style={{ opacity: 0.65, margin: 0, fontSize: "0.9rem" }}>
                  Complete every required field (marked *) to continue.
                </p>
              )}
            </div>
          )}
          {/* The document signature comes after the fields, not before. */}
          <h2 style={{ margin: 0 }}>
            {showFieldsSection
              ? "2. Sign the document — draw your signature"
              : "1. Signed — draw your signature"}
          </h2>
          {signatureUrl ? (
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={signatureUrl}
                alt="Signature preview"
                style={{ height: 48, border: "1px solid #e5e7eb", borderRadius: 6 }}
              />
              <button
                onClick={() => {
                  setSignatureUrl("");
                  padRef.current?.clear();
                }}
                style={{ ...ghostBtn, width: "auto" }}
              >
                Redo
              </button>
            </div>
          ) : (
            <>
              {savedSignature && (
                <button
                  onClick={() => setSignatureUrl(savedSignature)}
                  style={ghostBtn}
                >
                  Use your signature
                </button>
              )}
              <SignaturePad ref={padRef} />
            </>
          )}
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button
              onClick={() => {
                padRef.current?.clear();
                setSignatureUrl("");
              }}
              style={{ ...ghostBtn, width: "auto", flex: 1 }}
            >
              Clear
            </button>
            <button
              ref={continueRef}
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
          {modalField && (
            <FieldModal
              field={modalField}
              pageAspect={pageAspects[modalField.page] ?? 612 / 792}
              savedSignature={savedSignature}
              savedInitials={savedInitials}
              initialValue={fieldValues[modalField.id]}
              onSave={(value) => saveFieldValue(modalField, value)}
              onClose={() => setModalField(null)}
            />
          )}
        </section>
      )}

      {step === "photo" && (
        <PhotoStep
          photoUrl={photoUrl}
          photoConsent={photoConsent}
          onConsentChange={setPhotoConsent}
          cameraOpen={cameraOpen}
          onTakePhoto={openPhotoCapture}
          onCapturePhoto={setPhotoUrl}
          onCloseCamera={() => setCameraOpen(false)}
          signingUrl={signingLink}
          photoRequired={photoRequired}
          requiredBy={session?.sender_email}
          fieldsComplete={!hasFields || allRequiredComplete}
          onSubmit={submit}
          submitStyle={brandBtn}
        />
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
