"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import HomeHeader from "../../components/HomeHeader";
import SigningLinkPanel from "../../components/SigningLinkPanel";
import UpgradeAction from "../../components/UpgradeAction";
import {
  ApiError,
  deleteDocument,
  getAuthToken,
  getBranding,
  logout,
  mediaUrl,
  myAccount,
  myDashboard,
  openBillingPortal,
  setAlertsEnabled,
  pauseBilling,
  resumeBilling,
  startCheckout,
  updateBranding,
  type AccountInfo,
  type BrandingInfo,
  type DashboardData,
  type DocumentInfo,
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

type DocTab = "in-progress" | "draft" | "complete" | "expired";

const TABS: { id: DocTab; label: string }[] = [
  { id: "in-progress", label: "In Progress" },
  { id: "draft", label: "Draft" },
  { id: "complete", label: "Complete" },
  { id: "expired", label: "Expired" },
];

function tabDocuments(documents: DocumentInfo[], tab: DocTab): DocumentInfo[] {
  if (tab === "draft") return documents.filter((d) => d.status === "draft");
  if (tab === "complete") return documents.filter((d) => d.status === "signed");
  if (tab === "expired") return documents.filter((d) => d.status === "expired");
  return documents.filter((d) => d.status === "pending");
}

/** The file a dashboard row downloads: the signed copy once the
 * document is signed, the original upload otherwise. */
function downloadFile(d: DocumentInfo): { url: string; name: string } | null {
  if (d.status === "signed" && d.signed_file) {
    const url = mediaUrl(d.signed_file);
    return url ? { url, name: `${d.title} (signed).pdf` } : null;
  }
  const url = mediaUrl(d.original_file);
  return url ? { url, name: d.original_filename || `${d.title}.pdf` } : null;
}

export default function DashboardPage() {
  const router = useRouter();
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [billingMsg, setBillingMsg] = useState("");
  const [busyBilling, setBusyBilling] = useState(false);
  const [branding, setBranding] = useState<BrandingInfo | null>(null);
  const [brandName, setBrandName] = useState("");
  const [brandColor, setBrandColor] = useState("");
  const [brandLogoFile, setBrandLogoFile] = useState<File | null>(null);
  const [brandingMsg, setBrandingMsg] = useState("");
  const [busyBranding, setBusyBranding] = useState(false);
  const [logoInputKey, setLogoInputKey] = useState(0);
  const [alertsMsg, setAlertsMsg] = useState("");
  const [busyAlerts, setBusyAlerts] = useState(false);
  const [activeTab, setActiveTab] = useState<DocTab>("in-progress");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!getAuthToken()) {
      router.replace("/login");
      return;
    }
    (async () => {
      try {
        // The three loads are independent reads, so fetch them in
        // parallel instead of one after another: the page renders
        // nothing until account and dashboard resolve, so the
        // sequential version paid a full round trip per call.
        const [acct, d, b] = await Promise.all([
          myAccount(),
          myDashboard(),
          // Branding is a settings extra; a failure here shouldn't
          // take down the whole dashboard.
          getBranding().catch(() => null),
        ]);
        setAccount(acct);
        setDash(d);
        if (b) {
          setBranding(b);
          setBrandName(b.brand_name);
          setBrandColor(b.brand_color);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
        } else {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      }
    })();
  }, [router]);

  const upgrade = async (plan: "monthly" | "annual" = "monthly") => {
    setBillingMsg("");
    setBusyBilling(true);
    try {
      window.location.href = await startCheckout(plan);
    } catch (err) {
      setBillingMsg(err instanceof Error ? err.message : "Checkout failed");
      setBusyBilling(false);
    }
  };

  // Delete a document at any status (drafts included): removes the
  // document, its sessions, and its files.
  const removeDocument = async (docId: string) => {
    setDeletingId(docId);
    try {
      await deleteDocument(docId);
      setDash((prev) =>
        prev
          ? { ...prev, documents: prev.documents.filter((d) => d.id !== docId) }
          : prev
      );
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete document");
    } finally {
      setDeletingId(null);
    }
  };

  const toggleAlerts = async (enabled: boolean) => {
    setAlertsMsg("");
    setBusyAlerts(true);
    try {
      setAccount(await setAlertsEnabled(enabled));
    } catch (err) {
      setAlertsMsg(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusyAlerts(false);
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

  const togglePause = async () => {
    setBillingMsg("");
    setBusyBilling(true);
    try {
      if (account?.billing_status === "paused") {
        await resumeBilling();
      } else {
        await pauseBilling();
      }
      setAccount(await myAccount());
    } catch (err) {
      setBillingMsg(err instanceof Error ? err.message : "Billing change failed");
    } finally {
      setBusyBilling(false);
    }
  };

  const saveBranding = async () => {
    setBrandingMsg("");
    setBusyBranding(true);
    try {
      const b = await updateBranding({
        brandName: brandName.trim(),
        brandColor: brandColor.trim(),
        logoFile: brandLogoFile,
      });
      setBranding(b);
      setBrandName(b.brand_name);
      setBrandColor(b.brand_color);
      setBrandLogoFile(null);
      setLogoInputKey((k) => k + 1);
      setBrandingMsg("Branding saved.");
    } catch (err) {
      setBrandingMsg(err instanceof Error ? err.message : "Could not save branding");
    } finally {
      setBusyBranding(false);
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

  // Free tier: 1 document pending signature at a time. The limit is
  // enforced at send time (a 409 from the send endpoint), so drafts
  // are always allowed - drafts never count toward it - and starting
  // a draft from here is never blocked.
  const pendingDoc = dash.documents.find((d) => d.status === "pending");
  const atPendingLimit = !dash.is_premium && pendingDoc !== undefined;
  const visibleDocs = tabDocuments(dash.documents, activeTab);

  return (
    <main style={page}>
      <HomeHeader />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <h1 style={{ margin: 0 }}>Your documents</h1>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <a href="/send" style={{ ...button, textDecoration: "none" }}>
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

      {atPendingLimit && (
        <p style={{ margin: 0, opacity: 0.75, fontSize: "0.9rem" }}>
          The free plan allows 1 document pending signature at a time - one
          document is still pending. You can still start a draft (drafts
          don&apos;t count toward the limit); the limit applies when you
          send, once the pending document has been signed or expires, or{" "}
          <UpgradeAction loggedIn onUpgrade={() => upgrade("annual")}>
            upgrade to premium
          </UpgradeAction>{" "}
          to send more now.
        </p>
      )}

      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
          <div>
            <div style={{ fontWeight: 600 }}>
              {account.name ? `${account.name} - ` : ""}
              {account.email}
            </div>
            <div style={{ opacity: 0.6, fontSize: "0.9rem" }}>
              {account.tier === "premium"
                ? dash.is_premium
                  ? "Premium plan"
                  : account.billing_status === "paused"
                    ? "Premium plan (paused)"
                    : "Premium plan (suspended)"
                : "Free plan"}
            </div>
            <div style={{ fontSize: "0.9rem", marginTop: "0.25rem" }}>
              <a href="/profile">Profile</a>
            </div>
          </div>
          {account.billing_status === "suspended" ? (
            <button onClick={portal} disabled={busyBilling} style={ghost}>
              Manage billing
            </button>
          ) : dash.is_premium ? (
            <>
              <button onClick={portal} disabled={busyBilling} style={ghost}>
                Manage billing
              </button>
              <button onClick={togglePause} disabled={busyBilling} style={ghost}>
                {busyBilling
                  ? "…"
                  : account.billing_status === "paused"
                    ? "Resume subscription"
                    : "Pause subscription"}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => upgrade("annual")}
                disabled={busyBilling}
                style={button}
              >
                {busyBilling ? "…" : "Premium - $50/yr - Save $10/yr"}
              </button>
              <button
                onClick={() => upgrade("monthly")}
                disabled={busyBilling}
                style={ghost}
              >
                {busyBilling ? "…" : "Premium - $5/mo"}
              </button>
            </>
          )}
        </div>
        {account.billing_status === "suspended" && (
          <p style={{ color: "#b91c1c", margin: "0.75rem 0 0" }}>
            Premium is suspended - a payment failed. Update your payment
            method to restore premium features. Accounts suspended for
            180 days expire, and stored documents are removed 180 days
            after expiry.
          </p>
        )}
        {account.billing_status === "paused" && (
          <p style={{ margin: "0.75rem 0 0", opacity: 0.75 }}>
            Your subscription is paused - premium features are off, and
            your documents are kept. Resume any time.
          </p>
        )}
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
        <div style={{ marginTop: "1rem" }}>
          <label
            style={{
              display: "flex",
              gap: "0.5rem",
              alignItems: "flex-start",
              fontSize: "0.9rem",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={account.alerts_enabled}
              disabled={!dash.is_premium || busyAlerts}
              onChange={(e) => toggleAlerts(e.target.checked)}
              style={{ marginTop: "0.2rem" }}
            />
            <span>
              <span style={{ fontWeight: 600 }}>Signing alerts</span>
              <br />
              <span style={{ opacity: 0.65 }}>
                Email when a signer views a document or a signing link is
                about to expire. Premium accounts only.
              </span>
            </span>
          </label>
          {alertsMsg && (
            <p style={{ color: "#b91c1c", margin: "0.5rem 0 0" }}>{alertsMsg}</p>
          )}
        </div>
      </div>

      <div style={card}>
        <h2 style={{ margin: "0 0 0.25rem", fontSize: "1.15rem" }}>Branding</h2>
        <p style={{ opacity: 0.65, margin: "0 0 1rem", fontSize: "0.9rem" }}>
          Your brand on the signing page, the sealed-PDF certificate, and
          signed-copy emails for documents you send.
          {!dash.is_premium && (
            <>
              {" Premium feature - "}
              <UpgradeAction loggedIn onUpgrade={() => upgrade("annual")}>
                upgrade
              </UpgradeAction>
              {" to enable it."}
            </>
          )}
        </p>
        <div style={{ display: "grid", gap: "0.9rem", maxWidth: "26rem" }}>
          <label style={{ display: "grid", gap: "0.35rem", fontSize: "0.9rem" }}>
            Brand name
            <input
              type="text"
              value={brandName}
              disabled={!dash.is_premium || busyBranding}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder="e.g. Acme Legal"
              style={{ padding: "0.6rem 0.7rem", border: "1px solid #d1d5db", borderRadius: 8, fontSize: "1rem" }}
            />
          </label>
          <label style={{ display: "grid", gap: "0.35rem", fontSize: "0.9rem" }}>
            Accent color
            <span style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="color"
                value={brandColor || "#2563eb"}
                disabled={!dash.is_premium || busyBranding}
                onChange={(e) => setBrandColor(e.target.value)}
                style={{ width: "3rem", height: "2.4rem", padding: 0, border: "1px solid #d1d5db", borderRadius: 8, background: "#fff" }}
              />
              <input
                type="text"
                value={brandColor}
                disabled={!dash.is_premium || busyBranding}
                onChange={(e) => setBrandColor(e.target.value)}
                placeholder="#2563eb"
                style={{ flex: 1, padding: "0.6rem 0.7rem", border: "1px solid #d1d5db", borderRadius: 8, fontSize: "1rem" }}
              />
            </span>
          </label>
          <label style={{ display: "grid", gap: "0.35rem", fontSize: "0.9rem" }}>
            Logo
            {branding?.brand_logo && (
              <img
                src={mediaUrl(branding.brand_logo) ?? ""}
                alt="Current brand logo"
                style={{ maxHeight: 56, maxWidth: 180, objectFit: "contain", alignSelf: "start" }}
              />
            )}
            <input
              key={logoInputKey}
              type="file"
              accept="image/*"
              disabled={!dash.is_premium || busyBranding}
              onChange={(e) => setBrandLogoFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <div>
            <button onClick={saveBranding} disabled={!dash.is_premium || busyBranding} style={{ ...button, opacity: dash.is_premium ? 1 : 0.5, cursor: dash.is_premium ? "pointer" : "not-allowed" }}>
              {busyBranding ? "Saving…" : "Save branding"}
            </button>
          </div>
          {brandingMsg && (
            <p style={{ margin: 0, fontSize: "0.9rem", color: brandingMsg === "Branding saved." ? "#15803d" : "#b91c1c" }}>
              {brandingMsg}
            </p>
          )}
        </div>
      </div>

      {dash.documents.length === 0 ? (
        <p style={{ opacity: 0.6 }}>
          No documents yet. <a href="/send">Send your first document</a>.
        </p>
      ) : (
        <>
          <h2 style={{ margin: "0.5rem 0 0", fontSize: "1.25rem" }}>
            Documents you&apos;ve sent
          </h2>
          <div
            role="tablist"
            aria-label="Documents"
            style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}
          >
            {TABS.map((t) => {
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(t.id)}
                  style={active ? button : ghost}
                >
                  {t.label} ({tabDocuments(dash.documents, t.id).length})
                </button>
              );
            })}
          </div>
          {visibleDocs.length === 0 ? (
            <p style={{ opacity: 0.6 }}>
              {activeTab === "in-progress"
                ? "No documents in progress."
                : activeTab === "draft"
                  ? "No drafts."
                  : activeTab === "expired"
                    ? "No expired documents."
                    : "No completed documents."}
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {visibleDocs.map((d) => {
                const file = downloadFile(d);
                return (
                  <div key={d.id} data-testid={`doc-row-${d.id}`} style={card}>
                    <a
                      href={d.status === "draft" ? `/send?draft=${d.id}&step=1` : `/d/${d.id}`}
                      style={{ textDecoration: "none", color: "inherit", display: "block" }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 600 }}>{d.title}</div>
                        <div
                          style={{
                            fontSize: "0.8rem",
                            padding: "0.2rem 0.6rem",
                            borderRadius: "999px",
                            background:
                              d.status === "signed"
                                ? "#dcfce7"
                                : d.status === "draft"
                                  ? "#dbeafe"
                                  : "#fef3c7",
                            whiteSpace: "nowrap",
                            height: "fit-content",
                          }}
                        >
                          {d.status === "draft" ? "draft" : d.status}
                        </div>
                      </div>
                      <div style={{ fontSize: "0.85rem", opacity: 0.6, marginTop: "0.25rem" }}>
                        {new Date(d.created_at).toLocaleString()} · {d.sender_email}
                      </div>
                    </a>
                    <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                      {d.status === "draft" && (
                        <a
                          href={`/send?draft=${d.id}&step=1`}
                          style={{ ...ghost, textDecoration: "none" }}
                        >
                          Continue draft
                        </a>
                      )}
                      {file && (
                        <a
                          href={file.url}
                          download={file.name}
                          style={{ ...ghost, textDecoration: "none" }}
                        >
                          Download
                        </a>
                      )}
                      {confirmDeleteId === d.id ? (
                        <>
                          <span style={{ fontSize: "0.9rem" }}>
                            Delete this document? The document and its files
                            will be removed.
                          </span>
                          <button
                            onClick={() => removeDocument(d.id)}
                            disabled={deletingId === d.id}
                            style={ghost}
                          >
                            {deletingId === d.id ? "Deleting…" : "Confirm delete"}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            disabled={deletingId === d.id}
                            style={ghost}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button onClick={() => setConfirmDeleteId(d.id)} style={ghost}>
                          Delete
                        </button>
                      )}
                    </div>
                    {d.status === "pending" && d.signing_url && (
                      <SigningLinkPanel signingUrl={d.signing_url} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
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
                <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
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
