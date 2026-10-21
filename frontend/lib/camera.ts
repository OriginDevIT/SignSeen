/** Helpers for the Seen-step in-app camera (getUserMedia).
 *
 * The witness photo used to rely on `<input capture="user">`, which is
 * only a hint — some phones open the rear camera anyway. These helpers
 * drive a real in-app camera that defaults to the front ("user")
 * camera. Pure/structural where possible so they can be unit-tested
 * without a device; nothing here touches `navigator` at module level,
 * so importing is safe during SSR and in tests.
 */

export type FacingMode = "user" | "environment";

/** Stream constraints for a facing mode: video only, no audio. */
export function cameraConstraints(facing: FacingMode): MediaStreamConstraints {
  return { audio: false, video: { facingMode: facing } };
}

/** The other camera (for the switch-camera control). */
export function toggleFacing(facing: FacingMode): FacingMode {
  return facing === "user" ? "environment" : "user";
}

/** True when an in-app camera is available in this browser/context.
 * getUserMedia also requires a secure context; callers treat false (or
 * a rejected request) as "use the file-picker fallback instead". */
export function isCameraSupported(): boolean {
  try {
    return (
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function"
    );
  } catch {
    return false;
  }
}

/** Draw the video's current frame to a canvas and return it as a JPEG
 * data URL (the shape the sign endpoint accepts), or null when there
 * is no frame to capture yet. */
export function captureVideoFrame(video: HTMLVideoElement): string | null {
  if (typeof document === "undefined") return null;
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.92);
}
