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

  // Scale the backing store for crisp lines on high-DPI screens.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#111827";
    }
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
