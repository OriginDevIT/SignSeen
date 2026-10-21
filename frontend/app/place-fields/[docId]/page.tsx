"use client";

import { useEffect, useState } from "react";
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

  const onPageClick = async (e: React.MouseEvent<HTMLImageElement>) => {
    setError("");
    if (!sessionId) {
      setError("Add a signer to this document before placing fields.");
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    try {
      const field = await createDocumentField(docId, {
        session_id: sessionId,
        type: fieldType,
        page,
        x: Math.round(x * 10000) / 10000,
        y: Math.round(y * 10000) / 10000,
      });
      setFields((prev) => [...prev, field]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not place the field.");
    }
  };

  const onDelete = async (field: DocumentFieldInfo) => {
    setError("");
    try {
      await deleteDocumentField(docId, field.id);
      setFields((prev) => prev.filter((f) => f.id !== field.id));
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

  const pageFields = fields.filter((f) => f.page === page);

  return (
    <main style={shell}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>
        Place fields — {doc.title}
      </h1>
      <p style={{ opacity: 0.65, marginTop: 0 }}>
        Signing mode: {doc.signing_mode}. Pick a field type and the signer it
        belongs to, then click on the page where the field goes. Each signer
        only ever sees their own fields.
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
            src={imgUrl}
            alt={`Document page ${page}`}
            onClick={onPageClick}
            style={{ width: "100%", display: "block", cursor: "crosshair" }}
          />
        ) : (
          <p style={{ padding: "2rem", textAlign: "center", opacity: 0.6 }}>
            Loading page…
          </p>
        )}
        {pageFields.map((f) => (
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
            {f.type} · S{(doc.sessions?.find((s) => s.id === f.session)?.order ?? 0) + 1}
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: "1.15rem", marginTop: "1.5rem" }}>
        Placed fields ({fields.length})
      </h2>
      {fields.length === 0 ? (
        <p style={{ opacity: 0.65 }}>No fields yet — click on the page to place one.</p>
      ) : (
        <div style={{ display: "grid", gap: "0.5rem" }}>
          {fields.map((f) => (
            <div
              key={f.id}
              style={{
                display: "flex",
                gap: "0.75rem",
                alignItems: "center",
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                padding: "0.6rem 0.8rem",
              }}
            >
              <span style={{ fontWeight: 600, textTransform: "capitalize" }}>{f.type}</span>
              <span style={{ opacity: 0.7 }}>
                page {f.page} · ({f.x.toFixed(2)}, {f.y.toFixed(2)}) · {signerLabel(f.session)}
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
