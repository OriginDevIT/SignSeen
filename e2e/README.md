# SignSeen browser tests (Playwright)

End-to-end tests that drive the real stack in a browser, so the flows a
human would otherwise click through by hand (see
`docs/manual-test-script.md`) are checked by assertions instead. What
still needs human eyes is captured as screenshots (below); what a script
cannot prove at all — a physical phone's camera, EXIF orientation, QR
scanning on hardware — stays in the manual script.

## Run

Against the local test stack (Mailpit catches the outgoing email, so
sealed-copy delivery is asserted too):

```bash
docker compose -f docker-compose.yml -f docker-compose.test.yml up --build -d
docker compose -f docker-compose.yml -f docker-compose.test.yml exec api python manage.py seed_e2e
cd e2e
npm ci
npx playwright install chromium
E2E_MAILPIT_URL=http://localhost:8025 npm test
```

Against an already-running stack or deployment, point the suite at it
(the Mailpit assertions are skipped unless `E2E_MAILPIT_URL` is set):

```bash
E2E_BASE_URL=https://staging.example.com \
E2E_API_URL=https://staging.example.com \
npm test
```

`seed_e2e` creates `e2e-free@example.com` and `e2e-premium@example.com`
(password `e2e-password-123`). It only runs when the test override sets
`ENABLE_E2E_FIXTURES=1`, so these accounts cannot exist elsewhere.

## Layout

- `tests/happy-path.spec.ts` — manual script §B: desktop sender creates a
  signing link, a mobile-emulated signer draws a signature, consents,
  adds a witness photo, and seals; the audit chain and sealed document
  are then verified through the API for the document the UI produced.
- `tests/camera-path.spec.ts` — the same ceremony's photo step through
  the real in-app camera UI (getUserMedia against Chromium's fake media
  device), so a WitnessCamera regression cannot hide behind the
  file-input fallback the happy path uses (#34).
- `tests/negative-edge.spec.ts` — manual script §D: double-sign, bad
  file, empty signature, skipped photo, the free-tier 409 (anonymous
  and account, keyed on email), a second session's 409, and the
  stale-sender-token regression from #31.
- `tests/accounts.spec.ts` — manual script §E: signup/login/logout,
  wrong password, password reset through Mailpit, dashboard pending
  state + storage meter + prefilled sender, seal emails to sender and
  signer, the tracking page, the done-screen account offer, and a
  premium branded seal.
- `tests/intake.spec.ts` — manual script §C: a DOCX converts and
  seals, and a web page renders to PDF and seals. The page URL is
  `E2E_WEBPAGE_URL` (default `https://example.com`); set it to a
  reachable page when running against a deployment.
- `tests/billing.spec.ts` — manual script §F. Without Stripe keys
  (CI's case) it asserts the upgrade fails cleanly with "billing is
  not configured on this server". With test-mode keys in both the
  stack and the spec env (`E2E_STRIPE_SECRET_KEY`,
  `E2E_STRIPE_WEBHOOK_SECRET`, `E2E_STRIPE_PRICE_ID_ANNUAL` — the
  test override passes the same vars into the API container) it
  drives hosted Checkout with the 4242 card, returns to
  `/dashboard?upgraded=1`, then posts a locally signed
  `checkout.session.completed` event — Stripe cannot deliver webhooks
  to localhost — and asserts the dashboard flips to Premium.
- `tests/helpers.ts` — shared send/seal flows, Mailpit polling, and
  `recordGalleryDoc`, which appends a sealed document to the review
  manifest.
- `tests/fixtures.ts` — the sample PDF/photo, the signature-drawing
  helper, and `shot()`, the screenshot helper.

## Screenshots and the review gallery (visual review)

Specs save numbered screenshots to `screenshots/` at the states worth
eyeballing (sending link + QR, signer intro, drawn signature, photo
step, done screen). Specs that seal a document also record it in
`gallery-manifest.jsonl` (cleared by `global-setup.ts` each run).

After the suite, `npm run gallery` builds `gallery/index.html`: for
each recorded document it renders the sealed PDF's first and last
pages to PNG — signature placement, certificate page, photo block,
branding, watermark — through the test-stack-only endpoint
`GET /api/e2e/sealed/<doc-id>/page/<n>.png`
(`backend/apps/signing/e2e_views.py`, 404 unless
`ENABLE_E2E_FIXTURES=1`), then lists every screenshot with a "what to
check" caption. The folder is a CI artifact on every run — review is
scrolling the gallery, not re-running the flow. CI also uploads the
Playwright HTML report and, for failures, traces with video. No
pixel-diff goldens yet: capture-and-present first, per #31.
