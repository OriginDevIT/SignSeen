import { test, expect, request } from "@playwright/test";
import path from "node:path";
import { runId, shot } from "./fixtures";
import { API_URL, createSigningLink, sealCeremony } from "./helpers";

// Manual test script §C: the /send form takes more than PDFs. A DOCX
// must convert (LibreOffice in the API image) and a web page must
// render to PDF (WeasyPrint), and both results must seal.
test("docx intake: converts, renders as PDF, seals", async ({
  page,
  browser,
}) => {
  const id = runId();
  const title = `E2E Docx ${id}`;
  const senderEmail = `e2e-docx-${id}@example.com`;
  await page.goto("/send");
  await page.getByPlaceholder("e.g. Contractor Agreement").fill(title);
  await page.getByPlaceholder("you@example.com").first().fill(senderEmail);
  await page.getByPlaceholder("jane@example.com").fill(`e2e-intake-signer-${id}@example.com`);
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.join(__dirname, "sample.docx"));
  await page.getByRole("button", { name: "Create signing link" }).click();
  await expect(page.getByText("Ready to sign")).toBeVisible();
  const signingUrl = (await page.locator("code").first().innerText()).trim();
  await shot(page, "11-docx-link.png");

  // The served document is the converted PDF, not the uploaded DOCX.
  const api = await request.newContext({ baseURL: API_URL });
  const token = signingUrl.split("/s/")[1].split(/[?#]/)[0];
  const sessionRes = await api.get(`/api/sessions/${token}/`);
  const session = await sessionRes.json();
  const docRes = await api.get(`/api/documents/${session.document}/`);
  const doc = await docRes.json();
  const fileRes = await api.get(`/api/sessions/${token}/document/`);
  expect(fileRes.ok()).toBeTruthy();
  expect(fileRes.headers()["content-type"]).toContain("application/pdf");
  const bytes = await fileRes.body();
  expect(bytes.length).toBeGreaterThan(1024);
  expect(doc.status).toBe("pending");

  await sealCeremony(browser, signingUrl);
  const sealed = await api.get(`/api/documents/${session.document}/`);
  expect((await sealed.json()).status).toBe("signed");
});

test("web page intake: renders the page to PDF, seals", async ({
  page,
  browser,
}) => {
  // Default is a small stable public page; override for staging runs
  // (E2E_WEBPAGE_URL) where the suite points at a deployment.
  const pageUrl = process.env.E2E_WEBPAGE_URL ?? "https://example.com";
  const id = runId();
  const title = `E2E Page ${id}`;
  const senderEmail = `e2e-page-${id}@example.com`;
  await page.goto("/send");
  await page.getByPlaceholder("e.g. Contractor Agreement").fill(title);
  await page.getByPlaceholder("you@example.com").first().fill(senderEmail);
  await page.getByPlaceholder("jane@example.com").fill(`e2e-intake-signer-${id}@example.com`);
  await page.getByRole("button", { name: "From a web page" }).click();
  await page.getByPlaceholder("https://example.com/terms").fill(pageUrl);
  await page.getByRole("button", { name: "Create signing link" }).click();
  await expect(page.getByText("Ready to sign")).toBeVisible();
  const signingUrl = (await page.locator("code").first().innerText()).trim();
  await shot(page, "12-webpage-link.png");

  const api = await request.newContext({ baseURL: API_URL });
  const token = signingUrl.split("/s/")[1].split(/[?#]/)[0];
  const fileRes = await api.get(`/api/sessions/${token}/document/`);
  expect(fileRes.ok()).toBeTruthy();
  expect(fileRes.headers()["content-type"]).toContain("application/pdf");
  expect((await fileRes.body()).length).toBeGreaterThan(1024);

  await sealCeremony(browser, signingUrl);
});
