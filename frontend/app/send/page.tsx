"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import AuthBrandHeader from "../../components/AuthBrandHeader";
import UpgradeAction from "../../components/UpgradeAction";
import {
  ApiError,
  clearDraftToken,
  clearSendResult,
  createDocumentFromUrl,
  discardDraft,
  getAuthToken,
  getDocument,
  getDocumentFields,
  getDraftToken,
  getSendResult,
  myAccount,
  patchDocument,
  sendDocument,
  setDraftToken,
  setSendResult,
  startCheckout,
  uploadDocument,
  type DocumentFieldInfo,
  type DocumentInfo,
  type SessionInfo,
  type SignerInput,
} from "../../lib/api";

type Step = 1 | 2 | 3 | "done";
type Intake = "file" | "url";

const FREE_MAX_SIGNERS = 2;
const PREMIUM_MAX_SIGNERS = 10;

function readQuery(): { draftId: string | null; sentId: string | null; step: Step } {
  if (typeof window === "undefined") {
    return { draftId: null, sentId: null, step: 1 };
  }
  const q = new URLSearchParams(window.location.search);
  const draftId = q.get("draft");
  const sentId = q.get("sent");
  const rawStep = q.get("step");
  const step: Step =
    sentId ? "done" : rawStep === "2" ? 2 : rawStep === "3" ? 3 : 1;
  return { draftId, sentId, step };
}

