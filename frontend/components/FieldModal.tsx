"use client";

import { useEffect, useRef, useState } from "react";
import SignaturePad, { type SignaturePadHandle } from "./SignaturePad";
import { signaturePadHeight } from "../lib/fieldBox";
import type { DocumentFieldInfo } from "../lib/api";

interface FieldModalProps {
  field: DocumentFieldInfo;
  /** Rendered page aspect (width/height) - sizes the draw pad to
   * the field's drawn box. */
  pageAspect: number;
  /** A signature already drawn elsewhere in this ceremony, offered
   * for reuse in signature fields. */
  savedSignature: string | null;
  /** An initials image already drawn elsewhere, offered for reuse
   * in initials fields. */
  savedInitials: string | null;
  initialValue: string | boolean | undefined;
  onSave: (value: string | boolean) => void;
  onClose: () => void;
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(17, 24, 39, 0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "1rem",
  zIndex: 50,
};

const dialogStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  padding: "1.25rem",
  width: "100%",
  maxWidth: 480,
  maxHeight: "90vh",
  overflowY: "auto",
  boxSizing: "border-box",
  fontFamily: "system-ui, sans-serif",
};

const ghostBtn: React.CSSProperties = {
  padding: "0.7rem",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  cursor: "pointer",
  width: "100%",
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

/** One field's widget in a modal, opened by tapping the field on the
 * document preview. Signature/initials fields get a draw pad (plus a
 * reuse offer when one was already drawn); checkbox, text and date
 * get their own input and a Done button. Saving closes the modal. */
export default function FieldModal({
  field,
  pageAspect,
  savedSignature,
  savedInitials,
  initialValue,
  onSave,
  onClose,
}: FieldModalProps) {
  const isDrawn = field.type === "signature" || field.type === "initials";
  const saved = field.type === "signature" ? savedSignature : savedInitials;
  const [drawnValue, setDrawnValue] = useState<string | null>(
    typeof initialValue === "string" && initialValue ? initialValue : null
  );
  const [textValue, setTextValue] = useState(
    typeof initialValue === "string" ? initialValue : ""
  );
  const [dateValue, setDateValue] = useState(
    typeof initialValue === "string" && initialValue
      ? initialValue
      : new Date().toISOString().slice(0, 10)
  );
  const [checked, setChecked] = useState(initialValue === true);
  const padRef = useRef<SignaturePadHandle>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const capturePad = () => {
    const pad = padRef.current;
    if (!pad || pad.isEmpty()) return;
    onSave(pad.toDataURL());
  };

  const title = `${field.type.charAt(0).toUpperCase() + field.type.slice(1)} - page ${field.page}`;

  return (
    <div
      style={overlayStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={dialogStyle}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "0.75rem",
          }}
        >
          <h3 style={{ margin: 0, textTransform: "capitalize" }}>{title}</h3>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              fontSize: "1.4rem",
              lineHeight: 1,
              cursor: "pointer",
              padding: "0.25rem 0.5rem",
            }}
          >
            ×
          </button>
        </div>
        <p style={{ opacity: 0.65, margin: "0 0 1rem" }}>
          Complete it here - it will be stamped on the document where the
          box sits.
        </p>

        {isDrawn &&
          (drawnValue ? (
            <div style={{ display: "grid", gap: "0.75rem" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={drawnValue}
                alt={`${field.type} preview`}
                style={{
                  maxHeight: 120,
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                  justifySelf: "start",
                }}
              />
              <button
                type="button"
                onClick={() => setDrawnValue(null)}
                style={ghostBtn}
              >
                Redo
              </button>
              <button
                type="button"
                onClick={() => onSave(drawnValue)}
                style={primaryBtn}
              >
                Done
              </button>
            </div>
          ) : (
            <div style={{ display: "grid", gap: "0.75rem" }}>
              {saved && (
                <button
                  type="button"
                  onClick={() => onSave(saved)}
                  style={ghostBtn}
                >
                  Use your {field.type === "signature" ? "signature" : "initials"}
                </button>
              )}
              <SignaturePad
                ref={padRef}
                height={signaturePadHeight(
                  field.width,
                  field.height,
                  pageAspect
                )}
              />
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <button
                  type="button"
                  onClick={() => padRef.current?.clear()}
                  style={{ ...ghostBtn, flex: 1 }}
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={capturePad}
                  style={{ ...primaryBtn, flex: 2 }}
                >
                  Use this {field.type}
                </button>
              </div>
            </div>
          ))}

        {field.type === "checkbox" && (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <label
              style={{
                display: "flex",
                gap: "0.5rem",
                alignItems: "center",
                cursor: "pointer",
                fontSize: "1.05rem",
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
              />
              Check the box
            </label>
            <button
              type="button"
              onClick={() => onSave(checked)}
              style={primaryBtn}
            >
              Done
            </button>
          </div>
        )}

        {field.type === "text" && (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <input
              type="text"
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              placeholder="Type here"
              autoFocus
              style={{
                padding: "0.65rem 0.8rem",
                border: "1px solid #d1d5db",
                borderRadius: 8,
                fontSize: "1rem",
                boxSizing: "border-box",
                width: "100%",
              }}
            />
            <button
              type="button"
              onClick={() => onSave(textValue)}
              style={primaryBtn}
            >
              Done
            </button>
          </div>
        )}

        {field.type === "date" && (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <input
              type="date"
              value={dateValue}
              onChange={(e) => setDateValue(e.target.value)}
              style={{
                padding: "0.65rem 0.8rem",
                border: "1px solid #d1d5db",
                borderRadius: 8,
                fontSize: "1rem",
                boxSizing: "border-box",
                width: "100%",
              }}
            />
            <button
              type="button"
              onClick={() => onSave(dateValue)}
              style={primaryBtn}
            >
              Done
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          style={{ ...ghostBtn, marginTop: "0.75rem" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
