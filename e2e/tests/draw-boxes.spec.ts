import { test, expect, request } from "@playwright/test";
import { samplePdf, runId, drawSignature } from "./fixtures";

const API_URL = process.env.E2E_API_URL ?? "http://localhost:8000";

// Draw boxes on the document to place signature fields (#78): the owner
// drags a box on the rendered page, the box renders at its true size,
// the signer signs inside it in the ceremony, and the sealed document
// verifies as valid. The pixel geometry of the stamped signature —
// inside the drawn box, aspect preserved — is asserted in backend
// tests (PyMuPDF rects), where the sealed PDF can be read directly.
test("draw a box, seal it, and verify the sealed document", async ({
  page,
  browser,
}) => {
  const id = runId();
  const title = `E2E Draw Boxes ${id}`;
  const signerEmail = `e2e-draw-signer-${id}@example.com`;

  // --- Log in as the seeded premium account (fields are premium) ------
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill("e2e-premium@example.com");
  await page.getByPlaceholder("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Your documents")).toBeVisible();

  // --- Create the draft ------------------------------------------------
  // Fields are placed on the draft (#89) before sending: step 1
  // creates the draft, step 2 is the place-fields page in draft mode.
  await page.goto("/send");
  await page
    .getByPlaceholder("e.g. Contractor Agreement")
    .fill(title);
  await page.getByPlaceholder("jane@example.com").fill(signerEmail);
  await page.locator('input[type="file"]').setInputFiles(samplePdf());
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByText(/Step 2 of 3/)).toBeVisible();
  const draftId = new URL(page.url()).searchParams.get("draft");
  expect(draftId).toBeTruthy();
  const docId = draftId!;

  // --- Drag a box on the place-fields page (draft mode) -----------------
  await page.getByRole("link", { name: "Place fields" }).click();
  await expect(
    page.getByRole("heading", { name: /Place fields/ }),
  ).toBeVisible();
  const img = page.getByAltText("Document page 1");
  await expect(img).toBeVisible();
  // The rendered page is taller than the viewport; scroll it into view
  // so the whole drag lands on the image.
  await img.scrollIntoViewIfNeeded();
  const imgBox = await img.boundingBox();
  if (!imgBox) throw new Error("page image not visible");
  // A 30%-wide, 15%-tall box starting at 20% / 30% of the page.
  const x0 = imgBox.x + imgBox.width * 0.2;
  const y0 = imgBox.y + imgBox.height * 0.3;
  const x1 = imgBox.x + imgBox.width * 0.5;
  const y1 = imgBox.y + imgBox.height * 0.45;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByText("Placed fields (1)")).toBeVisible();

  // The box renders at its true size, labelled with type and signer.
  const fieldBox = page.getByTestId("field-box");
  await expect(fieldBox).toBeVisible();
  await expect(fieldBox).toContainText("signature");
  await expect(fieldBox).toContainText("S1");
  const fb = await fieldBox.boundingBox();
  expect(fb).not.toBeNull();
  // 2px borders add a little to each side; allow a point either way.
  expect(fb!.width / imgBox.width).toBeGreaterThan(0.28);
  expect(fb!.width / imgBox.width).toBeLessThan(0.33);
  expect(fb!.height / imgBox.height).toBeGreaterThan(0.13);
  expect(fb!.height / imgBox.height).toBeLessThan(0.18);

  // --- Back through the wizard: review, then send ----------------------
  await page.getByRole("link", { name: "Continue to review →" }).click();
  await expect(page.getByText(/Step 3 of 3/)).toBeVisible();
  await expect(page.getByText(/1 field/)).toBeVisible();
  await page.getByRole("button", { name: "Send document" }).click();
  await expect(page.getByText("Ready to sign")).toBeVisible();
  const signingUrl = (await page.locator("code").first().innerText()).trim();
  expect(signingUrl).toContain("/s/");
  const token = signingUrl.split("/s/")[1].split(/[?#]/)[0];

  // --- Sign the drawn field, then seal ----------------------------------
  const signerCtx = await browser.newContext();
  const signer = await signerCtx.newPage();
  try {
    await signer.goto(signingUrl);
    await signer.getByRole("button", { name: "Start signing" }).click();
    // The drawn box renders at its size on the page preview too.
    await expect(signer.getByTestId("field-box")).toBeVisible();
    // The preview image loads asynchronously, and when it lands the
    // layout below it shifts down by its full height. Wait until it
    // has loaded before reading the field pad's position, or the
    // stroke lands on the preview instead of the pad.
    await signer.waitForFunction(() => {
      const img = document.querySelector('img[alt="Document page 1"]');
      return (
        !!img &&
        (img as HTMLImageElement).complete &&
        (img as HTMLImageElement).naturalWidth > 0
      );
    });
    // The field box is clickable now: it opens a modal holding the
    // pad, and the document pad sits after the fields, not before.
    // The modal pad's height follows the drawn box (260px for this
    // 30% × 15% box), not the document pad's 200px.
    await signer.getByTestId("field-box").click();
    const dialog = signer.getByRole("dialog", {
      name: "Signature — page 1",
    });
    await expect(dialog).toBeVisible();
    const fieldPad = dialog.getByLabel("Draw your signature here");
    await expect(fieldPad).toBeVisible();
    const padBox = await fieldPad.boundingBox();
    expect(padBox).not.toBeNull();
    expect(padBox!.height).toBeGreaterThan(240);
    expect(padBox!.height).toBeLessThan(280);
    await drawSignature(signer, fieldPad);
    await dialog
      .getByRole("button", { name: "Use this signature" })
      .click();
    await expect(dialog).toBeHidden();
    // Completing the field offers the drawn signature for reuse on
    // the document pad, which comes after the fields.
    await signer
      .getByRole("button", { name: "Use your signature" })
      .click();
    await expect(signer.getByAltText("Signature preview")).toBeVisible();
    await signer
      .getByRole("button", { name: "Looks good — continue" })
      .click();
    await expect(signer.getByText("2. Seen")).toBeVisible();
    await signer.getByRole("button", { name: "Skip photo & submit" }).click();
    await expect(signer.getByText("Signed. Seen. Sealed.")).toBeVisible();
  } finally {
    await signerCtx.close();
  }

  // --- The sealed document verifies as valid on /verify -----------------
  const api = await request.newContext({ baseURL: API_URL });
  const docRes = await api.get(`/api/documents/${docId}/`);
  expect(docRes.ok()).toBeTruthy();
  const doc = await docRes.json();
  expect(doc.status).toBe("signed");
  expect(doc.signed_file).toBeTruthy();
  const signedRes = await api.get(doc.signed_file);
  expect(signedRes.ok()).toBeTruthy();
  const signedBytes = await signedRes.body();

  await page.goto("/verify");
  await expect(page.getByText("We don't store your document.")).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    name: "signed.pdf",
    mimeType: "application/pdf",
    buffer: signedBytes,
  });
  await page.getByRole("button", { name: "Verify this document" }).click();
  await expect(
    page.getByText("Valid — this is a genuine document sealed by SignSeen."),
  ).toBeVisible();
  await expect(page.getByText(title)).toBeVisible();
  await expect(page.getByText(signerEmail)).toBeVisible();
});
