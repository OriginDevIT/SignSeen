import { test, expect, devices } from "@playwright/test";
import { samplePdf, runId, shot } from "./fixtures";
import {
  createSigningLink,
  sealCeremony,
  documentIdForToken,
  apiContext,
  recordGalleryDoc,
} from "./helpers";

// Manual test script §D, plus the stale-sender-token regression from
// issue #31: a signing link must keep working when the browser holds a
// dead sender token, because signer endpoints never use it.
test("double-sign: revisiting a sealed link says it is no longer active", async ({
  page,
  browser,
}) => {
  const id = runId();
  const { signingUrl } = await createSigningLink(page, {
    title: `E2E Double ${id}`,
    senderEmail: `e2e-double-${id}@example.com`,
  });
  await sealCeremony(browser, signingUrl);
  await page.goto(signingUrl);
  await expect(page.getByText("This link is no longer active")).toBeVisible();
});

test("bad file: a .txt upload is rejected with a clear error", async ({
  page,
}) => {
  const id = runId();
  await page.goto("/send");
  await page.getByPlaceholder("e.g. Contractor Agreement").fill(`E2E Bad ${id}`);
  await page
    .getByPlaceholder("you@example.com")
    .first()
    .fill(`e2e-bad-${id}@example.com`);
  await page.locator('input[type="file"]').setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not a pdf"),
  });
  await page.getByRole("button", { name: "Create signing link" }).click();
  await expect(
    page.getByText("file must be a PDF, DOC, or DOCX"),
  ).toBeVisible();
});

test("empty signature: Looks good without ink stays on the sign step", async ({
  page,
  browser,
}) => {
  const id = runId();
  const { signingUrl } = await createSigningLink(page, {
    title: `E2E Empty ${id}`,
    senderEmail: `e2e-empty-${id}@example.com`,
  });
  const signerContext = await browser.newContext({ ...devices["Pixel 7"] });
  const signer = await signerContext.newPage();
  try {
    await signer.goto(signingUrl);
    await signer.getByRole("button", { name: "Start signing" }).click();
    await expect(signer.locator("canvas")).toBeVisible();
    await signer.getByRole("button", { name: /Looks good/ }).click();
    await expect(signer.getByText("1. Sign")).toBeVisible();
    await expect(signer.getByText("2. Seen")).toHaveCount(0);
  } finally {
    await signerContext.close();
  }
});

test("skipped photo: seals fine, event payload carries no photo", async ({
  page,
  browser,
}) => {
  const id = runId();
  const { signingUrl, token } = await createSigningLink(page, {
    title: `E2E NoPhoto ${id}`,
    senderEmail: `e2e-nophoto-${id}@example.com`,
  });
  await sealCeremony(browser, signingUrl);
  const api = await apiContext();
  const eventsRes = await api.get(`/api/sessions/${token}/events/`);
  const events = await eventsRes.json();
  expect(events.chain_valid).toBe(true);
  const submitted = events.events.find(
    (e: { event_type: string }) => e.event_type === "signature.submitted",
  );
  expect(submitted.payload.photo_consent).toBe(false);
  expect(submitted.payload.photo_assurance).toBeNull();
  // The certificate page of this document is the visual proof: no
  // witness photo block. It joins the review gallery (step 3).
  recordGalleryDoc({
    label: `Skipped photo — ${id}`,
    docId: await documentIdForToken(token),
    checks: ["certificate page shows no witness photo block"],
  });
});

test("second pending doc, anonymous: same sender email hits the free 409", async ({
  page,
}) => {
  const id = runId();
  const senderEmail = `e2e-limit-${id}@example.com`;
  await createSigningLink(page, {
    title: `E2E Limit A ${id}`,
    senderEmail,
  });
  await createSigningLink(page, {
    title: `E2E Limit B ${id}`,
    senderEmail,
  }).catch(async () => {
    // createSigningLink expects "Ready to sign"; the 409 lands on the
    // form instead, which is the assertion below.
  });
  await expect(
    page.getByText(/Free tier allows 1 document pending signature at a time/),
  ).toBeVisible();
});

test("second pending doc, account: the limit is keyed on email, not account", async ({
  page,
}) => {
  const id = runId();
  const email = `e2e-limit-acct-${id}@example.com`;
  const password = "e2e-password-1234";
  // Fresh account with this email, then an anonymous send with the
  // same email, then a logged-in send: still the 409.
  await page.goto("/signup");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password (10+ characters)").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Your documents" })).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();

  await createSigningLink(page, {
    title: `E2E Limit Anon ${id}`,
    senderEmail: email,
  });

  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Your documents" })).toBeVisible();
  await page.goto("/send");
  await page.getByPlaceholder("e.g. Contractor Agreement").fill(`E2E Limit Acct ${id}`);
  await page.locator('input[type="file"]').setInputFiles(samplePdf());
  await page.getByRole("button", { name: "Create signing link" }).click();
  await expect(
    page.getByText(/Free tier allows 1 document pending signature at a time/),
  ).toBeVisible();
});

test("second signing session on one document: API 409", async ({
  page,
}) => {
  const id = runId();
  const { token } = await createSigningLink(page, {
    title: `E2E Second ${id}`,
    senderEmail: `e2e-second-${id}@example.com`,
  });
  const docId = await documentIdForToken(token);
  const api = await apiContext();
  const res = await api.post(`/api/documents/${docId}/sessions/`, {
    data: { signer_email: `e2e-second-2-${id}@example.com` },
  });
  expect(res.status()).toBe(409);
  expect(await res.text()).toContain("This document already has a signing session.");
});

test("regression: a stale sender token in localStorage must not break a signing link", async ({
  page,
  browser,
}) => {
  const id = runId();
  const { signingUrl } = await createSigningLink(page, {
    title: `E2E Stale ${id}`,
    senderEmail: `e2e-stale-${id}@example.com`,
  });
  const signerContext = await browser.newContext({ ...devices["Pixel 7"] });
  const signer = await signerContext.newPage();
  try {
    // Land on the origin first so localStorage is writable, plant a
    // dead sender token, then open the signing link in the same
    // context: signer endpoints must not touch it.
    await signer.goto("/");
    await signer.evaluate(() =>
      window.localStorage.setItem("signseen_token", "stale-garbage-token"),
    );
    await signer.goto(signingUrl);
    await expect(signer.getByText(`E2E Stale ${id}`)).toBeVisible();
    await signer.getByRole("button", { name: "Start signing" }).click();
    await expect(signer.locator("canvas")).toBeVisible();
  } finally {
    await signerContext.close();
  }
  await shot(page, "08-stale-token-link.png");
});
