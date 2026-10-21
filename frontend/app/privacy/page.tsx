import LegalDoc from "../../components/LegalDoc";

export const metadata = { title: "Privacy Policy — SignSeen" };

/**
 * DRAFT — prepared in-house for attorney review before public launch
 * (issue #37). Every statement here is written to match what the code
 * actually does; if the implementation changes, this page must change
 * with it.
 */
export default function PrivacyPage() {
  return (
    <LegalDoc title="Privacy Policy" updated="October 21, 2026">
      <p>
        This policy describes what Origin Development &amp; IT (“ODIT”,
        “we”) collects when you use the hosted SignSeen service at
        getsignseen.com, how it is used, and the choices you have. It
        applies to senders and to signers. If you self-host the
        open-source software, you are your own operator and this policy
        does not apply to your instance.
      </p>

      <h2>1. What we collect</h2>
      <ul>
        <li>
          <strong>Account information:</strong> your email address and a
          hashed password. Free-tier senders who never create an account
          give us only an email address per document.
        </li>
        <li>
          <strong>Documents:</strong> the files you upload, the fields you
          place on them, and the signed PDFs and audit records the
          service generates.
        </li>
        <li>
          <strong>Signer information:</strong> the signer’s name and
          email address (provided by the sender or by the signer),
          the drawn signature image, and — only when a document requests
          it and the signer consents — a witness photo taken at signing.
        </li>
        <li>
          <strong>Signing evidence:</strong> for each signing session the
          service records timestamps, the document’s identifier, the
          signer’s IP address and browser/device information, and a
          hash-chained log of events (session created, document viewed,
          signature submitted, document sealed). The witness photo’s
          embedded timestamp is compared against the server clock as an
          anti-spoofing signal and the result is recorded.
        </li>
        <li>
          <strong>Payment information:</strong> subscriptions are
          processed by Stripe. Your card details go directly to Stripe;
          we never see or store full card numbers. We keep your Stripe
          customer/subscription identifiers and billing status.
        </li>
        <li>
          <strong>Support conversations:</strong> if you use the support
          chat, the conversation is handled in our support system
          (GoHighLevel) so we can respond and keep a record of the
          exchange.
        </li>
      </ul>

      <h2>2. How we use it</h2>
      <ul>
        <li>To operate the service: deliver signing links, run the signing ceremony, assemble signed PDFs, and deliver copies to senders and signers.</li>
        <li>To maintain the audit record that makes a signed document verifiable.</li>
        <li>To send transactional email: signing invitations, completion copies, signing alerts (premium, opt-out available), password resets, and billing notices.</li>
        <li>To bill premium subscriptions and apply the account lifecycle described in the Terms.</li>
        <li>To secure the service: detect fraud, forged signatures, and abuse, and to enforce rate and tier limits.</li>
        <li>To answer support requests.</li>
      </ul>
      <p>
        <strong>Witness photos are used for one purpose only:</strong>
        they are part of the signing record for that document. We never
        use signer photos or documents for advertising, profiling, or
        training artificial-intelligence models, and we do not sell
        personal information.
      </p>

      <h2>3. Who we share it with</h2>
      <ul>
        <li>
          <strong>The parties to a signing:</strong> the signed PDF and
          its audit record are delivered to the sender and (where an
          email was provided) the signer. Anyone with a document’s
          tracking link can see that document’s status.
        </li>
        <li>
          <strong>Service providers:</strong> cloud hosting (Google Cloud
          Platform), email delivery, payment processing (Stripe), and
          support tooling (GoHighLevel) process data on our behalf under
          their own security and privacy terms.
        </li>
        <li>
          <strong>Legal obligations:</strong> we may disclose information
          if required by law, court order, or to protect the rights,
          property, or safety of ODIT, our users, or the public.
        </li>
      </ul>

      <h2>4. How we protect it</h2>
      <p>
        Data is encrypted in transit (TLS) and at rest on our hosting
        infrastructure. Audit events are hash-chained so tampering with
        the record is detectable. Access to production systems is
        restricted to the operator. Passwords are stored only as salted
        hashes, and signing links use unguessable tokens. No system is
        perfectly secure, and we do not promise absolute security — but
        the protections above are implemented in the service itself, not
        just promised here.
      </p>

      <h2>5. How long we keep it</h2>
      <ul>
        <li>
          <strong>Free tier:</strong> pending documents are deleted
          automatically when their 30-day window lapses.
        </li>
        <li>
          <strong>Accounts in good standing:</strong> documents and audit
          records are kept while the account is active, subject to the
          storage limits of the plan.
        </li>
        <li>
          <strong>Billing lifecycle:</strong> if an account’s premium is
          suspended (failed payment), documents are kept during the
          180-day suspension window; after the account expires, stored
          documents are permanently removed 180 days later.
        </li>
        <li>
          <strong>Backups and logs:</strong> routine backups and security
          logs rotate on a short cycle and may retain copies briefly
          after deletion from the live service.
        </li>
      </ul>

      <h2>6. Your choices and rights</h2>
      <ul>
        <li>You can view, download, and delete your documents from your dashboard at any time.</li>
        <li>You can opt out of signing alerts (premium) in your account settings; transactional emails about your own documents cannot be opted out of while you use the service.</li>
        <li>
          You may request access to, correction of, or deletion of your
          personal information by contacting us. Signers who never made
          an account can make the same requests through the sender or by
          contacting us directly; we may need enough information to
          locate the signing record.
        </li>
        <li>
          Deleting your account starts the removal schedule in Section
          5. Some audit information may be retained where the law
          requires it or where a counterparty to a completed signing has
          a legitimate need for the record.
        </li>
      </ul>

      <h2>7. Cookies</h2>
      <p>
        The service uses only the storage needed to keep you signed in
        and to run the signing ceremony (a session/token stored in your
        browser). We do not use advertising or cross-site tracking
        cookies. The support chat, if you open it, is provided by
        GoHighLevel and may set its own cookies as described in their
        policies.
      </p>

      <h2>8. Children</h2>
      <p>
        SignSeen is not intended for anyone under 18, and we do not
        knowingly collect information from children. Contact us if you
        believe a minor’s information was submitted, and we will remove
        it.
      </p>

      <h2>9. Changes and contact</h2>
      <p>
        We will post changes to this policy here with a new “last
        updated” date and, for material changes, notify account holders
        by email. Questions or requests: Origin Development &amp; IT —
        support@getsignseen.com.
      </p>
    </LegalDoc>
  );
}