export default function SendPage() {
  const [step, setStep] = useState<Step>(1);
  const [intake, setIntake] = useState<Intake>("file");
  const [title, setTitle] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [signers, setSigners] = useState<SignerInput[]>([{ name: "", email: "" }]);
  const [includeMe, setIncludeMe] = useState(false);
  const [signingMode, setSigningMode] = useState<"sequential" | "parallel">("parallel");
  const [photoRequired, setPhotoRequired] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [pageUrl, setPageUrl] = useState("");
  const [draft, setDraft] = useState<DocumentInfo | null>(null);
  const [fields, setFields] = useState<DocumentFieldInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [accountName, setAccountName] = useState("");
  const [isPremium, setIsPremium] = useState(false);
  // Whether the session check has settled. Until it does, the page
  // must not render the logged-out view: a signed-in sender would
  // briefly see the anonymous copy and a disabled photo checkbox.
  const [accountLoaded, setAccountLoaded] = useState(false);
  // Whether the draft resume from the URL has settled. Until it does,
  // no step content renders: a resume to step 2 or 3 would otherwise
  // flash the step-1 details form first (#153).
  const [resumeChecked, setResumeChecked] = useState(false);
  const [working, setWorking] = useState(false);

  // Premium checkout for a logged-in sender (annual is the default
  // plan); anonymous visitors go to account creation instead, which
  // the upgrade notices handle by rendering a signup link.
  const startUpgrade = async () => {
    setError("");
    try {
      window.location.href = await startCheckout("annual");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
    }
  };

  const goStep = useCallback((next: Step, draftId?: string | null, sentId?: string | null) => {
    setStep(next);
    if (typeof window !== "undefined") {
      const q = new URLSearchParams();
      if (sentId) {
        q.set("sent", sentId);
      } else if (draftId) {
        q.set("draft", draftId);
        if (next === 2 || next === 3) q.set("step", String(next));
      }
      const suffix = q.toString();
      window.history.replaceState(null, "", suffix ? `/send?${suffix}` : "/send");
    }
  }, []);

  // Logged-in senders: prefill their email and attach documents to the
  // account (the API does this from the token automatically).
  useEffect(() => {
    if (!getAuthToken()) {
      // No token: the sender is anonymous, and that is already known.
      setAccountLoaded(true);
      return;
    }
    myAccount()
      .then((account) => {
        setAccountEmail(account.email);
        setAccountName(account.name ?? "");
        setSenderEmail(account.email);
        setIsPremium(account.is_premium);
      })
      .catch(() => {})
      .finally(() => setAccountLoaded(true));
  }, []);

  // Refreshing mid-flow resumes the draft: the draft id is in the URL
  // and the draft token is in sessionStorage, keyed by draft id.
  useEffect(() => {
    const { draftId, sentId, step: initialStep } = readQuery();
    if (sentId) {
      const saved = getSendResult(sentId);
      if (saved) {
        setSessions(saved);
        setStep("done");
      }
      setResumeChecked(true);
      return;
    }
    if (!draftId) {
      setResumeChecked(true);
      return;
    }
    getDocument(draftId, getDraftToken(draftId))
      .then((doc) => {
        if (doc.status !== "draft") {
          setError("That document is no longer a draft.");
          return;
        }
        setDraft(doc);
        setTitle(doc.title);
        setSenderEmail(doc.sender_email);
        const list = doc.signer_list ?? [];
        setSigners(list.length > 0 ? list : [{ name: "", email: "" }]);
        // The sender-as-signer shows as the last list entry matching
        // the sender email; the checkbox is a step-1 convenience, so
        // a resumed draft keeps its list as-is.
        setSigningMode(doc.signing_mode);
        setPhotoRequired(doc.photo_required);
        setStep(initialStep === 1 ? 1 : initialStep);
      })
      .catch(() => {
        setError("Could not load that draft - it may have been discarded or expired.");
      })
      .finally(() => setResumeChecked(true));
  }, []);

  // Placed-field counts for steps 2 and 3, re-read when the step
  // changes (fields are placed on the place-fields page, then the
  // sender returns here).
  useEffect(() => {
    if (!draft || (step !== 2 && step !== 3)) return;
    getDocumentFields(draft.id, getDraftToken(draft.id))
      .then((data) => setFields(data.fields))
      .catch(() => {});
  }, [draft, step]);

  const maxSigners = isPremium ? PREMIUM_MAX_SIGNERS : FREE_MAX_SIGNERS;
  // The "Send to me" checkbox adds the sender as a signer, so it
  // counts toward the same cap as a signer row. The sender's account
  // name (blank for older accounts) is the entry's name.
  const effectiveSigners: SignerInput[] = [
    ...signers,
    ...(includeMe && senderEmail.trim()
      ? [{ name: accountName, email: senderEmail.trim() }]
      : []),
  ];
  // A free sender gets one signer row; the second signer is the sender
  // themself via "Send to me". The button greys out as soon as one row
  // exists, instead of letting a second arbitrary email be entered and
  // failing only at the later "second signer must be you" check.
  // Premium senders add rows up to the cap, counting the sender too.
  const canAddSigner = isPremium
    ? effectiveSigners.length < maxSigners
    : signers.length < FREE_MAX_SIGNERS - 1;

  const updateSigner = (index: number, patch: Partial<SignerInput>) => {
    setSigners((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...patch } : s))
    );
  };

  const removeSigner = (index: number) => {
    setSigners((prev) => prev.filter((_, i) => i !== index));
  };

  const moveSigner = (from: number, to: number) => {
    setSigners((prev) => {
      if (
        from < 0 ||
        from >= prev.length ||
        to < 0 ||
        to >= prev.length ||
        from === to
      ) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  // Drag-to-reorder for the signer rows, following the place-fields
  // pattern: pointer events on a grip handle, so mouse and touch both
  // work. The dragged row stays in place (dimmed) and the row the
  // pointer is over gets an insertion line until the drop commits.
  // Keyboard users get the same reorder from the up/down buttons on
  // each row.
  const rowRefs = useRef(new Map<number, HTMLDivElement>());
  const dragStart = useRef<{ from: number } | null>(null);
  const [dragReorder, setDragReorder] = useState<{
    from: number;
    over: number;
  } | null>(null);

  const reorderTarget = (clientY: number): number => {
    let target = signers.length - 1;
    for (let i = 0; i < signers.length; i++) {
      const rect = rowRefs.current.get(i)?.getBoundingClientRect();
      if (!rect) continue;
      if (clientY < rect.top + rect.height / 2) {
        target = i;
        break;
      }
    }
    return target;
  };

  const onReorderPointerDown = (
    e: React.PointerEvent<HTMLSpanElement>,
    index: number,
  ) => {
    e.preventDefault();
    // Pointer capture keeps the drag tracking if the pointer leaves
    // the handle mid-drag; not every environment implements it.
    const target = e.currentTarget as HTMLSpanElement & {
      setPointerCapture?: (id: number) => void;
    };
    target.setPointerCapture?.(e.pointerId);
    dragStart.current = { from: index };
    setDragReorder({ from: index, over: index });
  };

  const onReorderPointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!dragStart.current) return;
    setDragReorder((prev) => {
      if (!prev) return prev;
      const over = reorderTarget(e.clientY);
      return over === prev.over ? prev : { ...prev, over };
    });
  };

  const onReorderPointerUp = () => {
    const start = dragStart.current;
    const drag = dragReorder;
    dragStart.current = null;
    setDragReorder(null);
    if (!start || !drag) return;
    if (drag.over !== start.from) moveSigner(start.from, drag.over);
  };

  const onReorderPointerCancel = () => {
    dragStart.current = null;
    setDragReorder(null);
  };

  const submitStep1 = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = effectiveSigners.map((s) => ({
      name: s.name.trim(),
      email: s.email.trim(),
    }));
    if (cleaned.some((s) => !s.email)) {
      setError("Every signer needs an email - the signer is emailed their signing link and the document to sign.");
      return;
    }
    if (includeMe && !senderEmail.trim()) {
      setError("Enter your email to add yourself as a signer.");
      return;
    }
    if (intake === "file" && !draft && !file) return;
    setError("");
    setWorking(true);
    try {
      if (draft) {
        // Editing a resumed draft: the file is already uploaded, so
        // step 1 only patches the details.
        const updated = await patchDocument(
          draft.id,
          {
            title: title.trim(),
            signing_mode: signingMode,
            photo_required: photoRequired,
            signers: cleaned,
          },
          getDraftToken(draft.id)
        );
        setDraft(updated);
        goStep(2, draft.id);
      } else {
        const created =
          intake === "file"
            ? await uploadDocument(
                file!,
                title.trim(),
                senderEmail.trim(),
                signingMode,
                photoRequired,
                cleaned
              )
            : await createDocumentFromUrl(
                pageUrl.trim(),
                title.trim(),
                senderEmail.trim(),
                signingMode,
                photoRequired,
                cleaned
              );
        if (created.draft_token) {
          setDraftToken(created.id, created.draft_token);
        }
        setDraft(created);
        goStep(2, created.id);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setWorking(false);
    }
  };

  const discard = async () => {
    if (!draft) {
      resetAll();
      return;
    }
    setError("");
    setWorking(true);
    try {
      await discardDraft(draft.id, getDraftToken(draft.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
      setWorking(false);
      return;
    }
    clearDraftToken(draft.id);
    resetAll();
  };

  const resetAll = () => {
    setDraft(null);
    setSessions([]);
    setFields([]);
    setSigners([{ name: "", email: "" }]);
    setIncludeMe(false);
    setSigningMode("parallel");
    setPhotoRequired(false);
    setFile(null);
    setPageUrl("");
    setTitle("");
    setWorking(false);
    goStep(1);
  };

  const send = async () => {
    if (!draft) return;
    setError("");
    setWorking(true);
    try {
      const result = await sendDocument(draft.id, getDraftToken(draft.id));
      setSessions(result.sessions);
      setSendResult(draft.id, result.sessions);
      clearDraftToken(draft.id);
      goStep("done", null, draft.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setWorking(false);
    }
  };

  const copyLink = async (sess: SessionInfo) => {
    await navigator.clipboard.writeText(sess.signing_url);
    setCopiedId(sess.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const fieldCountFor = (index: number) =>
    fields.filter((f) => f.signer_index === index).length;

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "0.65rem 0.8rem",
    border: "1px solid #d1d5db",
    borderRadius: 8,
    fontSize: "1rem",
    boxSizing: "border-box",
  };

  const stepLabel =
    step === 1
      ? "Step 1 of 3 - Signers & document"
      : step === 2
        ? "Step 2 of 3 - Place fields (optional)"
        : step === 3
          ? "Step 3 of 3 - Review & send"
          : "Sent";

  // Both the session check and the draft resume must have settled
  // before any step renders; otherwise a resume to step 2 or 3
  // flashes the step-1 form first (#153).
  const ready = accountLoaded && resumeChecked;

  return (
    <main
      style={{
        maxWidth: 640,
        margin: "0 auto",
        padding: "2rem 1.25rem",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <AuthBrandHeader />
      <h1 style={{ fontSize: "1.75rem", marginBottom: "0.25rem" }}>
        Send a document for signature
      </h1>
      <p style={{ opacity: 0.65, marginTop: 0, marginBottom: "0.5rem" }}>
        {step === "done"
          ? "Your document is on its way - each signer was emailed their signing link and the document to sign."
          : "Upload a PDF, place fields if you want them, review, then send. Nothing is emailed until you press Send in step 3."}
      </p>
      {ready && (
        <p style={{ fontSize: "0.9rem", fontWeight: 600, marginTop: 0, marginBottom: "1rem" }}>
          {stepLabel}
          {draft && step !== "done" && (
            <span style={{ fontWeight: 400, opacity: 0.6 }}>
              {" "}· Draft saved - refreshing resumes here.
            </span>
          )}
        </p>
      )}
      {!ready ? (
        <p style={{ fontSize: "0.9rem", opacity: 0.7, marginTop: "-1rem", marginBottom: "1.5rem" }}>
          Loading…
        </p>
      ) : accountEmail ? (
        <p style={{ fontSize: "0.9rem", opacity: 0.7, marginTop: "-1rem", marginBottom: "1.5rem" }}>
          Signed in as {accountEmail} - this document will appear in your{" "}
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

      {ready && step === 1 && (
        <form onSubmit={submitStep1} style={{ display: "grid", gap: "1rem" }}>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {(["file", "url"] as Intake[]).map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={!!draft}
                onClick={() => setIntake(mode)}
                style={{
                  flex: 1,
                  padding: "0.6rem",
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                  background: intake === mode ? "#111827" : "#fff",
                  color: intake === mode ? "#fff" : "inherit",
                  cursor: draft ? "not-allowed" : "pointer",
                  fontWeight: 600,
                  opacity: draft ? 0.5 : 1,
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

          <fieldset
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              padding: "1rem",
              display: "grid",
              gap: "0.75rem",
              margin: 0,
            }}
          >
            <legend style={{ fontWeight: 600, padding: "0 0.35rem" }}>
              Signers
            </legend>
            {signers.map((signer, i) => (
              <div
                key={i}
                data-testid="signer-row"
                ref={(el) => {
                  if (el) rowRefs.current.set(i, el);
                  else rowRefs.current.delete(i);
                }}
                style={{
                  display: "grid",
                  gap: "0.5rem",
                  opacity: dragReorder && dragReorder.from === i ? 0.55 : 1,
                  boxShadow:
                    dragReorder &&
                    dragReorder.over === i &&
                    dragReorder.over !== dragReorder.from
                      ? "inset 0 2px 0 #2563eb"
                      : "none",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  {signingMode === "sequential" && (
                    <span
                      data-testid={`reorder-handle-${i}`}
                      aria-label={`Drag to reorder signer ${i + 1}`}
                      title="Drag to reorder"
                      onPointerDown={(e) => onReorderPointerDown(e, i)}
                      onPointerMove={onReorderPointerMove}
                      onPointerUp={onReorderPointerUp}
                      onPointerCancel={onReorderPointerCancel}
                      style={{
                        touchAction: "none",
                        cursor: "grab",
                        padding: "0.2rem 0.4rem",
                        fontSize: "1.1rem",
                        lineHeight: 1,
                        userSelect: "none",
                      }}
                    >
                      ⠿
                    </span>
                  )}
                  <span
                    style={{ fontWeight: 600, fontSize: "0.95rem", flex: 1 }}
                  >
                    Signer {i + 1}
                  </span>
                  {signingMode === "sequential" && (
                    <>
                      <button
                        type="button"
                        onClick={() => moveSigner(i, i - 1)}
                        disabled={i === 0}
                        aria-label={`Move signer ${i + 1} up`}
                        style={{
                          padding: "0.3rem 0.6rem",
                          borderRadius: 8,
                          border: "1px solid #d1d5db",
                          background: "#fff",
                          cursor: i === 0 ? "not-allowed" : "pointer",
                          opacity: i === 0 ? 0.45 : 1,
                        }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveSigner(i, i + 1)}
                        disabled={i === signers.length - 1}
                        aria-label={`Move signer ${i + 1} down`}
                        style={{
                          padding: "0.3rem 0.6rem",
                          borderRadius: 8,
                          border: "1px solid #d1d5db",
                          background: "#fff",
                          cursor:
                            i === signers.length - 1
                              ? "not-allowed"
                              : "pointer",
                          opacity: i === signers.length - 1 ? 0.45 : 1,
                        }}
                      >
                        ↓
                      </button>
                    </>
                  )}
                </div>
                <label style={{ display: "grid", gap: "0.35rem" }}>
                  Signer name <span style={{ opacity: 0.6 }}>(optional)</span>
                  <input
                    style={inputStyle}
                    value={signer.name}
                    onChange={(e) => updateSigner(i, { name: e.target.value })}
                    placeholder="Jane Doe"
                  />
                </label>
                <label style={{ display: "grid", gap: "0.35rem" }}>
                  Signer email <span style={{ opacity: 0.6 }}>(required - the signer is emailed their signing link and the document to sign)</span>
                  <input
                    style={inputStyle}
                    type="email"
                    required
                    value={signer.email}
                    onChange={(e) => updateSigner(i, { email: e.target.value })}
                    placeholder="jane@example.com"
                  />
                </label>
                {signers.length > 1 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => removeSigner(i)}
                      aria-label={`Remove signer ${i + 1}`}
                      style={{
                        padding: "0.4rem 0.8rem",
                        borderRadius: 8,
                        border: "1px solid #d1d5db",
                        background: "#fff",
                        cursor: "pointer",
                      }}
                    >
                      Remove signer {i + 1}
                    </button>
                  </div>
                )}
              </div>
            ))}
            <div>
              <button
                type="button"
                onClick={() =>
                  setSigners((prev) => [...prev, { name: "", email: "" }])
                }
                disabled={!canAddSigner}
                style={{
                  padding: "0.5rem 0.9rem",
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                  background: "#fff",
                  cursor: canAddSigner ? "pointer" : "not-allowed",
                  fontWeight: 600,
                  opacity: canAddSigner ? 1 : 0.55,
                }}
              >
                Add another signer
              </button>
              {!canAddSigner && (
                <p style={{ fontSize: "0.9rem", opacity: 0.7, margin: "0.5rem 0 0" }}>
                  {isPremium
                    ? `The maximum is ${PREMIUM_MAX_SIGNERS} signers per document.`
                    : (
                      <>
                        The free plan allows up to 2 signers - the second
                        signer must be you, via “Send to me for signature”
                        below.{" "}
                        <UpgradeAction
                          loggedIn={accountEmail !== null}
                          onUpgrade={startUpgrade}
                        >
                          Upgrade
                        </UpgradeAction>{" "}
                        for up to 20 signers.
                      </>
                    )}
                </p>
              )}
            </div>
            <label
              style={{
                display: "flex",
                gap: "0.5rem",
                alignItems: "flex-start",
                fontSize: "0.95rem",
                cursor: signers.length >= maxSigners ? "not-allowed" : "pointer",
                opacity: signers.length >= maxSigners ? 0.6 : 1,
              }}
            >
              <input
                type="checkbox"
                checked={includeMe}
                disabled={signers.length >= maxSigners}
                onChange={(e) => setIncludeMe(e.target.checked)}
                style={{ marginTop: "0.2rem" }}
              />
              <span>
                Send to me for signature{" "}
                <span style={{ opacity: 0.6 }}>
                  {signingMode === "sequential"
                    ? "(adds you as a signer - in sequential mode you sign last)"
                    : "(adds you as a signer in parallel mode, no signing order enforced)"}
                </span>
              </span>
            </label>
          </fieldset>

          <label
            style={{
              display: "flex",
              gap: "0.5rem",
              alignItems: "flex-start",
              fontSize: "0.95rem",
              cursor: isPremium ? "pointer" : "not-allowed",
              opacity: isPremium ? 1 : 0.6,
            }}
          >
            <input
              type="checkbox"
              checked={photoRequired}
              disabled={!isPremium}
              onChange={(e) => setPhotoRequired(e.target.checked)}
              style={{ marginTop: "0.2rem" }}
            />
            <span>
              Require a witness photo{" "}
              <span style={{ opacity: 0.6 }}>
                (every signer must attach a photo to complete signing)
              </span>
              {!isPremium && accountLoaded && (
                <>
                  {" Premium feature - "}
                  <UpgradeAction
                    loggedIn={accountEmail !== null}
                    onUpgrade={startUpgrade}
                  >
                    upgrade
                  </UpgradeAction>
                  {" to enable it."}
                </>
              )}
            </span>
          </label>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            Signing order
            <select
              style={inputStyle}
              value={signingMode}
              onChange={(e) => setSigningMode(e.target.value as "sequential" | "parallel")}
            >
              <option value="sequential" disabled={!isPremium}>
                Sequential - signers sign one after another, in order
              </option>
              <option value="parallel">Parallel - all signers can sign in any order</option>
            </select>
            {!isPremium && accountLoaded && (
              <span style={{ fontSize: "0.9rem", opacity: 0.7 }}>
                Sequential order is a premium feature - free documents are
                parallel only.{" "}
                <UpgradeAction
                  loggedIn={accountEmail !== null}
                  onUpgrade={startUpgrade}
                >
                  Upgrade to enable it.
                </UpgradeAction>
              </span>
            )}
          </label>
          {draft ? (
            <p style={{ fontSize: "0.95rem", opacity: 0.75, margin: 0 }}>
              Document already uploaded
              {draft.original_filename ? ` (${draft.original_filename})` : ""} -
              discard the draft to upload a different file.
            </p>
          ) : intake === "file" ? (
            <label style={{ display: "grid", gap: "0.35rem" }}>
              Document{" "}
              <span style={{ opacity: 0.6 }}>
                (PDF, DOC, DOCX - max 25 MB; Word docs convert to PDF)
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
                (rendered to PDF - e.g. a terms page)
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
            disabled={working}
            style={{
              padding: "0.8rem",
              fontSize: "1.05rem",
              fontWeight: 600,
              color: "#fff",
              background: "#111827",
              border: "none",
              borderRadius: 8,
              cursor: working ? "wait" : "pointer",
            }}
          >
            {working
              ? draft
                ? "Saving…"
                : "Creating draft…"
              : draft
                ? "Save changes"
                : "Continue to place fields"}
          </button>
          <button
            type="button"
            onClick={discard}
            disabled={working}
            style={{
              padding: "0.6rem",
              borderRadius: 8,
              border: "1px solid #d1d5db",
              background: "#fff",
              cursor: working ? "wait" : "pointer",
            }}
          >
            {draft ? "Discard draft" : "Start over"}
          </button>
        </form>
      )}

      {ready && step === 2 && draft && (
        <section style={{ display: "grid", gap: "1rem" }}>
          <p style={{ margin: 0, opacity: 0.75 }}>
            Draft saved - no email has been sent yet. Place signature,
            initials, checkbox, text, or date fields on the document, or
            skip ahead: signers sign on a blank page when there are no
            fields.
          </p>
          <p style={{ margin: 0 }}>
            {fields.length === 0
              ? "No fields placed yet."
              : `${fields.length} field${fields.length === 1 ? "" : "s"} placed.`}
          </p>
          <a
            href={`/place-fields/${draft.id}?draft=1`}
            style={{
              display: "block",
              textAlign: "center",
              padding: "0.8rem",
              fontSize: "1.05rem",
              fontWeight: 600,
              color: "#fff",
              background: "#111827",
              borderRadius: 8,
              textDecoration: "none",
            }}
          >
            Place fields
          </a>
          <button
            type="button"
            onClick={() => goStep(3, draft.id)}
            style={{
              padding: "0.8rem",
              fontSize: "1.05rem",
              fontWeight: 600,
              borderRadius: 8,
              border: "1px solid #d1d5db",
              background: "#fff",
              cursor: "pointer",
            }}
          >
            Skip - no fields needed, continue to review
          </button>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => goStep(1, draft.id)}
              style={{
                padding: "0.6rem 0.9rem",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                background: "#fff",
                cursor: "pointer",
              }}
            >
              ← Back to details
            </button>
            <button
              type="button"
              onClick={discard}
              disabled={working}
              style={{
                padding: "0.6rem 0.9rem",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                background: "#fff",
                cursor: working ? "wait" : "pointer",
              }}
            >
              Discard draft
            </button>
          </div>
        </section>
      )}

      {ready && step === 3 && draft && (
        <section style={{ display: "grid", gap: "1rem" }}>
          <div
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              padding: "1.25rem",
              display: "grid",
              gap: "0.5rem",
            }}
          >
            <div>
              <strong>Document:</strong> {draft.title}
              {draft.original_filename ? ` (${draft.original_filename})` : ""}
            </div>
            <div>
              <strong>Your email:</strong> {draft.sender_email}
            </div>
            <div>
              <strong>Signing order:</strong>{" "}
              {draft.signing_mode === "sequential"
                ? "Sequential - signers sign one after another, in order"
                : "Parallel - all signers can sign in any order"}
            </div>
            <div>
              <strong>Witness photo:</strong>{" "}
              {draft.photo_required ? "Required" : "Optional"}
            </div>
            <div>
              <strong>Signers:</strong>
              <ol style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem" }}>
                {(draft.signer_list ?? []).map((s, i) => (
                  <li key={i} style={{ marginBottom: "0.25rem" }}>
                    {s.name ? `${s.name} - ` : ""}
                    {s.email}
                    {` · ${fieldCountFor(i)} field${fieldCountFor(i) === 1 ? "" : "s"}`}
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <strong>Fields placed:</strong> {fields.length}
            </div>
          </div>
          <p style={{ margin: 0, opacity: 0.75 }}>
            Sending creates one signing session per signer, in the order
            above, and emails each signer their link and the document.
          </p>
          <button
            type="button"
            onClick={send}
            disabled={working}
            style={{
              padding: "0.8rem",
              fontSize: "1.05rem",
              fontWeight: 600,
              color: "#fff",
              background: "#111827",
              border: "none",
              borderRadius: 8,
              cursor: working ? "wait" : "pointer",
            }}
          >
            {working ? "Sending…" : "Send document"}
          </button>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <a
              href={`/place-fields/${draft.id}?draft=1`}
              style={{
                padding: "0.6rem 0.9rem",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                background: "#fff",
                cursor: "pointer",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              ← Back to place fields
            </a>
            <button
              type="button"
              onClick={() => goStep(1, draft.id)}
              style={{
                padding: "0.6rem 0.9rem",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                background: "#fff",
                cursor: "pointer",
              }}
            >
              ← Back to details
            </button>
            <button
              type="button"
              onClick={discard}
              disabled={working}
              style={{
                padding: "0.6rem 0.9rem",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                background: "#fff",
                cursor: working ? "wait" : "pointer",
              }}
            >
              Discard draft
            </button>
          </div>
        </section>
      )}

      {ready && step === "done" && sessions.length > 0 && (
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
                ? draft?.signing_mode === "parallel"
                  ? "Signers can sign in any order - the document seals when everyone has signed."
                  : "Signers sign in order - each link activates after the previous signer has signed, and the document seals at the final signature."
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
                {sess.signer_name ? ` - ${sess.signer_name}` : ""}
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
            document to sign. Links expire in 30 days - no account
            needed on their end.
          </p>
          <p style={{ fontSize: "0.95rem", margin: 0 }}>
            <a href="/dashboard">View in dashboard</a>
          </p>
          <button
            onClick={() => {
              if (draft) clearSendResult(draft.id);
              resetAll();
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
