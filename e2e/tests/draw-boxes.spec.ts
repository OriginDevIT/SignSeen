import { test, expect, request } from "@playwright/test";
import { samplePdf, runId, drawSignature } from "./fixtures";
import { documentIdForToken } from "./helpers";

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

  // --- Create the document ---------------------------------------------
  await page.goto("/send");
  await page
    .getByPlaceholder("e.g. Contractor Agreement")
    .fill(title);
  await page.getByPlaceholder("jane@example.com").fill(signerEmail);
  await page.locator('input[type="file"]').setInputFiles(samplePdf());
  await page.getByRole("button", { name: "Create signing link" }).click();
  await expect(page.getByText("Ready to sign")).toBeVisible();
  const signingUrl = (await page.locator("code").first().innerText()).trim();
  expect(signingUrl).toContain("/s/");
  const token = signingUrl.split("/s/")[1].split(/[?#]/)[0];
  const docId = await documentIdForToken(token);

  // --- Drag a box on the place-fields page ------------------------------
  await page.goto(`/place-fields/${docId}`);
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
    // The ceremony renders the main pad first, then one pad per
    // signature field — the field pad is the second canvas. Its height
    // follows the drawn box (260px for this 30% × 15% box), not the
    // main pad's 200px.
    const fieldPad = signer.getByLabel("Draw your signature here").nth(1);
    await expect(fieldPad).toBeVisible();
    // The field pad sits below the page previews, off-screen; the
    // mouse stroke only reaches the canvas once it is scrolled into
    // view.
    await fieldPad.scrollIntoViewIfNeeded();
    const padBox = await fieldPad.boundingBox();
    expect(padBox).not.toBeNull();
    expect(padBox!.height).toBeGreaterThan(240);
    expect(padBox!.height).toBeLessThan(280);
    await drawSignature(signer, fieldPad);
    await signer.getByRole("button", { name: "Use this signature" }).click();
    await expect(signer.getByAltText("signature preview")).toBeVisible();
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
