import { test, expect, devices } from "@playwright/test";
import { samplePhoto, runId, drawSignature } from "./fixtures";
import { apiContext, createSigningLink } from "./helpers";

// Sender option (#73): a premium sender requires a witness photo, and
// the signer cannot seal without one — client gating and server
// enforcement alike. The no-camera QR path is covered by the mobile-qr
// spec; this spec covers the requirement itself.
test("photo required: sender sets it, signer cannot seal without a photo", async ({
  page,
  browser,
}) => {
  const id = runId();
  const senderEmail = "e2e-premium@example.com";

  // --- Premium sender ---------------------------------------------------
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(senderEmail);
  await page.getByPlaceholder("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(
    page.getByRole("heading", { name: "Your documents" })
  ).toBeVisible();

  const { signingUrl, token } = await createSigningLink(page, {
    title: `E2E Photo Required ${id}`,
    senderEmail,
    signerEmail: `e2e-required-signer-${id}@example.com`,
    photoRequired: true,
  });

  // The session carries the flag and names the sender who required it.
  const api = await apiContext();
  const session = await (await api.get(`/api/sessions/${token}/`)).json();
  expect(session.photo_required).toBe(true);
  expect(session.sender_email).toBe(senderEmail);

  // Server enforcement: a direct submit without a photo is rejected,
  // even though the client never gets the chance to try it.
  const rejected = await api.post(`/api/sessions/${token}/sign/`, {
    data: {
      signature: "data:image/png;base64,AAAA",
      device_info: {},
    },
  });
  expect(rejected.status()).toBe(400);
  expect((await rejected.json()).error).toContain("witness photo");

  // --- Signer (mobile emulation) ----------------------------------------
  const signerContext = await browser.newContext({ ...devices["Pixel 7"] });
  const signer = await signerContext.newPage();
  try {
    await signer.goto(signingUrl);
    await signer.getByRole("button", { name: "Start signing" }).click();
    await expect(signer.locator("canvas")).toBeVisible();
    await drawSignature(signer);
    await signer.getByRole("button", { name: /Looks good/ }).click();
    await expect(signer.getByText("2. Seen")).toBeVisible();

    // No skip path; the message names the sender who required it.
    await expect(
      signer.getByRole("button", { name: /Skip photo/ })
    ).toHaveCount(0);
    await expect(
      signer.getByText(
        `${senderEmail} requires a witness photo to complete this signing.`
      )
    ).toBeVisible();
    const submit = signer.getByRole("button", { name: "Seal it — submit" });
    await expect(submit).toBeDisabled();

    // Attach the photo, then the same submit seals.
    await signer.getByLabel(/I consent to having my photo captured/).check();
    await signer.locator('input[type="file"]').setInputFiles(samplePhoto());
    await expect(signer.getByAltText("Witness photo preview")).toBeVisible();
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(signer.getByText("Signed. Seen. Sealed.")).toBeVisible();
  } finally {
    await signerContext.close();
  }
});
