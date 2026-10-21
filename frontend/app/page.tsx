import { ceremonyTagline } from "../lib/ceremony";

/**
 * Marketing landing page for getsignseen.com (issue #40).
 * Explainer content condenses scope-doc §8 (simple e-signature vs PKI)
 * and §9 (device identity) — the same sources the support bot trains on.
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
const cta: React.CSSProperties = {
  display: "inline-block",
  padding: "0.8rem 1.6rem",
  fontSize: "1.05rem",
  fontWeight: 600,
  color: "#fff",
  background: "#111827",
  borderRadius: 10,
  textDecoration: "none",
};
const ctaGhost: React.CSSProperties = {
  ...cta,
  color: "#111827",
  background: "#fff",
  border: "1px solid #d1d5db",
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

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: "1.25rem", maxWidth: "46rem" }}>
      <p style={{ fontWeight: 650, margin: "0 0 0.25rem" }}>{q}</p>
      <p style={{ margin: 0, lineHeight: 1.65, opacity: 0.85 }}>{children}</p>
    </div>
  );
}

export default function Home() {
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
          Send a document, your signer scans a QR code and signs on their
          phone in about 30 seconds — and every signature carries a
          tamper-evident audit trail. No accounts for signers, no
          per-envelope fees, no certificates to install.
        </p>
        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            justifyContent: "center",
            flexWrap: "wrap",
            marginTop: "1.75rem",
          }}
        >
          <a href="/send" style={cta}>
            Send a document for signature
          </a>
          <a href="/signup" style={ctaGhost}>
            Create a free account
          </a>
        </div>
      </div>

      {/* How it works */}
      <div style={{ ...wrap, ...section }}>
        <h2 style={h2}>How it works</h2>
        <div style={row}>
          <div style={card}>
            <p style={cardTitle}>1 · Signed</p>
            <p style={cardText}>
              The signer opens your link or QR code and draws their
              signature right on their phone — no app, no account, no
              setup. Signature, initials, checkbox, text, and date fields
              are placed where you put them.
            </p>
          </div>
          <div style={card}>
            <p style={cardTitle}>2 · Seen</p>
            <p style={cardText}>
              When you ask for it, the signer snaps a quick photo with
              the front camera at the moment of signing. A picture of a
              real person, present at signing — the piece every other
              lightweight e-signature tool leaves out.
            </p>
          </div>
          <div style={card}>
            <p style={cardTitle}>3 · Sealed</p>
            <p style={cardText}>
              The signed PDF is sealed with a completion certificate and
              a hash-chained audit record: document hash, server
              timestamp, device session evidence, and the photo check.
              Change one byte afterwards and the record shows it.
            </p>
          </div>
        </div>
      </div>

      {/* Simple vs PKI (§8) */}
      <div style={{ ...wrap, ...section }}>
        <h2 style={h2}>Simple signatures, serious evidence</h2>
        <p style={lead}>
          SignSeen uses <strong>simple electronic signatures</strong> —
          the kind the U.S. ESIGN Act and state UETA laws treat as
          legally equivalent to pen-on-paper for the vast majority of
          documents (contracts, NDAs, HR forms, waivers, consent forms),
          provided both sides agreed to sign electronically and the
          record is kept.
        </p>
        <p style={lead}>
          PKI “digital signatures” take a different route: certificates
          and private keys that mathematically seal a file. The math is
          strong, but it proves a <em>key</em> was present, not a{" "}
          <em>person</em> — a stolen, unlocked phone signs just fine —
          and asking a casual signer to obtain and manage a certificate
          is a non-starter.
        </p>
        <p style={lead}>
          So we closed the simple signature’s one real gap —
          attribution, “was it really them?” — with the ceremony itself:
          document hashing, server-side timestamps, device evidence, and
          an optional photo of the signer. That’s the evidence that
          actually answers a dispute.
        </p>
      </div>

      {/* Device evidence (§9) */}
      <div style={{ ...wrap, ...section }}>
        <h2 style={h2}>Honest about device evidence</h2>
        <p style={lead}>
          For each signing we record the session evidence a browser can
          honestly provide: device type, user agent, IP address, and the
          server timestamp. It corroborates that a signature came through
          a specific session at a specific time — it is not a hardware
          ID, and we don’t pretend otherwise. A hardware-backed WebAuthn
          mode is designed into the audit schema for the future. And we
          never fingerprint or track anyone beyond what the audit trail
          needs.
        </p>
      </div>

      {/* Pricing */}
      <div style={{ ...wrap, ...section }}>
        <h2 style={h2}>Pricing</h2>
        <div style={row}>
          <div style={card}>
            <p style={cardTitle}>Free — $0</p>
            <p style={cardText}>
              1 document pending at a time · 1 signer per document ·
              100 MB storage · documents pending up to 30 days ·
              attribution mark on signed PDFs. No account needed to send
              your first document.
            </p>
          </div>
          <div style={card}>
            <p style={cardTitle}>Premium — $5/mo or $50/yr</p>
            <p style={cardText}>
              Document library with 5 GB storage · multi-signer
              workflows · status tracking and signing alerts · custom
              branding · no attribution mark. Pause or cancel any time;
              if a payment fails your documents are kept through a long
              grace window, never deleted on the spot.
            </p>
          </div>
          <div style={card}>
            <p style={cardTitle}>Self-hosted — free forever</p>
            <p style={cardText}>
              SignSeen is AGPL-3.0 open source. Run the whole stack
              yourself with Docker — same code as the hosted service, your
              infrastructure, your data. See the self-hosting guide in the
              repository.
            </p>
          </div>
        </div>
      </div>

      {/* FAQ */}
      <div style={{ ...wrap, ...section }}>
        <h2 style={h2}>Questions</h2>
        <Faq q="Is a SignSeen signature legally binding?">
          Simple electronic signatures are legally equivalent to
          handwritten ones for most documents under the ESIGN Act and
          UETA, when both parties consent to sign electronically.
          SignSeen records that consent and keeps the audit record. Some
          documents are excluded by law (wills and certain family-law,
          court, and real-estate documents, for example) — when in doubt,
          ask your own counsel. SignSeen isn’t a law firm and can’t
          advise you on a specific document.
        </Faq>
        <Faq q="Do signers need an account or an app?">
          No. The signer opens a link or scans a QR code, signs in the
          browser, and is done. Accounts exist for senders who want a
          document library.
        </Faq>
        <Faq q="What happens to the witness photo?">
          It becomes part of that document’s signing record — nothing
          else. Photos are never used for advertising, profiling, or
          training models, and they are deleted on the same schedule as
          the document itself. The sender chooses whether a document asks
          for a photo at all.
        </Faq>
        <Faq q="How long do you keep my documents?">
          On the free tier, pending documents are deleted after 30 days.
          Premium documents are kept while the account is in good
          standing; if an account’s payment fails, documents survive a
          180-day suspension window and a further 180 days after expiry
          before they are removed. You can download or delete your
          documents at any time.
        </Faq>
        <Faq q="Can I verify a signed document later?">
          Yes. Every sealed PDF carries its completion certificate, and
          the audit record is hash-chained against the document’s hash,
          so alterations after sealing are detectable.
        </Faq>
        <Faq q="Who runs the hosted service?">
          SignSeen is built and operated by Origin Development &amp; IT.
          The hosted service runs with no human handling your documents —
          support is an AI assistant backed by email follow-up.
        </Faq>
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
