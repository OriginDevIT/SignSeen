"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

export interface SignaturePadHandle {
  clear: () => void;
  isEmpty: () => boolean;
  toDataURL: () => string;
}

/**
 * Touch + mouse signature canvas. Pointer events with touch-action:none
 * make it work with a finger on mobile and a mouse on desktop.
 */
const SignaturePad = forwardRef<SignaturePadHandle>(function SignaturePad(
  _props,
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);

  // Scale the backing store for crisp lines on high-DPI screens, and
  // re-fit whenever the CSS size changes (e.g. phone rotation) so the
  // pointer mapping stays 1:1 with what's displayed. Without the refit,
  // the bitmap stretches and strokes land at a multiple of where the
  // pointer is. Existing ink is preserved across resizes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const fitBackingStore = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      // Stash any ink before resizing (setting width/height clears).
      let prev: HTMLCanvasElement | null = null;
      if (canvas.width !== w || canvas.height !== h) {
        if (hasInk.current && canvas.width > 0 && canvas.height > 0) {
          prev = document.createElement("canvas");
          prev.width = canvas.width;
          prev.height = canvas.height;
          prev.getContext("2d")?.drawImage(canvas, 0, 0);
        }
        canvas.width = w;
        canvas.height = h;
      }
      // setTransform, not scale: resizing resets the transform, and
      // repeated fits must not compound it.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#111827";
      if (prev) {
        // Redraw old ink at its original CSS size, top-left.
        ctx.drawImage(prev, 0, 0, prev.width / dpr, prev.height / dpr);
      }
    };

    fitBackingStore();
    const ro = new ResizeObserver(fitBackingStore);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  const point = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = canvasRef.current?.getContext("2d");
    const { x, y } = point(e);
    ctx?.beginPath();
    ctx?.moveTo(x, y);
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    const { x, y } = point(e);
    ctx?.lineTo(x, y);
    ctx?.stroke();
    hasInk.current = true;
  };

  const onUp = () => {
    drawing.current = false;
  };

  useImperativeHandle(ref, () => ({
    clear() {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      hasInk.current = false;
    },
    isEmpty() {
      return !hasInk.current;
    },
    toDataURL() {
      return canvasRef.current?.toDataURL("image/png") ?? "";
    },
  }));

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      style={{
        touchAction: "none",
        width: "100%",
        height: 200,
        border: "2px dashed #9ca3af",
        borderRadius: 12,
        background: "#ffffff",
        cursor: "crosshair",
        display: "block",
      }}
      aria-label="Draw your signature here"
    />
  );
});

export default SignaturePad;
