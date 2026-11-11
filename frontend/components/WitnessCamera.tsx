"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  captureVideoFrame,
  requestCamera,
  toggleFacing,
  type FacingMode,
} from "../lib/camera";

interface WitnessCameraProps {
  /** A frame was captured; the data URL feeds the existing photo flow. */
  onCapture: (dataUrl: string) => void;
  /** Camera unavailable or permission denied: use the file picker. */
  onFallback: () => void;
  /** User backed out of the live camera without capturing. */
  onCancel: () => void;
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
 * attribute is only a hint and some phones ignore it. When no camera
 * can be started at all, the component says so and offers the
 * file-upload fallback instead of failing silently. The stream is
 * stopped on capture, on cancel, on a facing-mode switch, and on
 * unmount.
 */
export default function WitnessCamera({
  onCapture,
  onFallback,
  onCancel,
}: WitnessCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const settledRef = useRef(false);
  const [facing, setFacing] = useState<FacingMode>("user");
  const [starting, setStarting] = useState(true);
  const [failed, setFailed] = useState(false);

  // Latest callbacks in a ref so inline parent handlers don't restart
  // the stream on every render.
  const callbacks = useRef({ onCapture, onFallback });
  callbacks.current = { onCapture, onFallback };

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
    // "Starting camera…" forever: surface the upload fallback instead.
    // A late grant after the timeout is ignored (stream stopped).
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
        // upload fallback instead of failing silently. The fallback
        // button is a real control, so opening the file picker from
        // it is a user gesture and always produces a visible picker.
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
      callbacks.current.onFallback();
      return;
    }
    stopStream();
    callbacks.current.onCapture(dataUrl);
  };

  if (failed) {
    return (
      <div style={{ display: "grid", gap: "0.75rem" }}>
        <p
          style={{
            margin: 0,
            background: "#fef3c7",
            padding: "0.75rem 1rem",
            borderRadius: 8,
          }}
        >
          Camera isn&apos;t available on this device. You can upload a photo
          instead — it works the same as a witness photo.
        </p>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button type="button" onClick={onCancel} style={ghostBtn}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => callbacks.current.onFallback()}
            style={{ ...primaryBtn, flex: 2 }}
          >
            Upload a photo instead
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
