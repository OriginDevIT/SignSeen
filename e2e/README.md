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
- `tests/fixtures.ts` — the sample PDF/photo, the signature-drawing
  helper, and `shot()`, the screenshot helper.

## Screenshots (visual review)

Specs save numbered screenshots to `screenshots/` at the states worth
eyeballing (sending link + QR, signer intro, drawn signature, photo
step, done screen). The folder is a CI artifact on every run — review is
scrolling the gallery, not re-running the flow. CI also uploads the
Playwright HTML report and, for failures, traces with video.
