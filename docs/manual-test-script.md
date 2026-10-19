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
8. **Take photo** (camera should open). Confirm the preview, or **Skip**.
9. **Submit** → ✅ **Signed. Seen. Sealed.** screen with an audit seal.
10. **Download signed PDF** — open it and check the last page:
    - ✅ Signature image is visible and right-side up.
    - ✅ Witness photo is visible and correctly oriented (portrait photos
      are the tricky case — see §E).
    - ✅ Metadata lines present: signer, UTC timestamp, document/session
      IDs, audit seal.
11. Audit trail: `GET http://localhost:8000/api/sessions/<token>/events/`
    - ✅ `chain_valid: true`, three events:
      `session.created` → `signature.submitted` → `document.sealed`.

## C. Intake breadth

12. **DOCX**: on `/send`, upload a `.docx` with real formatting (headings,
    bold, a list). Sign it.
    - ✅ Converted PDF preserves the formatting recognizably.
13. **Web page**: on `/send`, choose **From a web page**, paste a real URL
    (e.g. a terms page). Sign it.
    - ✅ Rendered PDF is readable. (Known limit: JS-heavy pages render
      partially.)

## D. Negative / edge cases

14. **Double-sign**: revisit the same signing link.
    - ✅ "This link is no longer active."
15. **Bad file**: upload a `.txt` on `/send`.
    - ✅ Clear error ("file must be a PDF, DOC, or DOCX").
16. **Empty signature**: on the sign step, tap **Looks good** without drawing.
    - ✅ Nothing happens (stays on the step).
17. **Skipped photo**: submit without a photo.
    - ✅ Seals fine; certificate page shows no photo.

## E. Eyeball items (known unknowns — report what you see)

- **Photo orientation**: take the witness photo in portrait. Is it upright
  in the sealed PDF, or rotated 90°? (Mobile EXIF orientation handling.)
- **iPhone photos**: iPhones shoot HEIC; Safari usually converts to JPEG on
  upload. If the photo step fails or the image is corrupt, note the device.
- **Small screens**: any layout breakage on the ceremony pages at 360px wide?
- **Camera permission**: first-tap behavior on iOS Safari vs Chrome Android.

## F. Testing with a real phone (LAN)

`localhost` doesn't reach your phone. Put both on the same Wi-Fi, find
your machine's LAN IP (`ipconfig` / `ifconfig` / `ip addr`), then:

```bash
FRONTEND_URL=http://<LAN-IP>:3000 NEXT_PUBLIC_API_URL=http://<LAN-IP>:8000 \
  docker compose up --build
```

The QR code will then encode the LAN address and your phone can reach
both the web app and the API.

## G. Cleanup

`docker compose down -v` — wipes containers, the test database, and
uploaded files.
