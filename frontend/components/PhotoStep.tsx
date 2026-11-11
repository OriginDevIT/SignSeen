"use client";

import { useRef } from "react";
import WitnessCamera from "./WitnessCamera";

interface PhotoStepProps {
  /** Data URL of the attached witness photo, if any. */
  photoUrl: string | null;
  /** Signer consented to having their photo captured. */
  photoConsent: boolean;
  onConsentChange: (consented: boolean) => void;
  /** The in-app camera is open. */
  cameraOpen: boolean;
  /** Open the in-app camera. */
  onTakePhoto: () => void;
  /** A photo was captured or picked; feeds the existing photo flow. */
  onCapturePhoto: (dataUrl: string) => void;
  /** Close the in-app camera without capturing. */
  onCloseCamera: () => void;
  /** The signing link, for the camera's continue-on-your-phone QR. */
  signingUrl: string;
  /**
   * Whether the sender requires a witness photo (#73). Default false:
   * skipping is available. When true, the submit button stays disabled
   * until a photo is attached. #73 drives this from the session; the
   * ceremony needs no other change.
   */
  photoRequired?: boolean;
  /** All required document fields are complete. */
  fieldsComplete: boolean;
  /** Submit the ceremony. */
  onSubmit: () => void;
  /** Style for the submit button (sender branding). */
  submitStyle: React.CSSProperties;
}

const ghostBtn: React.CSSProperties = {
  padding: "0.7rem",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  cursor: "pointer",
  flex: 1,
};

/**
 * The ceremony's "Seen" step: witness photo, consent, submit.
 * There is no upload path: the photo comes from the in-app camera
 * only, and no camera means no photo — a failed camera shows a QR
 * code for the same signing link so the signer can continue on their
 * phone. Skipping is available only while the photo is optional
 * (`photoRequired` false).
 */
export default function PhotoStep({
  photoUrl,
  photoConsent,
  onConsentChange,
  cameraOpen,
  onTakePhoto,
  onCapturePhoto,
  onCloseCamera,
  signingUrl,
  photoRequired = false,
  fieldsComplete,
  onSubmit,
  submitStyle,
}: PhotoStepProps) {
  // Test-only file input: the e2e suite attaches the witness photo
  // through it (the live-camera path has its own spec). No UI in the
  // product triggers it — signers can only use the in-app camera.
  const photoInputRef = useRef<HTMLInputElement>(null);

  const onPhotoPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => onCapturePhoto(reader.result as string);
    reader.readAsDataURL(f);
  };

  const submitBlocked =
    !fieldsComplete || (photoRequired && !photoUrl);
  const submitLabel = photoUrl
    ? "Seal it — submit"
    : photoRequired
      ? "Seal it — submit"
      : "Skip photo & submit";

  return (
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
        data-testid="photo-file-input"
        style={{ display: "none" }}
      />
      {cameraOpen ? (
        <WitnessCamera
          onCapture={(url) => {
            onCapturePhoto(url);
            onCloseCamera();
          }}
          onCancel={onCloseCamera}
          signingUrl={signingUrl}
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
          onChange={(e) => onConsentChange(e.target.checked)}
          style={{ marginTop: "0.2rem" }}
        />
        <span>
          I consent to having my photo captured as a witness to this
          signature. The photo is stamped into the signed document.
        </span>
      </label>
      {photoRequired && !photoUrl && (
        <p style={{ opacity: 0.65, margin: 0, fontSize: "0.9rem" }}>
          A witness photo is required before you can submit.
        </p>
      )}
      <div style={{ display: "flex", gap: "0.75rem" }}>
        <button
          onClick={onTakePhoto}
          disabled={!photoConsent}
          style={{
            ...ghostBtn,
            opacity: photoConsent ? 1 : 0.45,
            cursor: photoConsent ? "pointer" : "not-allowed",
          }}
        >
          {photoUrl ? "Retake" : "Take photo"}
        </button>
        <button
          onClick={onSubmit}
          disabled={submitBlocked}
          style={{
            ...submitStyle,
            flex: 2,
            opacity: submitBlocked ? 0.45 : 1,
            cursor: submitBlocked ? "not-allowed" : "pointer",
          }}
        >
          {submitLabel}
        </button>
      </div>
    </section>
  );
}
