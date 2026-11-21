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
  getDraftToken,
  updateDocumentField,
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

/** The toolbar selects shrink to their share of the row and truncate
 * long labels instead of pushing the page navigation off the row. */
const toolbarSelectStyle: React.CSSProperties = {
  ...inputStyle,
  width: "100%",
  minWidth: 0,
  textOverflow: "ellipsis",
};

// A drag on the page is one of three gestures: drawing a new box on
// empty canvas, moving a placed box, or selecting a completed box
// (which cannot move). The drag start (in client pixels, for the
// click test) lives in a ref so pointerup can read the end point from
// its own event instead of stale state.
type DragState =
  | {
      kind: "draw";
      clientX: number;
      clientY: number;
      x: number;
      y: number;
    }
  | {
      kind: "move";
      field: DocumentFieldInfo;
      grabDx: number;
      grabDy: number;
      clientX: number;
      clientY: number;
    }
  | { kind: "select"; field: DocumentFieldInfo };

export default function PlaceFieldsPage() {
  const params = useParams();
  const docId = params.docId as string;

  const [doc, setDoc] = useState<DocumentInfo | null>(null);
  const [fields, setFields] = useState<DocumentFieldInfo[]>([]);
  const [pageCount, setPageCount] = useState(1);
  const [page, setPage] = useState(1);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [fieldType, setFieldType] = useState<FieldType>("signature");
  // Session mode (sent document): the session id the field belongs
  // to. Draft mode (#89): the signer slot in the draft's signer list,
  // held as a string so one select serves both.
  const [sessionId, setSessionId] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // True when this visit is step 2 of the send wizard
  // (/place-fields/<id>?draft=1): exits lead back to the wizard,
  // never to a blank form.
  const [inWizard] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("draft") === "1"
  );
  // The anonymous sender's draft credential (#89), keyed by draft id.
  const draftToken = getDraftToken(docId);

  // A draft has a signer list and no sessions yet: fields are
  // assigned to a signer slot (signer_index) and linked to the
  // session for that slot at send time. A sent document keeps the
  // session assignment from before.
  const isDraft =
    doc !== null &&
    doc.status === "draft" &&
    Array.isArray(doc.signer_list) &&
    doc.signer_list.length > 0;
  // In-progress draw, as normalized corner points.
  const [draft, setDraft] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  // Live position of the box being moved (rendered in place of the
  // stored position until the drop persists).
  const [moveDraft, setMoveDraft] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const drag = useRef<DragState | null>(null);

  useEffect(() => {
    Promise.all([
      getDocument(docId, draftToken),
      getDocumentFields(docId, draftToken),
    ])
      .then(([d, f]) => {
        setDoc(d);
        setFields(f.fields);
        setPageCount(f.page_count);
        if (d.sessions && d.sessions.length > 0) {
          setSessionId(d.sessions[0].id);
        } else if (
          d.status === "draft" &&
          Array.isArray(d.signer_list) &&
          d.signer_list.length > 0
        ) {
          // Draft mode: the first signer slot is the default.
          setSessionId("0");
        }
      })
      .catch((err) => {
        setLoadError(
          err instanceof ApiError && (err.status === 401 || err.status === 403)
            ? draftToken || inWizard
              ? "Could not open this draft — return to the send flow and continue from step 2."
              : "Field placement is only available to the document's owner — log in with the account that sent this document."
            : "Could not load this document's fields."
        );
      });
  }, [docId]);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    fetchDocumentPageImageUrl(docId, page, draftToken)
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

  const signerLabel = (field: DocumentFieldInfo): string => {
    if (field.session) {
      const s = doc?.sessions?.find((x) => x.id === field.session);
      if (!s) return "Unknown signer";
      return `Signer ${s.order + 1}${s.signer_name ? ` — ${s.signer_name}` : ""}`;
    }
    const slot = doc?.signer_list?.[field.signer_index];
    if (!slot) return "Unknown signer";
    return `Signer ${field.signer_index + 1}${slot.name ? ` — ${slot.name}` : ""}`;
  };

  /** Full option label for a session, including its email — shown in
   * the dropdown and as the select's tooltip; the select itself
   * truncates it with an ellipsis. */
  const signerOptionLabel = (s: NonNullable<DocumentInfo["sessions"]>[number]): string =>
    `Signer ${s.order + 1}${s.signer_name ? ` — ${s.signer_name}` : ""}${
      s.signer_email ? ` (${s.signer_email})` : ""
    }`;

  /** Full option label for a draft signer slot. */
  const draftSignerOptionLabel = (index: number): string => {
    const slot = doc?.signer_list?.[index];
    if (!slot) return `Signer ${index + 1}`;
    return `Signer ${index + 1}${slot.name ? ` — ${slot.name}` : ""} (${slot.email})`;
  };

  const selectedSession = isDraft
    ? undefined
    : doc?.sessions?.find((x) => x.id === sessionId);
  const selectedSignerLabel = isDraft
    ? draftSignerOptionLabel(Number(sessionId) || 0)
    : selectedSession
      ? signerOptionLabel(selectedSession)
      : undefined;

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
      rect,
    };
  };

  /** Topmost field under the pointer, if any — a drawn box by
   * containment, a click-placed marker by a finger-sized radius
   * around its anchor. grabDx/grabDy is the pointer's offset from
   * the box origin (0 for a marker, whose anchor follows the
   * pointer), so a move drags the box without it jumping. */
  const hitField = (p: NonNullable<ReturnType<typeof pointFromEvent>>) => {
    for (const f of [...pageFields].reverse()) {
      const b = fieldBox(f);
      if (b !== null) {
        if (
          p.x >= b.x &&
          p.x <= b.x + b.width &&
          p.y >= b.y &&
          p.y <= b.y + b.height
        ) {
          return { field: f, grabDx: p.x - b.x, grabDy: p.y - b.y };
        }
      } else {
        const ax = p.rect.left + f.x * p.rect.width;
        const ay = p.rect.top + f.y * p.rect.height;
        if (Math.abs(p.clientX - ax) <= 16 && Math.abs(p.clientY - ay) <= 16) {
          return { field: f, grabDx: 0, grabDy: 0 };
        }
      }
    }
    return null;
  };

  const placeField = async (
    x: number,
    y: number,
    width?: number,
    height?: number
  ) => {
    setError("");
    if (!sessionId) {
      setError(
        isDraft
          ? "Add a signer to this draft before placing fields."
          : "Add a signer to this document before placing fields."
      );
      return;
    }
    try {
      const field = await createDocumentField(
        docId,
        {
          // Drafts assign by signer slot; sent documents by session.
          ...(isDraft
            ? { signer_index: Number(sessionId) || 0 }
            : { session_id: sessionId }),
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
        },
        draftToken
      );
      setFields((prev) => [...prev, field]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not place the field.");
    }
  };

  const moveField = async (field: DocumentFieldInfo, x: number, y: number) => {
    setError("");
    try {
      const updated = await updateDocumentField(
        docId,
        field.id,
        {
          x: Math.round(x * 10000) / 10000,
          y: Math.round(y * 10000) / 10000,
        },
        draftToken
      );
      setFields((prev) => prev.map((f) => (f.id === field.id ? updated : f)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not move the field.");
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLImageElement>) => {
    const p = pointFromEvent(e);
    if (!p) return;
    setError("");
    if (!sessionId) {
      setError(
        isDraft
          ? "Add a signer to this draft before placing fields."
          : "Add a signer to this document before placing fields."
      );
      return;
    }
    const hit = hitField(p);
    if (hit) {
      setSelectedId(hit.field.id);
      if (hit.field.completed) {
        // Completed fields cannot move; a drag here only selects.
        drag.current = { kind: "select", field: hit.field };
      } else {
        drag.current = {
          kind: "move",
          field: hit.field,
          grabDx: hit.grabDx,
          grabDy: hit.grabDy,
          clientX: p.clientX,
          clientY: p.clientY,
        };
      }
    } else {
      drag.current = {
        kind: "draw",
        clientX: p.clientX,
        clientY: p.clientY,
        x: p.x,
        y: p.y,
      };
      setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    }
    // Pointer capture keeps the drag tracking if the pointer leaves
    // the image mid-drag; not every environment implements it.
    const target = e.currentTarget as HTMLImageElement & {
      setPointerCapture?: (id: number) => void;
    };
    target.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLImageElement>) => {
    const start = drag.current;
    if (!start) return;
    const p = pointFromEvent(e);
    if (!p) return;
    if (start.kind === "draw") {
      setDraft({ x0: start.x, y0: start.y, x1: p.x, y1: p.y });
      return;
    }
    if (start.kind === "move") {
      const b = fieldBox(start.field);
      const w = b ? b.width : 0;
      const h = b ? b.height : 0;
      setMoveDraft({
        id: start.field.id,
        x: Math.max(0, Math.min(1 - w, p.x - start.grabDx)),
        y: Math.max(0, Math.min(1 - h, p.y - start.grabDy)),
      });
    }
  };

  const onPointerUp = async (e: React.PointerEvent<HTMLImageElement>) => {
    const start = drag.current;
    drag.current = null;
    setDraft(null);
    setMoveDraft(null);
    if (!start) return;
    const end = pointFromEvent(e);
    if (!end) return;
    if (start.kind === "select") {
      return;
    }
    if (start.kind === "move") {
      // A click only selects; a drag drops the box at the new spot.
      if (isClick(start.clientX, start.clientY, end.clientX, end.clientY)) {
        return;
      }
      const b = fieldBox(start.field);
      const w = b ? b.width : 0;
      const h = b ? b.height : 0;
      const x = Math.max(0, Math.min(1 - w, end.x - start.grabDx));
      const y = Math.max(0, Math.min(1 - h, end.y - start.grabDy));
      await moveField(start.field, x, y);
      return;
    }
    if (isClick(start.clientX, start.clientY, end.clientX, end.clientY)) {
      // A click: select the box under the pointer, if any; otherwise
      // place a default-size field at that point.
      const hit = hitField(end);
      if (hit) {
        setSelectedId(hit.field.id);
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
    drag.current = null;
    setDraft(null);
    setMoveDraft(null);
  };

  const onDelete = async (field: DocumentFieldInfo) => {
    setError("");
    try {
      await deleteDocumentField(docId, field.id, draftToken);
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
          {inWizard ? (
            <a href={`/send?draft=${docId}&step=2`}>← Back to send flow</a>
          ) : (
            <>
              <a href="/login">Log in</a> · <a href="/dashboard">Dashboard</a>
            </>
          )}
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
  const selectedField = fields.find((f) => f.id === selectedId) ?? null;

  return (
    <main style={shell}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>
        Place fields — {doc.title}
      </h1>
      <p style={{ opacity: 0.65, marginTop: 0 }}>
        Signing mode: {doc.signing_mode}. Pick a field type and the signer it
        belongs to, then drag on the page to draw a box where the field goes
        — or click to place a default-size field. Drag a placed box to move
        it; click a box to select it, then delete it with the ×. Each signer
        only ever sees their own fields.
      </p>

      {error && (
        <p style={{ background: "#fef2f2", color: "#b91c1c", padding: "0.75rem 1rem", borderRadius: 8 }}>
          {error}
        </p>
      )}

      {/* Sticky add-field toolbar: the controls stay pinned while the
          document scrolls beneath them. The selects shrink to their
          share of the row and truncate long labels; the page
          navigation never wraps under them. */}
      <div
        data-testid="field-toolbar"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "#fff",
          margin: "0 -1.25rem 1rem",
          padding: "0.75rem 1.25rem",
          borderBottom: "1px solid #e5e7eb",
          display: "flex",
          gap: "0.75rem",
          flexWrap: "wrap",
          alignItems: "end",
        }}
      >
        <label style={{ display: "grid", gap: "0.3rem", flex: "1 1 140px", minWidth: 0 }}>
          Field type
          <select
            style={toolbarSelectStyle}
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
        <label style={{ display: "grid", gap: "0.3rem", flex: "2 1 200px", minWidth: 0 }}>
          Assigned signer
          <select
            style={toolbarSelectStyle}
            value={sessionId}
            title={selectedSignerLabel}
            onChange={(e) => setSessionId(e.target.value)}
          >
            {isDraft
              ? (doc.signer_list ?? []).map((s, i) => (
                  <option key={i} value={String(i)}>
                    {draftSignerOptionLabel(i)}
                  </option>
                ))
              : (doc.sessions ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {signerOptionLabel(s)}
                  </option>
                ))}
          </select>
        </label>
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            alignItems: "center",
            flex: "0 0 auto",
            marginLeft: "auto",
            whiteSpace: "nowrap",
          }}
        >
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
          const signerNo = f.session
            ? (doc.sessions?.find((s) => s.id === f.session)?.order ?? 0) + 1
            : f.signer_index + 1;
          // The live position while this box is being dragged.
          const pos =
            moveDraft && moveDraft.id === f.id
              ? { x: moveDraft.x, y: moveDraft.y }
              : { x: f.x, y: f.y };
          if (b === null) {
            // Click-placed field: no stored size, marker pill as before.
            return (
              <div
                key={f.id}
                title={`${f.type} — ${signerLabel(f)}`}
                style={{
                  position: "absolute",
                  left: `${pos.x * 100}%`,
                  top: `${pos.y * 100}%`,
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
              title={`${f.type} — ${signerLabel(f)}`}
              data-testid="field-box"
              style={{
                position: "absolute",
                left: `${pos.x * 100}%`,
                top: `${pos.y * 100}%`,
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
        {/* Delete control on the selected box itself. It sits above
            the page image (not inside the pointer-events-none box),
            so clicking it never starts a draw or a move. */}
        {selectedField &&
          !selectedField.completed &&
          selectedField.page === page &&
          (() => {
            const b = fieldBox(selectedField);
            const pos =
              moveDraft && moveDraft.id === selectedField.id
                ? { x: moveDraft.x, y: moveDraft.y }
                : { x: selectedField.x, y: selectedField.y };
            const style: React.CSSProperties =
              b === null
                ? {
                    left: `${pos.x * 100}%`,
                    top: `${pos.y * 100}%`,
                    transform: "translate(10px, -50%)",
                  }
                : {
                    left: `${(pos.x + b.width) * 100}%`,
                    top: `${pos.y * 100}%`,
                    transform: "translate(-50%, -50%)",
                  };
            return (
              <button
                type="button"
                aria-label="Delete field"
                title="Delete field"
                data-testid="delete-field-button"
                onClick={() => onDelete(selectedField)}
                style={{
                  ...style,
                  position: "absolute",
                  width: 22,
                  height: 22,
                  padding: 0,
                  borderRadius: "50%",
                  border: "2px solid #fff",
                  background: "#111827",
                  color: "#fff",
                  fontSize: 13,
                  lineHeight: 1,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 5,
                }}
              >
                ×
              </button>
            );
          })()}
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
                {signerLabel(f)}
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
      {isDraft || inWizard ? (
        <p style={{ marginTop: "1.5rem", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          <a href={`/send?draft=${docId}&step=1`}>← Back to details</a>
          <a href={`/send?draft=${docId}&step=3`}>Continue to review →</a>
        </p>
      ) : (
        <p style={{ marginTop: "1.5rem" }}>
          <a href={`/d/${docId}`}>← Back to document</a>
        </p>
      )}
    </main>
  );
}
