import { test, expect, devices, request } from "@playwright/test";
import { samplePdf, samplePhoto, runId, shot, drawSignature } from "./fixtures";

const API_URL = process.env.E2E_API_URL ?? "http://localhost:8000";
const MAILPIT_URL = process.env.E2E_MAILPIT_URL; // optional, compose test stack only

// Manual test script §B end to end: a desktop sender creates a signing
// link, a phone-sized signer completes the ceremony, and the result is
// verified through the API (audit chain) — the same document the UI
// produced, so nothing can be mocked around.
test("happy path: send -> sign with photo -> sealed, audit chain valid", async ({
  page,
  browser,
}) => {
  const id = runId();
  const title = `E2E Agreement ${id}`;
  const senderEmail = `e2e-sender-${id}@example.com`;

  // --- Sender (desktop) -------------------------------------------------
  await page.goto("/send");
  await page.getByPlaceholder("e.g. Contractor Agreement").fill(title);
  await expect(page.getByPlaceholder("Jane Doe")).toHaveCount(1);
  await page.getByPlaceholder("you@example.com").first().fill(senderEmail);
  await page.locator('input[type="file"]').setInputFiles(samplePdf());
  await page.getByRole("button", { name: "Create signing link" }).click();

  await expect(page.getByText("Ready to sign")).toBeVisible();
  const signingUrl = (await page.locator("code").first().innerText()).trim();
  expect(signingUrl).toContain("/s/");
  await expect(page.locator("svg").first()).toBeVisible(); // QR code
  await shot(page, "01-send-link-qr.png");

  // --- Signer (mobile emulation) ----------------------------------------
  const signerContext = await browser.newContext({ ...devices["Pixel 7"] });
  const signer = await signerContext.newPage();
  await signer.goto(signingUrl);
  await expect(signer.getByText(title)).toBeVisible();
  await expect(
    signer.getByText(/Review the document, then sign with your finger or mouse/),
  ).toBeVisible();
  await shot(signer, "02-signer-intro.png");

  // View document links straight at the API's PDF endpoint with
  // target=_blank. Headless Chromium has no PDF viewer — a real click
  // turns the new tab's navigation into a download that never settles
  // — so verify the link's target and markup here, and the document
  // itself over HTTP.
  const docLink = signer.getByRole("link", { name: /View document/ });
  const docHref = await docLink.getAttribute("href");
  expect(docHref).toContain("/document/");
  expect(await docLink.getAttribute("target")).toBe("_blank");
  const api = await request.newContext({ baseURL: API_URL });
  const docFileRes = await api.get(docHref!);
  expect(docFileRes.ok()).toBeTruthy();
  expect(docFileRes.headers()["content-type"]).toContain("application/pdf");

  await signer.getByRole("button", { name: "Start signing" }).click();
  await expect(signer.locator("canvas")).toBeVisible();
  await expect(signer.getByText("1. Sign")).toBeVisible();
  await drawSignature(signer);
  await shot(signer, "03-signature-drawn.png");
  await signer.getByRole("button", { name: /Looks good/ }).click();

  // Photo step: consent first, then supply the witness photo.
  await expect(signer.getByText("2. Seen")).toBeVisible();
  await signer.getByLabel(/I consent to having my photo captured/).check();
  await signer
    .locator('input[type="file"]')
    .setInputFiles(samplePhoto());
  await expect(signer.getByAltText("Witness photo preview")).toBeVisible();
  await shot(signer, "04-photo-step.png");

  // The ceremony has no name field — the signer's name comes from the
  // session (optionally set by the sender), so sealing is one tap.
  await signer.getByRole("button", { name: /Seal it/ }).click();
  await expect(signer.getByText("Signed. Seen. Sealed.")).toBeVisible();
  await expect(signer.getByText(/Audit seal/)).toBeVisible();
  await shot(signer, "05-done.png");

  // --- Verify through the API -------------------------------------------
  const token = signingUrl.split("/s/")[1].split(/[?#]/)[0];

  const eventsRes = await api.get(`/api/sessions/${token}/events/`);
  expect(eventsRes.ok()).toBeTruthy();
  const events = await eventsRes.json();
  expect(events.chain_valid).toBe(true);
  expect(events.events.map((e: { type: string }) => e.type)).toEqual([
    "session.created",
    "signature.submitted",
    "document.sealed",
  ]);

  const sessionRes = await api.get(`/api/sessions/${token}/`);
  const session = await sessionRes.json();
  const docRes = await api.get(`/api/documents/${session.document.id}/`);
  expect(docRes.ok()).toBeTruthy();
  const doc = await docRes.json();
  expect(doc.status).toBe("signed");
  expect(doc.signed_file).toBeTruthy();

  // --- Sealed email reached the sender (compose test stack only) --------
  if (MAILPIT_URL) {
    await expect
      .poll(
        async () => {
          const res = await api.get(
            `${MAILPIT_URL}/api/v1/search?query=to:${senderEmail}`,
          );
          const data = await res.json();
          return (data.messages ?? []).some((m: { Subject: string }) =>
            m.Subject.startsWith("Signed:"),
          );
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  }

  await signerContext.close();
});
