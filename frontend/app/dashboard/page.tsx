"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  getAuthToken,
  logout,
  myAccount,
  myDashboard,
  openBillingPortal,
  startCheckout,
  type AccountInfo,
  type DashboardData,
} from "../../lib/api";

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const page: React.CSSProperties = {
  maxWidth: "52rem",
  margin: "0 auto",
  padding: "2rem 1rem",
  display: "flex",
  flexDirection: "column",
  gap: "1.5rem",
};

const card: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: "0.5rem",
  padding: "1.25rem",
};

const button: React.CSSProperties = {
  padding: "0.6rem 1rem",
  fontSize: "0.95rem",
  border: "none",
  borderRadius: "0.375rem",
  background: "#2563eb",
  color: "#fff",
  cursor: "pointer",
};

const ghost: React.CSSProperties = {
  ...button,
  background: "#f3f4f6",
  color: "#111",
};

export default function DashboardPage() {
  const router = useRouter();
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [billingMsg, setBillingMsg] = useState("");
  const [busyBilling, setBusyBilling] = useState(false);
  const [showLimitDialog, setShowLimitDialog] = useState(false);

  useEffect(() => {
    if (!getAuthToken()) {
      router.replace("/login");
      return;
    }
    (async () => {
      try {
        setAccount(await myAccount());
        setDash(await myDashboard());
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
        } else {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      }
    })();
  }, [router]);

  const upgrade = async () => {
    setBillingMsg("");
    setBusyBilling(true);
    try {
      window.location.href = await startCheckout();
    } catch (err) {
      setBillingMsg(err instanceof Error ? err.message : "Checkout failed");
      setBusyBilling(false);
    }
  };

  const portal = async () => {
    setBillingMsg("");
    setBusyBilling(true);
    try {
      window.location.href = await openBillingPortal();
    } catch (err) {
      setBillingMsg(err instanceof Error ? err.message : "Portal failed");
      setBusyBilling(false);
    }
  };

  if (error) {
    return <main style={page}><p style={{ color: "#b91c1c" }}>{error}</p></main>;
  }
  if (!account || !dash) {
    return <main style={page}><p>Loading…</p></main>;
  }

  const pct = Math.min(
    100,
    (dash.storage_used_bytes / dash.storage_limit_bytes) * 100
  );

  // Free tier: 1 document pending signature at a time (server enforces
  // with a 409 on send; this check just saves the wasted trip to /send
  // and the filled-in form when the limit is already hit).
  const pendingDoc = dash.documents.find((d) => d.status === "pending");
  const atPendingLimit = !dash.is_premium && pendingDoc !== undefined;

  const onSendClick = (e: React.MouseEvent) => {
    if (atPendingLimit) {
      e.preventDefault();
      setShowLimitDialog(true);
    }
  };

  return (
    <main style={page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Your documents</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <a href="/send" onClick={onSendClick} style={{ ...button, textDecoration: "none" }}>
            Send a document
          </a>
          <button
            onClick={() => logout().then(() => router.push("/"))}
            style={ghost}
          >
            Log out
          </button>
        </div>
      </div>

      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
          <div>
            <div style={{ fontWeight: 600 }}>{account.email}</div>
            <div style={{ opacity: 0.6, fontSize: "0.9rem" }}>
              {dash.is_premium ? "Premium plan" : "Free plan"}
            </div>
          </div>
          {dash.is_premium ? (
            <button onClick={portal} disabled={busyBilling} style={ghost}>
              Manage billing
            </button>
          ) : (
            <button onClick={upgrade} disabled={busyBilling} style={button}>
              {busyBilling ? "…" : "Upgrade to premium"}
            </button>
          )}
        </div>
        {billingMsg && (
          <p style={{ color: "#b91c1c", margin: "0.75rem 0 0" }}>{billingMsg}</p>
        )}
        <div style={{ marginTop: "1rem" }}>
          <div style={{ fontSize: "0.85rem", opacity: 0.7 }}>
            Storage: {mb(dash.storage_used_bytes)} of {mb(dash.storage_limit_bytes)}
          </div>
          <div
            style={{
              height: "0.5rem",
              background: "#e5e7eb",
              borderRadius: "0.25rem",
              marginTop: "0.25rem",
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: "100%",
                background: "#2563eb",
                borderRadius: "0.25rem",
              }}
            />
          </div>
        </div>
      </div>

      {dash.documents.length === 0 ? (
        <p style={{ opacity: 0.6 }}>
          No documents yet. <a href="/send">Send your first document</a>.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {dash.documents.map((d) => (
            <a
              key={d.id}
              href={`/d/${d.id}`}
              style={{ ...card, textDecoration: "none", color: "inherit" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
                <div style={{ fontWeight: 600 }}>{d.title}</div>
                <div
                  style={{
                    fontSize: "0.8rem",
                    padding: "0.2rem 0.6rem",
                    borderRadius: "999px",
                    background: d.status === "signed" ? "#dcfce7" : "#fef3c7",
                    whiteSpace: "nowrap",
                    height: "fit-content",
                  }}
                >
                  {d.status}
                </div>
              </div>
              <div style={{ fontSize: "0.85rem", opacity: 0.6, marginTop: "0.25rem" }}>
                {new Date(d.created_at).toLocaleString()} · {d.sender_email}
              </div>
            </a>
          ))}
        </div>
      )}

      {showLimitDialog && pendingDoc && (
        <div
          onClick={() => setShowLimitDialog(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
            zIndex: 50,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pending-limit-title"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: "0.5rem",
              padding: "1.5rem",
              maxWidth: "28rem",
              width: "100%",
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
            }}
          >
            <h2 id="pending-limit-title" style={{ margin: 0, fontSize: "1.25rem" }}>
              Free plan limit reached
            </h2>
            <p style={{ margin: 0, opacity: 0.75 }}>
              The free plan allows 1 document pending signature at a time.{" "}
              <strong>{pendingDoc.title}</strong> is still pending — you can
              send another document once it has been signed or expires, or
              upgrade to premium to send more now.
            </p>
            {billingMsg && (
              <p style={{ color: "#b91c1c", margin: 0 }}>{billingMsg}</p>
            )}
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <a
                href={`/d/${pendingDoc.id}`}
                style={{ ...button, textDecoration: "none" }}
              >
                View pending document
              </a>
              <button onClick={upgrade} disabled={busyBilling} style={button}>
                {busyBilling ? "…" : "Upgrade to premium"}
              </button>
              <button onClick={() => setShowLimitDialog(false)} style={ghost}>
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {dash.signed_documents.length > 0 && (
        <>
          <h2 style={{ margin: "0.5rem 0 0", fontSize: "1.25rem" }}>
            Documents you&apos;ve signed
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {dash.signed_documents.map((d) => (
              <a
                key={d.id}
                href={`/d/${d.id}`}
                style={{ ...card, textDecoration: "none", color: "inherit" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
                  <div style={{ fontWeight: 600 }}>{d.title}</div>
                  <div
                    style={{
                      fontSize: "0.8rem",
                      padding: "0.2rem 0.6rem",
                      borderRadius: "999px",
                      background: "#dcfce7",
                      whiteSpace: "nowrap",
                      height: "fit-content",
                    }}
                  >
                    signed
                  </div>
                </div>
                <div style={{ fontSize: "0.85rem", opacity: 0.6, marginTop: "0.25rem" }}>
                  {new Date(d.created_at).toLocaleString()} · sent by {d.sender_email}
                </div>
              </a>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
