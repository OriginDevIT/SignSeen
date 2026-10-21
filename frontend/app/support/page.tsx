export const metadata = { title: "Support — SignSeen" };

/**
 * Support page (issue #38). First line of support is the GoHighLevel
 * AI assistant in the chat widget (loaded site-wide when configured);
 * email is the fallback and the escalation path.
 */
export default function SupportPage() {
  return (
    <main
      style={{
        maxWidth: "44rem",
        margin: "0 auto",
        padding: "2.5rem 1.25rem 4rem",
        lineHeight: 1.65,
        color: "#111827",
      }}
    >
      <p style={{ margin: 0 }}>
        <a href="/" style={{ color: "#2563eb", textDecoration: "none" }}>
          ← SignSeen
        </a>
      </p>
      <h1 style={{ fontSize: "2rem", margin: "1rem 0 0.5rem" }}>Support</h1>
      <p>
        <strong>Fastest:</strong> use the chat assistant at the bottom of
        this page. It answers questions about sending and signing
        documents, plans and billing, and account issues instantly, day
        or night. If it can&apos;t resolve your question, it records the
        conversation so it can be followed up by email.
      </p>
      <p>
        <strong>Email:</strong>{" "}
        <a href="mailto:support@getsignseen.com">support@getsignseen.com</a>{" "}
        — include the email address on your account (or the one the
        document was sent to) and, if you have it, the document&apos;s
        tracking ID. Never email us your password or full payment card
        details; we will never ask for them.
      </p>
      <h2 style={{ fontSize: "1.15rem", margin: "2rem 0 0.5rem" }}>
        Before you write
      </h2>
      <ul style={{ paddingLeft: "1.25rem" }}>
        <li>
          <strong>Signer?</strong> You don&apos;t need an account. Open
          the signing link or scan the QR code from your invitation; if
          the link expired, ask the sender to resend — pending documents
          expire after 30 days.
        </li>
        <li>
          <strong>Payment failed?</strong> Premium features pause
          automatically, but your documents are kept. Update your payment
          method from the dashboard&apos;s “Manage billing” button to
          restore premium.
        </li>
        <li>
          <strong>Self-hosting?</strong> The hosted support channels
          cover getsignseen.com. For a self-hosted instance, see the
          project documentation and issue tracker on GitHub.
        </li>
      </ul>
      <p style={{ marginTop: "2rem", fontSize: "0.9rem", opacity: 0.7 }}>
        See also the <a href="/terms">Terms of Service</a> and{" "}
        <a href="/privacy">Privacy Policy</a> (support conversations are
        covered there).
      </p>
    </main>
  );
}
