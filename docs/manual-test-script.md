# SignSeen manual test script

Automated tests (pytest, vitest) cover the API contracts and the audit
chain. They **cannot** cover: the Docker Compose stack as a whole, touch and
camera hardware, QR scanning, or what the sealed PDF actually looks like.
This script covers those by hand.

## A. Spin up the stack

1. `git clone https://github.com/OriginDevIT/SignSeen.git && cd SignSeen`
2. Check out the branch under test: `git checkout phase-2-intake-breadth`
   (or `main`, if the PR is merged)
3. `docker compose up --build`
   - First build takes several minutes (LibreOffice layer is large).
4. Verify the pieces:
   - `http://localhost:8000/api/health/` → `{"status":"ok","service":"signseen-api"}`
   - `http://localhost:3000` → SignSeen landing page

## B. Happy path — desktop sender, phone signer

5. On desktop, open `http://localhost:3000/send`. Fill in title, your
   email, and upload a PDF. Click **Create signing link**.
   - ✅ QR code renders; **Copy link** copies the URL.
6. On your phone (see §F for LAN setup), scan the QR code.
   - ✅ Intro page shows the document title.
   - ✅ **View document** opens the PDF.
7. Tap **Start signing**. Draw your signature with a finger.
   - ✅ Lines are smooth; **Clear** wipes the canvas.
   - ✅ **Looks good** is a no-op until you draw something.
   - ✅ **Rotate the phone mid-signature**: drawing stays 1:1 with your
     finger (no stretching/doubling), and ink drawn before rotating is
     still there.
8. **Take photo** — first check the consent box ("I consent to having my
   photo captured…"); the **Take photo** button stays disabled until you do.
   Take the photo (camera should open). Confirm the preview, or **Skip**.
   - ✅ No checkbox → no camera. Photo without consent is rejected (400).
9. **Submit** → ✅ **Signed. Seen. Sealed.** screen with an audit seal.
10. **Download signed PDF** — open it and check the last page:
    - ✅ Signature image is visible and right-side up.
    - ✅ Witness photo is visible and correctly oriented (portrait photos
      are the tricky case — see §E).
    - ✅ Metadata lines present: signer, UTC timestamp, document/session
      IDs, audit seal, **Witness photo assurance: full**.
    - ✅ Every page carries a light diagonal "Signed with SignSeen"
      watermark (free-tier mark).
11. Audit trail: `GET http://localhost:8000/api/sessions/<token>/events/`
    - ✅ `chain_valid: true`, three events:
      `session.created` → `signature.submitted` → `document.sealed`.
    - ✅ `signature.submitted` payload includes `photo_assurance`
      (`assurance: "full"`, `reason: "timestamp_match"`) and
      `photo_consent: true`.

## C. Intake breadth

Scripted in `e2e/tests/intake.spec.ts` (#31 step 4) — the items
below are the spec's assertions, kept here for reference.

12. **DOCX**: on `/send`, upload a `.docx` with real formatting (headings,
    bold, a list). Sign it.
    - ✅ Converted PDF preserves the formatting recognizably.
13. **Web page**: on `/send`, choose **From a web page**, paste a real URL
    (e.g. a terms page). Sign it.
    - ✅ Rendered PDF is readable. (Known limit: JS-heavy pages render
      partially.)

## D. Negative / edge cases

Scripted in `e2e/tests/negative-edge.spec.ts` (#31 step 2) — the items
below are the spec's assertions, kept here for reference.

14. **Double-sign**: revisit the same signing link.
    - ✅ "This link is no longer active."
15. **Bad file**: upload a `.txt` on `/send`.
    - ✅ Clear error ("file must be a PDF, DOC, or DOCX").
16. **Empty signature**: on the sign step, tap **Looks good** without drawing.
    - ✅ Nothing happens (stays on the step).
17. **Skipped photo**: submit without a photo.
    - ✅ Seals fine; certificate page shows no photo.
18. **Second pending doc (anonymous, same email)**: send a doc, then send
    another with the same sender email before the first is signed.
    - ✅ 409: "Free tier allows 1 document pending signature at a time."
19. **Second pending doc (same email, account)**: sign up with the same
    sender email, try `/send` again while the first is pending.
    - ✅ Still 409 — the limit is keyed on the email, not the account.
20. **Second signing session on one document**: POST a second session.
    - ✅ 409: "This document already has a signing session."

## E. Accounts, dashboard, email (Phase 4)

Scripted in `e2e/tests/accounts.spec.ts` (#31 step 2) — the items
below are the spec's assertions, kept here for reference.

21. **Signup/login**: `/signup` → create account → land on `/dashboard`.
    Log out, `/login` → back in. Wrong password → "invalid email or
    password". Reset flow: `/reset-password` → email link (check the API
    server log for the link when SMTP is unset) → set new password → login.
22. **Dashboard**: send a doc while logged in → it appears on `/dashboard`
    with status `pending`; storage meter shows usage; sender email is
    prefilled on `/send` with a "Signed in as …" note.
23. **Seal email**: complete a ceremony with a signer email entered. Check
    both the sender and signer inboxes for the signed PDF + audit seal.
    (Without SMTP configured, check the API server log instead — the
    console email backend prints there. Sealing must succeed regardless.)
24. **Tracking page**: open `/d/<doc-id>` from the dashboard or the email.
    - ✅ Title, status, sender, and a signed-PDF download once sealed.
25. **Watermark**: seal a doc as a free user → every page carries the light
    diagonal "Signed with SignSeen — free tier". (Premium accounts skip it —
    testable only with Stripe keys configured; see §I.)
26. **Done-screen offer**: after sealing, the confirmation page offers
    "Create a free account" → `/signup`. Factual wording, no upsell copy.

## F. Billing (Stripe test mode — needs keys)

Scripted in `e2e/tests/billing.spec.ts` (#31 step 4): without keys the
spec asserts the clean unconfigured failure; with test-mode keys it
drives Checkout and simulates the webhook (see `e2e/README.md`).

Only when `STRIPE_SECRET_KEY` / `STRIPE_PRICE_ID` are set in `.env.staging`:
27. **Upgrade**: on `/dashboard`, **Upgrade to premium** → Stripe Checkout
    (use the `4242…` test card) → back on `/dashboard?upgraded=1` as Premium.
28. **No watermark**: seal a doc as premium → no free-tier watermark.
29. **Portal**: **Manage billing** → Stripe customer portal → cancel →
    webhook flips the account back to free.

## G. Eyeball items (known unknowns — report what you see)

- **Photo orientation**: take the witness photo in portrait. Is it upright
  in the sealed PDF, or rotated 90°? (Mobile EXIF orientation handling.)
- **iPhone photos**: iPhones shoot HEIC; Safari usually converts to JPEG on
  upload. If the photo step fails or the image is corrupt, note the device.
- **Small screens**: any layout breakage on the ceremony pages at 360px wide?
- **Camera permission**: first-tap behavior on iOS Safari vs Chrome Android.

## H. Testing with a real phone (LAN)

`localhost` doesn't reach your phone. Put both on the same Wi-Fi, find
your machine's LAN IP (`ipconfig` / `ifconfig` / `ip addr`), then:

```bash
FRONTEND_URL=http://<LAN-IP>:3000 NEXT_PUBLIC_API_URL=http://<LAN-IP>:8000 \
  docker compose up --build
```

The QR code will then encode the LAN address and your phone can reach
both the web app and the API.

## I. Cleanup

`docker compose down -v` — wipes containers, the test database, and
uploaded files.
