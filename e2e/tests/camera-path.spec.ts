import { test, expect, devices } from "@playwright/test";
import { samplePdf, runId, shot, drawSignature } from "./fixtures";

// Issue #34: the happy-path spec supplies the witness photo through the
// fallback file input, so a regression in WitnessCamera — the real
// getUserMedia path every phone signer uses — would pass CI unnoticed.
// This spec drives the actual camera UI against Chromium's fake media
// device (configured in playwright.config.ts): consent -> Take photo ->
// live preview -> Capture photo -> the captured frame is the photo that
// gets sealed.
test("camera path: sign with a live-captured witness photo", async ({
  page,
  browser,
}) => {
  const id = runId();
  const title = `E2E Camera ${id}`;
  const senderEmail = `e2e-camera-${id}@example.com`;

  // --- Sender (desktop) ---------------------------------------------------
  await page.goto("/send");
  await page.getByPlaceholder("e.g. Contractor Agreement").fill(title);
  await page.getByPlaceholder("you@example.com").first().fill(senderEmail);
  await page.locator('input[type="file"]').setInputFiles(samplePdf());
  await page.getByRole("button", { name: "Create signing link" }).click();
  await expect(page.getByText("Ready to sign")).toBeVisible();
  const signingUrl = (await page.locator("code").first().innerText()).trim();
  expect(signingUrl).toContain("/s/");

  // --- Signer (mobile emulation, camera permission granted) ---------------
  const signerContext = await browser.newContext({
    ...devices["Pixel 7"],
    permissions: ["camera"],
  });
  const signer = await signerContext.newPage();
  await signer.goto(signingUrl);
  await expect(signer.getByText(title)).toBeVisible();
  await signer.getByRole("button", { name: "Start signing" }).click();
  await expect(signer.locator("canvas")).toBeVisible();
  await drawSignature(signer);
  await signer.getByRole("button", { name: /Looks good/ }).click();

  // --- Photo step through the real camera UI -------------------------------
  await expect(signer.getByText("2. Seen")).toBeVisible();
  await signer.getByLabel(/I consent to having my photo captured/).check();
  await signer.getByRole("button", { name: "Take photo" }).click();

  const preview = signer.getByLabel("Camera preview");
  await expect(preview).toBeVisible();
  // The fake-device stream is live: frames are actually flowing, so the
  // capture below grabs a real frame, not a blank canvas.
  await expect
    .poll(() => preview.evaluate((v: HTMLVideoElement) => v.videoWidth))
    .toBeGreaterThan(0);
  await shot(signer, "06-camera-live.png");

  await signer.getByRole("button", { name: "Capture photo" }).click();
  await expect(signer.getByAltText("Witness photo preview")).toBeVisible();
  await shot(signer, "07-camera-captured.png");

  // The captured frame is attached: the submit button offers to seal
  // with the photo (not "Skip photo & submit"), then sealing succeeds.
  await expect(
    signer.getByRole("button", { name: "Seal it — submit" }),
  ).toBeVisible();
  await signer.getByRole("button", { name: "Seal it — submit" }).click();
  await expect(signer.getByText("Signed. Seen. Sealed.")).toBeVisible();

  await signerContext.close();
});
