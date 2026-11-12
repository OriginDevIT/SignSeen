"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  ApiError,
  createDocumentField,
  deleteDocumentField,
  fetchDocumentPageImageUrl,
  getDocument,
  getDocumentFields,
  type DocumentFieldInfo,
  type DocumentInfo,
  type FieldType,
} from "../../../lib/api";
import {
  boxTooSmall,
  fieldBox,
  isClick,
  normalizeBox,
} from "../../../lib/fieldBox";

const FIELD_TYPES: FieldType[] = ["signature", "initials", "checkbox", "text", "date"];

const shell: React.CSSProperties = {
  maxWidth: 760,
  margin: "0 auto",
  padding: "2rem 1.25rem",
  fontFamily: "system-ui, sans-serif",
};

const inputStyle: React.CSSProperties = {
  padding: "0.55rem 0.7rem",
  border: "1px solid #d1d5db",
  borderRadius: 8,
  fontSize: "1rem",
  boxSizing: "border-box",
};

export default function PlaceFieldsPage() {
  const params = useParams();
  const docId = params.docId as string;

  const [doc, setDoc] = useState<DocumentInfo | null>(null);
  const [fields, setFields] = useState<DocumentFieldInfo[]>([]);
  const [pageCount, setPageCount] = useState(1);
  const [page, setPage] = useState(1);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [fieldType, setFieldType] = useState<FieldType>("signature");
  const [sessionId, setSessionId] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // In-progress drag, as normalized corner points. The drag start (in
  // client pixels, for the click test) lives in a ref so pointerup can
  // read the end point from its own event instead of stale state.
  const [draft, setDraft] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragStart = useRef<{
    clientX: number;
    clientY: number;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    Promise.all([getDocument(docId), getDocumentFields(docId)])
      .then(([d, f]) => {
        setDoc(d);
        setFields(f.fields);
        setPageCount(f.page_count);
        if (d.sessions && d.sessions.length > 0) {
          setSessionId(d.sessions[0].id);
        }
      })
      .catch((err) => {
        setLoadError(
          err instanceof ApiError && (err.status === 401 || err.status === 403)
            ? "Field placement is only available to the document's owner — log in with the account that sent this document."
            : "Could not load this document's fields."
        );
      });
  }, [docId]);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    fetchDocumentPageImageUrl(docId, page)
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        url = u;
        setImgUrl(u);
      })
      .catch(() => setImgUrl(null));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [docId, page]);

  const signerLabel = (sid: string): string => {
    const s = doc?.sessions?.find((x) => x.id === sid);
    if (!s) return "Unknown signer";
    return `Signer ${s.order + 1}${s.signer_name ? ` — ${s.signer_name}` : ""}`;
  };

  const pageFields = fields.filter((f) => f.page === page);

  const pointFromEvent = (e: React.PointerEvent) => {
    const el = imgRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      clientX: e.clientX,
      clientY: e.clientY,
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  };

  const placeField = async (
    x: number,
    y: number,
    width?: number,
    height?: number
  ) => {
    setError("");
    if (!sessionId) {
      setError("Add a signer to this document before placing fields.");
      return;
    }
    try {
      const field = await createDocumentField(docId, {
        session_id: sessionId,
        type: fieldType,
        page,
        x: Math.round(x * 10000) / 10000,
        y: Math.round(y * 10000) / 10000,
        ...(width !== undefined && height !== undefined
          ? {
              width: Math.round(width * 10000) / 10000,
              height: Math.round(height * 10000) / 10000,
            }
          : {}),
      });
      setFields((prev) => [...prev, field]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not place the field.");
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLImageElement>) => {
    const p = pointFromEvent(e);
    if (!p) return;
    setError("");
    if (!sessionId) {
      setError("Add a signer to this document before placing fields.");
      return;
    }
    dragStart.current = p;
    setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    // Pointer capture keeps the drag tracking if the pointer leaves
    // the image mid-drag; not every environment implements it.
    const target = e.currentTarget as HTMLImageElement & {
      setPointerCapture?: (id: number) => void;
    };
    target.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLImageElement>) => {
    const start = dragStart.current;
    if (!start) return;
    const p = pointFromEvent(e);
    if (!p) return;
    setDraft({ x0: start.x, y0: start.y, x1: p.x, y1: p.y });
  };

  const onPointerUp = async (e: React.PointerEvent<HTMLImageElement>) => {
    const start = dragStart.current;
    dragStart.current = null;
    setDraft(null);
    if (!start) return;
    const end = pointFromEvent(e);
    if (!end) return;
    if (isClick(start.clientX, start.clientY, end.clientX, end.clientY)) {
      // A click: select the box under the pointer, if any; otherwise
      // place a default-size field at that point.
      const hit = [...pageFields].reverse().find((f) => {
        const b = fieldBox(f);
        return (
          b !== null &&
          start.x >= b.x &&
          start.x <= b.x + b.width &&
          start.y >= b.y &&
          start.y <= b.y + b.height
        );
      });
      if (hit) {
        setSelectedId(hit.id);
        return;
      }
      setSelectedId(null);
      await placeField(start.x, start.y);
      return;
    }
    const box = normalizeBox(start.x, start.y, end.x, end.y);
    if (boxTooSmall(box)) {
      setError("That box is too small — drag a larger one.");
      return;
    }
    setSelectedId(null);
    await placeField(box.x, box.y, box.width, box.height);
  };

  const onPointerCancel = () => {
    dragStart.current = null;
    setDraft(null);
  };

  const onDelete = async (field: DocumentFieldInfo) => {
    setError("");
    try {
      await deleteDocumentField(docId, field.id);
      setFields((prev) => prev.filter((f) => f.id !== field.id));
      setSelectedId((prev) => (prev === field.id ? null : prev));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete the field.");
    }
  };

  if (loadError) {
    return (
      <main style={shell}>
        <h1 style={{ fontSize: "1.5rem" }}>Place fields</h1>
        <p style={{ opacity: 0.7 }}>{loadError}</p>
        <p>
          <a href="/login">Log in</a> · <a href="/send">Back to send</a>
        </p>
      </main>
    );
  }

  if (!doc) {
    return (
      <main style={shell}>
        <p style={{ opacity: 0.6 }}>Loading…</p>
      </main>
    );
  }

  const draftBox = draft ? normalizeBox(draft.x0, draft.y0, draft.x1, draft.y1) : null;

  return (
    <main style={shell}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>
        Place fields — {doc.title}
      </h1>
      <p style={{ opacity: 0.65, marginTop: 0 }}>
        Signing mode: {doc.signing_mode}. Pick a field type and the signer it
        belongs to, then drag on the page to draw a box where the field goes
        — or click to place a default-size field. Each signer only ever
        sees their own fields.
      </p>

      {error && (
        <p style={{ background: "#fef2f2", color: "#b91c1c", padding: "0.75rem 1rem", borderRadius: 8 }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <label style={{ display: "grid", gap: "0.3rem", flex: 1, minWidth: 160 }}>
          Field type
          <select
            style={inputStyle}
            value={fieldType}
            onChange={(e) => setFieldType(e.target.value as FieldType)}
          >
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: "0.3rem", flex: 1, minWidth: 200 }}>
          Assigned signer
          <select
            style={inputStyle}
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
          >
            {(doc.sessions ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                Signer {s.order + 1}
                {s.signer_name ? ` — ${s.signer_name}` : ""}
                {s.signer_email ? ` (${s.signer_email})` : ""}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "end" }}>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            style={{ ...inputStyle, background: "#fff", cursor: "pointer" }}
          >
            ← Prev
          </button>
          <span style={{ padding: "0.55rem 0" }}>
            Page {page} of {pageCount}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={page >= pageCount}
            style={{ ...inputStyle, background: "#fff", cursor: "pointer" }}
          >
            Next →
          </button>
        </div>
      </div>

      <div
        style={{
          position: "relative",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {imgUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={imgRef}
            src={imgUrl}
            alt={`Document page ${page}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            draggable={false}
            style={{
              width: "100%",
              display: "block",
              cursor: "crosshair",
              touchAction: "none",
            }}
          />
        ) : (
          <p style={{ padding: "2rem", textAlign: "center", opacity: 0.6 }}>
            Loading page…
          </p>
        )}
        {draftBox && (
          <div
            data-testid="field-draft"
            style={{
              position: "absolute",
              left: `${draftBox.x * 100}%`,
              top: `${draftBox.y * 100}%`,
              width: `${draftBox.width * 100}%`,
              height: `${draftBox.height * 100}%`,
              border: "2px solid #2563eb",
              background: "rgba(37, 99, 235, 0.12)",
              pointerEvents: "none",
            }}
          />
        )}
        {pageFields.map((f) => {
          const b = fieldBox(f);
          const signerNo =
            (doc.sessions?.find((s) => s.id === f.session)?.order ?? 0) + 1;
          if (b === null) {
            // Click-placed field: no stored size, marker pill as before.
            return (
              <div
                key={f.id}
                title={`${f.type} — ${signerLabel(f.session)}`}
                style={{
                  position: "absolute",
                  left: `${f.x * 100}%`,
                  top: `${f.y * 100}%`,
                  transform: "translate(-2px, -50%)",
                  background: "#111827",
                  color: "#fff",
                  fontSize: "0.7rem",
                  padding: "0.15rem 0.45rem",
                  borderRadius: 999,
                  pointerEvents: "none",
                  whiteSpace: "nowrap",
                }}
              >
                {f.type} · S{signerNo}
              </div>
            );
          }
          const selected = f.id === selectedId;
          return (
            <div
              key={f.id}
              title={`${f.type} — ${signerLabel(f.session)}`}
              data-testid="field-box"
              style={{
                position: "absolute",
                left: `${b.x * 100}%`,
                top: `${b.y * 100}%`,
                width: `${b.width * 100}%`,
                height: `${b.height * 100}%`,
                border: selected ? "2px solid #2563eb" : "2px solid #111827",
                background: selected
                  ? "rgba(37, 99, 235, 0.15)"
                  : "rgba(17, 24, 39, 0.08)",
                borderRadius: 2,
                pointerEvents: "none",
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  display: "block",
                  background: "#111827",
                  color: "#fff",
                  fontSize: "0.7rem",
                  padding: "0.1rem 0.4rem",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {f.type} · S{signerNo}
              </span>
            </div>
          );
        })}
      </div>

      <h2 style={{ fontSize: "1.15rem", marginTop: "1.5rem" }}>
        Placed fields ({fields.length})
      </h2>
      {fields.length === 0 ? (
        <p style={{ opacity: 0.65 }}>
          No fields yet — drag on the page to draw a box, or click to place
          a default-size one.
        </p>
      ) : (
        <div style={{ display: "grid", gap: "0.5rem" }}>
          {fields.map((f) => (
            <div
              key={f.id}
              onClick={() => setSelectedId(f.id)}
              style={{
                display: "flex",
                gap: "0.75rem",
                alignItems: "center",
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                padding: "0.6rem 0.8rem",
                background: f.id === selectedId ? "#eff6ff" : "#fff",
                cursor: "pointer",
              }}
            >
              <span style={{ fontWeight: 600, textTransform: "capitalize" }}>{f.type}</span>
              <span style={{ opacity: 0.7 }}>
                page {f.page} · ({f.x.toFixed(2)}, {f.y.toFixed(2)})
                {f.width != null && f.height != null
                  ? ` · ${f.width.toFixed(2)} × ${f.height.toFixed(2)}`
                  : ""}
                {" · "}
                {signerLabel(f.session)}
                {f.required ? " · required" : " · optional"}
                {f.completed ? " · completed" : ""}
              </span>
              <span style={{ flex: 1 }} />
              <button
                onClick={() => onDelete(f)}
                disabled={f.completed}
                style={{
                  padding: "0.35rem 0.7rem",
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                  background: "#fff",
                  cursor: f.completed ? "not-allowed" : "pointer",
                  opacity: f.completed ? 0.45 : 1,
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
      <p style={{ marginTop: "1.5rem" }}>
        <a href="/send">← Back to send</a>
      </p>
    </main>
  );
}
