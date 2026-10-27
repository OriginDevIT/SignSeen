import { expect, request, devices, type Browser, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { samplePdf, samplePhoto, drawSignature } from "./fixtures";

export const API_URL = process.env.E2E_API_URL ?? "http://localhost:8000";
export const MAILPIT_URL = process.env.E2E_MAILPIT_URL; // optional, compose test stack only

export function apiContext() {
  return request.newContext({ baseURL: API_URL });
}

// Create a document + signing link through the desktop /send form.
// The signer email is required by the form since the email-first send
// change (#58), so it is a required option here: a spec that forgets
// it would stall at "Ready to sign" instead of failing at the call.
export async function createSigningLink(
  page: Page,
  opts: { title: string; senderEmail: string; signerEmail: string },
): Promise<{ signingUrl: string; token: string }> {
  await page.goto("/send");
  await page.getByPlaceholder("e.g. Contractor Agreement").fill(opts.title);
  await page.getByPlaceholder("you@example.com").first().fill(opts.senderEmail);
  await page.getByPlaceholder("jane@example.com").fill(opts.signerEmail);
  await page.locator('input[type="file"]').setInputFiles(samplePdf());
  await page.getByRole("button", { name: "Create signing link" }).click();
  await expect(page.getByText("Ready to sign")).toBeVisible();
  const signingUrl = (await page.locator("code").first().innerText()).trim();
  expect(signingUrl).toContain("/s/");
  const token = signingUrl.split("/s/")[1].split(/[?#]/)[0];
  return { signingUrl, token };
}

// Drive the mobile ceremony to the done screen. withPhoto uses the
// file-input fallback (the live-camera path has its own spec); without
// it the signer taps "Skip photo & submit".
export async function sealCeremony(
  browser: Browser,
  signingUrl: string,
  opts: { withPhoto?: boolean } = {},
): Promise<void> {
  const signerContext = await browser.newContext({ ...devices["Pixel 7"] });
  const signer = await signerContext.newPage();
  try {
    await signer.goto(signingUrl);
    await signer.getByRole("button", { name: "Start signing" }).click();
    await expect(signer.locator("canvas")).toBeVisible();
    await drawSignature(signer);
    await signer.getByRole("button", { name: /Looks good/ }).click();
    await expect(signer.getByText("2. Seen")).toBeVisible();
    if (opts.withPhoto) {
      await signer.getByLabel(/I consent to having my photo captured/).check();
      await signer.locator('input[type="file"]').setInputFiles(samplePhoto());
      await expect(signer.getByAltText("Witness photo preview")).toBeVisible();
      await signer.getByRole("button", { name: "Seal it — submit" }).click();
    } else {
      await signer.getByRole("button", { name: "Skip photo & submit" }).click();
    }
    await expect(signer.getByText("Signed. Seen. Sealed.")).toBeVisible();
  } finally {
    await signerContext.close();
  }
}

export async function documentIdForToken(token: string): Promise<string> {
  const api = await apiContext();
  const res = await api.get(`/api/sessions/${token}/`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).document;
}

// Poll Mailpit until a message matches, then return its summary.
// Skips the caller when Mailpit is not configured (the happy-path spec
// uses the same convention).
export async function waitForMail(
  query: string,
  match: (m: { ID: string; Subject: string }) => boolean,
): Promise<{ ID: string; Subject: string }> {
  const api = await request.newContext();
  let found: { ID: string; Subject: string } | null = null;
  await expect
    .poll(
      async () => {
        const res = await api.get(
          `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(query)}`,
        );
        const data = await res.json();
        found = (data.messages ?? []).find(match) ?? null;
        return found !== null;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  return found!;
}

export async function mailBody(id: string): Promise<string> {
  const api = await request.newContext();
  const res = await api.get(`${MAILPIT_URL}/api/v1/message/${id}`);
  expect(res.ok()).toBeTruthy();
  const data = await res.json();
  return `${data.Text ?? ""}\n${data.HTML ?? ""}`;
}

// Append a sealed document to the visual-review manifest consumed by
// scripts/build-gallery.mjs (step 3). Each entry names what a human
// should check on that document's rendered pages.
export function recordGalleryDoc(entry: {
  label: string;
  docId: string;
  checks: string[];
}): void {
  const line = JSON.stringify(entry) + "\n";
  fs.appendFileSync(
    path.join(__dirname, "..", "gallery-manifest.jsonl"),
    line,
  );
}
