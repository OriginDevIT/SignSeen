"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  captureVideoFrame,
  requestCamera,
  toggleFacing,
  type FacingMode,
} from "../lib/camera";

interface WitnessCameraProps {
  /** A frame was captured; the data URL feeds the existing photo flow. */
  onCapture: (dataUrl: string) => void;
  /** User backed out of the live camera without capturing. */
  onCancel: () => void;
  /** The signing link, for the "continue on your phone" QR code. */
  signingUrl: string;
}

const primaryBtn: React.CSSProperties = {
  padding: "0.7rem",
  fontSize: "1rem",
  fontWeight: 600,
  color: "#fff",
  background: "#111827",
  border: "none",
  borderRadius: 10,
  cursor: "pointer",
  flex: 2,
};

const ghostBtn: React.CSSProperties = {
  padding: "0.7rem",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  cursor: "pointer",
  flex: 1,
};

/**
 * Live in-app camera for the witness photo. Requests the front
 * ("user") camera exactly first and falls back to any camera only
 * when no front camera exists — the file input's capture="user"
 * attribute is only a hint and some phones ignore it. There is no
 * upload path: no camera means no photo. When no camera can be
 * started at all, the component shows a QR code for the same signing
 * link so the signer can continue on their phone. The stream is
 * stopped on capture, on cancel, on a facing-mode switch, and on
 * unmount.
 */
export default function WitnessCamera({
  onCapture,
  onCancel,
  signingUrl,
}: WitnessCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const settledRef = useRef(false);
  const [facing, setFacing] = useState<FacingMode>("user");
  const [starting, setStarting] = useState(true);
  const [failed, setFailed] = useState(false);

  // Latest callback in a ref so an inline parent handler doesn't
  // restart the stream on every render.
  const callbacks = useRef({ onCapture });
  callbacks.current = { onCapture };

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    settledRef.current = false;
    setStarting(true);
    setFailed(false);
    stopStream();

    // A start that never settles (no device answering, a permission
    // prompt left open) must not leave the signer staring at
    // "Starting camera…" forever: show the continue-on-your-phone QR
    // instead. A late grant after the timeout is ignored (stream
    // stopped).
    const timer = window.setTimeout(() => {
      if (cancelled || settledRef.current) return;
      settledRef.current = true;
      stopStream();
      setFailed(true);
      setStarting(false);
    }, 15000);

    (async () => {
      try {
        const stream = await requestCamera(facing);
        if (cancelled || settledRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        settledRef.current = true;
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {});
        }
        if (!cancelled) setStarting(false);
      } catch {
        // Permission denied / no camera / insecure context: show the
        // continue-on-your-phone QR instead of failing silently.
        if (cancelled || settledRef.current) return;
        settledRef.current = true;
        setFailed(true);
        setStarting(false);
      } finally {
        window.clearTimeout(timer);
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stopStream();
    };
  }, [facing, stopStream]);

  const capture = () => {
    const video = videoRef.current;
    const dataUrl = video ? captureVideoFrame(video) : null;
    if (!dataUrl) {
      // No frame to capture — the camera is not really working.
      // Treat it like a failed start: the phone QR is the way on.
      setFailed(true);
      return;
    }
    stopStream();
    callbacks.current.onCapture(dataUrl);
  };

  if (failed) {
    return (
      <div style={{ display: "grid", gap: "0.75rem" }}>
        <p style={{ margin: 0, fontWeight: 600 }}>
          Continue on your phone
        </p>
        <p style={{ margin: 0, opacity: 0.75 }}>
          This device has no camera, so you can&apos;t take a witness photo
          here. Scan the code with your phone to open the same signing
          link and continue signing there — you&apos;ll draw your signature
          on your phone.
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
            justifySelf: "center",
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
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button type="button" onClick={onCancel} style={ghostBtn}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        aria-label="Camera preview"
        style={{
          width: "100%",
          borderRadius: 12,
          maxHeight: 320,
          objectFit: "cover",
          background: "#111827",
          // Mirror the front-camera preview, like every selfie camera;
          // the captured frame itself is stored unmirrored.
          transform: facing === "user" ? "scaleX(-1)" : undefined,
        }}
      />
      {starting && (
        <p style={{ textAlign: "center", opacity: 0.6, margin: 0 }}>
          Starting camera…
        </p>
      )}
      <div style={{ display: "flex", gap: "0.75rem" }}>
        <button
          type="button"
          onClick={() => setFacing((f) => toggleFacing(f))}
          style={ghostBtn}
        >
          Switch camera
        </button>
        <button type="button" onClick={onCancel} style={ghostBtn}>
          Cancel
        </button>
        <button
          type="button"
          onClick={capture}
          disabled={starting}
          style={{ ...primaryBtn, opacity: starting ? 0.5 : 1 }}
        >
          Capture photo
        </button>
      </div>
    </div>
  );
}
