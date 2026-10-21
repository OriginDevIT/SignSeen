import LegalDoc from "../../components/LegalDoc";

export const metadata = { title: "Terms of Service — SignSeen" };

/**
 * DRAFT — prepared in-house for attorney review before public launch
 * (issue #37). Drafting direction (Matt, Oct 21, 2026): maximum
 * liability release for the operator, honest commitments on data
 * protection as implemented in the code.
 */
export default function TermsPage() {
  return (
    <LegalDoc title="Terms of Service" updated="October 21, 2026">
      <p>
        These Terms of Service (the “Terms”) govern your use of SignSeen,
        an electronic signature service operated by Origin Development
        &amp; IT (“ODIT”, “we”, “us”). SignSeen is available as a hosted
        service at getsignseen.com and as open-source software under the
        GNU Affero General Public License v3.0. These Terms apply to the
        hosted service. By using the hosted service, creating an account,
        sending a document, or signing a document through it, you agree
        to these Terms.
      </p>

      <h2>1. What SignSeen is — and is not</h2>
      <p>
        SignSeen provides “simple” electronic signatures: a signer draws
        their signature on a device, optionally provides a photographic
        witness image, and the service assembles a signed PDF with a
        tamper-evident audit record (timestamps, device information, and
        a hash-chained event log). SignSeen is designed to support
        signatures under laws such as the U.S. ESIGN Act and UETA.
      </p>
      <p>
        SignSeen is not a law firm and provides no legal advice. Whether
        an electronic signature is valid or enforceable for your
        document, transaction, or jurisdiction is your responsibility to
        determine, with your own counsel if needed. Some categories of
        documents are excluded from ESIGN/UETA or require specific formalities
        (for example wills and certain family-law, court, and real-estate
        documents). Do not use SignSeen for a document unless you have
        confirmed an electronic signature is appropriate for it.
      </p>

      <h2>2. Accounts and eligibility</h2>
      <ul>
        <li>You must be at least 18 years old and able to form a binding contract.</li>
        <li>Senders may use the free tier with an email address; stored-document features require an account. You are responsible for activity under your account and for keeping your credentials secure.</li>
        <li>Signers do not need an account. If you send a document, you represent that you have the right to share the document and the signer’s contact details with us for the purpose of the signing, and that the signer has consented to sign electronically and, where the document requests it, to provide a witness photo.</li>
      </ul>

      <h2>3. Acceptable use</h2>
      <p>You agree not to use SignSeen to:</p>
      <ul>
        <li>forge, impersonate, or obtain a signature without the signer’s knowledge and consent;</li>
        <li>send documents you have no right to send, or content that is unlawful, fraudulent, or infringing;</li>
        <li>probe, disrupt, or circumvent the service’s security, rate limits, or tier limits;</li>
        <li>upload malware or attempt to gain unauthorized access to other accounts or documents.</li>
      </ul>
      <p>
        We may suspend or terminate accounts and remove documents that
        violate these Terms, without notice where abuse or fraud is
        reasonably suspected.
      </p>

      <h2>4. Plans, billing, and the account lifecycle</h2>
      <ul>
        <li>
          <strong>Free tier:</strong> one document pending signature at a
          time, one signer per document, a 100 MB total storage limit, a
          30-day window for pending documents (pending documents are
          deleted when the window lapses), and an attribution mark on
          signed PDFs.
        </li>
        <li>
          <strong>Premium:</strong> $5/month or $50/year, billed through
          Stripe. Premium adds document storage (5 GB), multi-signer
          workflows, status tracking and alerts, custom branding, and
          removes the attribution mark. Prices may change with at least
          30 days’ notice to account holders.
        </li>
        <li>
          <strong>Renewal and management:</strong> subscriptions renew
          automatically until cancelled. You can manage, pause, or cancel
          your subscription at any time from your dashboard (Stripe
          billing portal). Pausing turns premium features off while
          keeping your documents.
        </li>
        <li>
          <strong>Failed payments:</strong> if a payment fails, premium
          features are suspended while your documents are kept. If the
          account remains suspended for 180 days, the premium account
          expires and the subscription is cancelled. 180 days after
          expiry, any documents still stored are permanently removed.
        </li>
        <li>
          Except where required by law, payments are non-refundable;
          cancelling stops future renewals and premium continues to the
          end of the paid period.
        </li>
      </ul>

      <h2>5. Your documents and content</h2>
      <p>
        You keep all rights to the documents, signatures, photos, and
        other content you or your signers submit (“Your Content”). You
        grant us a limited license to host, process, copy, and transmit
        Your Content solely to operate the service — for example, to
        assemble signed PDFs, deliver copies to you and your signers,
        and maintain the audit record. We claim no ownership of Your
        Content and do not use it for advertising or for training models.
      </p>

      <h2>6. Disclaimers</h2>
      <p>
        THE SERVICE IS PROVIDED “AS IS” AND “AS AVAILABLE”, WITHOUT
        WARRANTIES OF ANY KIND, EXPRESS, IMPLIED, OR STATUTORY, INCLUDING
        ANY IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
        PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT, TO THE MAXIMUM
        EXTENT PERMITTED BY LAW. We do not warrant that any signature
        obtained through the service will be held valid or enforceable,
        that the service will be uninterrupted or error-free, or that
        stored documents will be available for any particular period
        beyond the retention described in these Terms and the Privacy
        Policy. You are responsible for keeping your own copies of your
        documents.
      </p>

      <h2>7. Limitation of liability and release</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT
        WILL ODIT, ITS OWNERS, OFFICERS, EMPLOYEES, CONTRACTORS, OR
        AFFILIATES BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
        CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF
        PROFITS, REVENUE, DATA, DOCUMENTS, GOODWILL, OR BUSINESS
        OPPORTUNITY, ARISING OUT OF OR RELATING TO THE SERVICE OR ANY
        SIGNATURE OR DOCUMENT PROCESSED THROUGH IT, WHETHER BASED IN
        CONTRACT, TORT (INCLUDING NEGLIGENCE), STRICT LIABILITY, OR ANY
        OTHER THEORY, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
      </p>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, OUR TOTAL
        AGGREGATE LIABILITY FOR ALL CLAIMS ARISING OUT OF OR RELATING TO
        THE SERVICE WILL NOT EXCEED THE GREATER OF (A) THE AMOUNTS YOU
        PAID US FOR THE SERVICE IN THE TWELVE MONTHS BEFORE THE CLAIM OR
        (B) USD $50.
      </p>
      <p>
        BY USING THE SERVICE, YOU RELEASE ODIT AND THE PERSONS LISTED
        ABOVE FROM ANY AND ALL LIABILITY, CLAIMS, AND DEMANDS ARISING
        FROM OR RELATING TO YOUR USE OF THE SERVICE, INCLUDING THE
        VALIDITY OR ENFORCEABILITY OF ANY SIGNATURE, THE LOSS OR
        UNAVAILABILITY OF ANY DOCUMENT, AND ANY DISPUTE BETWEEN YOU AND
        A SIGNER OR OTHER THIRD PARTY. If a court holds any part of this
        section unenforceable, it will be enforced to the maximum extent
        the court permits, and the remaining parts stay in effect.
      </p>

      <h2>8. Indemnification</h2>
      <p>
        You agree to indemnify and hold harmless ODIT and the persons
        listed in Section 7 from claims, damages, and expenses (including
        reasonable attorneys’ fees) arising from Your Content, your use
        of the service, your documents or transactions, or your violation
        of these Terms or of any law or third-party right.
      </p>

      <h2>9. Termination</h2>
      <p>
        You may stop using the service and close your account at any
        time. We may suspend or terminate access as described in Section
        3. Sections 5–8 and 10 survive termination. After an account
        closes, stored documents are removed under the retention schedule
        in the Privacy Policy.
      </p>

      <h2>10. General</h2>
      <ul>
        <li>
          <strong>Governing law:</strong> these Terms are governed by the
          laws of the State of Illinois, USA, without regard to conflict
          of laws rules. Disputes will be resolved in the state or
          federal courts located in Cook County, Illinois, and you consent
          to personal jurisdiction there.
        </li>
        <li>
          <strong>Changes:</strong> we may update these Terms; material
          changes will be posted here with a new “last updated” date and,
          for account holders, announced by email at least 14 days before
          they take effect. Continued use after the effective date means
          acceptance.
        </li>
        <li>
          <strong>Severability and entire agreement:</strong> if any
          provision is unenforceable, the rest remain in effect. These
          Terms and the Privacy Policy are the entire agreement between
          you and ODIT for the hosted service.
        </li>
        <li>
          <strong>Open source:</strong> the SignSeen software is licensed
          under AGPL-3.0. If you self-host it, your use of the software is
          governed by that license, not by these Terms.
        </li>
      </ul>

      <h2>11. Contact</h2>
      <p>
        Origin Development &amp; IT — support@getsignseen.com.
      </p>
    </LegalDoc>
  );
}
