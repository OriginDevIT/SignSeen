import { ceremonyTagline } from "../../lib/ceremony";

/**
 * Coming-soon page for the production domain (issue #86).
 * Same look as the landing page, no live-app links: the only call to
 * action is the launch email capture. The capture renders the GHL
 * launch form (NEXT_PUBLIC_GHL_LAUNCH_FORM_URL) when it is set, and
 * falls back to a mailto link for hello@getsignseen.com until then.
 */

const wrap: React.CSSProperties = {
  maxWidth: "62rem",
  margin: "0 auto",
  padding: "0 1.25rem",
};
const section: React.CSSProperties = { padding: "3rem 0 0.5rem" };
const h2: React.CSSProperties = { fontSize: "1.6rem", margin: "0 0 0.75rem" };
const lead: React.CSSProperties = {
  fontSize: "1.05rem",
  lineHeight: 1.65,
  opacity: 0.85,
  margin: "0 0 1rem",
  maxWidth: "46rem",
};
const card: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: "1.25rem",
  flex: "1 1 16rem",
};
const cardTitle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: "1.05rem",
  margin: "0 0 0.4rem",
};
const cardText: React.CSSProperties = {
  margin: 0,
  lineHeight: 1.6,
  opacity: 0.8,
  fontSize: "0.97rem",
};
const row: React.CSSProperties = {
  display: "flex",
  gap: "1rem",
  flexWrap: "wrap",
  marginTop: "1rem",
};
const mailLink: React.CSSProperties = {
  display: "inline-block",
  padding: "0.8rem 1.6rem",
  fontSize: "1.05rem",
  fontWeight: 600,
  color: "#fff",
  background: "#111827",
  borderRadius: 10,
  textDecoration: "none",
};

function launchFormUrl(): string {
  return (process.env.NEXT_PUBLIC_GHL_LAUNCH_FORM_URL || "").trim();
}

export default function ComingSoon() {
  const formUrl = launchFormUrl();
  return (
    <main style={{ color: "#111827", paddingBottom: "3rem" }}>
      {/* Hero */}
      <div
        style={{
          ...wrap,
          textAlign: "center",
          paddingTop: "4rem",
          paddingBottom: "1rem",
        }}
      >
        <p
          style={{
            display: "inline-block",
            margin: "0 0 1rem",
            padding: "0.35rem 0.9rem",
            borderRadius: 999,
            background: "#eff6ff",
            color: "#1d4ed8",
            fontWeight: 600,
            fontSize: "0.95rem",
          }}
        >
          Coming soon
        </p>
        <h1 style={{ fontSize: "3.2rem", margin: "0 0 0.5rem" }}>SignSeen</h1>
        <p style={{ fontSize: "1.35rem", opacity: 0.8, margin: "0 0 1rem" }}>
          {ceremonyTagline()}
        </p>
        <p
          style={{
            maxWidth: "38rem",
            margin: "0 auto",
            lineHeight: 1.65,
            opacity: 0.7,
            fontSize: "1.05rem",
          }}
        >
          Open-source electronic signature with a photographic witness.
          Send a document, your signer signs on their phone in about 30
          seconds — and every signature carries a tamper-evident audit
          trail. No accounts for signers, no per-envelope fees.
        </p>
      </div>

      {/* Email capture */}
      <div style={{ ...wrap, ...section, textAlign: "center" }}>
        <h2 style={{ ...h2, textAlign: "center" }}>
          Be first to know when it launches
        </h2>
        <p style={{ ...lead, margin: "0 auto 1.5rem", textAlign: "center" }}>
          Leave your email and we will tell you the moment SignSeen is
          ready to use. Open source and free to use when it launches.
        </p>
        {formUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <iframe
            data-testid="launch-form"
            title="Sign up for launch updates"
            src={formUrl}
            style={{
              width: "100%",
              maxWidth: "36rem",
              height: 480,
              border: "1px solid #e5e7eb",
              borderRadius: 12,
            }}
          />
        ) : (
          <a href="mailto:hello@getsignseen.com?subject=Tell%20me%20when%20SignSeen%20launches" style={mailLink}>
            Email us to join the launch list
          </a>
        )}
      </div>

      {/* How it works */}
      <div style={{ ...wrap, ...section }}>
        <h2 style={h2}>How it will work</h2>
        <div style={row}>
          <div style={card}>
            <p style={cardTitle}>1 · Signed</p>
            <p style={cardText}>
              The signer opens your link or QR code and draws their
              signature right on their phone — no app, no account, no
              setup.
            </p>
          </div>
          <div style={card}>
            <p style={cardTitle}>2 · Seen</p>
            <p style={cardText}>
              When you ask for it, the signer snaps a quick photo with
              the front camera at the moment of signing. A picture of a
              real person, present at signing.
            </p>
          </div>
          <div style={card}>
            <p style={cardTitle}>3 · Sealed</p>
            <p style={cardText}>
              The signed PDF is sealed with a completion certificate and
              a hash-chained audit record. Change one byte afterwards
              and the record shows it.
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          ...wrap,
          marginTop: "4rem",
          paddingTop: "1.5rem",
          borderTop: "1px solid #e5e7eb",
          fontSize: "0.9rem",
          opacity: 0.75,
          display: "flex",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "0.75rem",
        }}
      >
        <span>
          SignSeen — open source under AGPL-3.0 · Operated by Origin
          Development &amp; IT
        </span>
        <span>
          <a href="/support">Support</a> · <a href="/terms">Terms</a> ·{" "}
          <a href="/privacy">Privacy</a> ·{" "}
          <a href="https://github.com/OriginDevIT/SignSeen">GitHub</a>
        </span>
      </div>
    </main>
  );
}
