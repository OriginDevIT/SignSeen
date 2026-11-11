import { test, expect, request } from "@playwright/test";
import { samplePdf, runId } from "./fixtures";
import {
  createSigningLink,
  sealCeremony,
  documentIdForToken,
} from "./helpers";

const API_URL = process.env.E2E_API_URL ?? "http://localhost:8000";

// Public verification page (#74): seal a document through the UI, then
// verify the signed download on /verify — and an unsigned PDF must come
// back invalid. Runs against the test stack, where the per-IP rate
// limit is off (docker-compose.test.yml); the limiter itself is covered
// by backend tests with the default on.
test("verify page: sealed download verifies valid, unsigned PDF invalid", async ({
  page,
  browser,
}) => {
  const id = runId();
  const title = `E2E Verify ${id}`;
  const senderEmail = `e2e-sender-${id}@example.com`;
  const signerEmail = `e2e-signer-${id}@example.com`;

  // --- Seal a document ---------------------------------------------------
  const { signingUrl, token } = await createSigningLink(page, {
    title,
    senderEmail,
    signerEmail,
  });
  await sealCeremony(browser, signingUrl);

  const docId = await documentIdForToken(token);
  const api = await request.newContext({ baseURL: API_URL });
  const docRes = await api.get(`/api/documents/${docId}/`);
  expect(docRes.ok()).toBeTruthy();
  const doc = await docRes.json();
  expect(doc.status).toBe("signed");
  expect(doc.signed_file).toBeTruthy();
  const signedRes = await api.get(doc.signed_file);
  expect(signedRes.ok()).toBeTruthy();
  const signedBytes = await signedRes.body();

  // --- Valid: the sealed download ---------------------------------------
  await page.goto("/verify");
  await expect(
    page.getByText("We don't store your document."),
  ).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    name: "signed.pdf",
    mimeType: "application/pdf",
    buffer: signedBytes,
  });
  await page.getByRole("button", { name: "Verify this document" }).click();
  await expect(
    page.getByText(
      "Valid — this is a genuine document sealed by SignSeen.",
    ),
  ).toBeVisible();
  await expect(page.getByText(title)).toBeVisible();
  await expect(page.getByText(signerEmail)).toBeVisible();

  // --- Invalid: the unsigned sample PDF ----------------------------------
  await page
    .getByRole("button", { name: "Check another document" })
    .click();
  await page.locator('input[type="file"]').setInputFiles(samplePdf());
  await page.getByRole("button", { name: "Verify this document" }).click();
  await expect(
    page.getByText(
      "Invalid — this file could not be verified as a document sealed by SignSeen.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("This file is not a document sealed by SignSeen."),
  ).toBeVisible();
});
