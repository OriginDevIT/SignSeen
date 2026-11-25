import { test, expect, request } from "@playwright/test";
import { samplePdf, runId } from "./fixtures";
import {
  MAILPIT_URL,
  apiContext,
  mailBody,
  waitForMail,
} from "./helpers";

// Send-flow rework (#89): the full wizard for an anonymous sender -
// upload creates a draft (no sessions, no emails), fields are placed
// on the draft, review shows the draft, and only Send emails the
// signer. Mailpit assertions only run on the compose test stack
// (E2E_MAILPIT_URL), matching the happy-path convention.
test("send flow: anonymous upload -> place a field -> review -> send, no email before Send", async ({
  page,
}) => {
  test.skip(!MAILPIT_URL, "needs the compose test stack's Mailpit");
  const id = runId();
  const title = `E2E Send Flow ${id}`;
  const senderEmail = `e2e-flow-sender-${id}@example.com`;
  const signerEmail = `e2e-flow-signer-${id}@example.com`;

  // --- Step 1: details + upload creates a draft ------------------------
  await page.goto("/send");
  await page.getByPlaceholder("e.g. Contractor Agreement").fill(title);
  await page.getByPlaceholder("you@example.com").first().fill(senderEmail);
  await page.getByPlaceholder("jane@example.com").fill(signerEmail);
  await page.locator('input[type="file"]').setInputFiles(samplePdf());
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByText(/Step 2 of 3/)).toBeVisible();

  const draftId = new URL(page.url()).searchParams.get("draft");
  expect(draftId).toBeTruthy();

  // Refreshing mid-flow resumes the same draft (draft id in the URL,
  // draft token in sessionStorage).
  await page.reload();
  await expect(page.getByText(/Step 2 of 3/)).toBeVisible();
  expect(new URL(page.url()).searchParams.get("draft")).toBe(draftId);

  // The draft has no sessions and nothing was emailed.
  const api = await apiContext();
  const draftRes = await api.get(`/api/documents/${draftId}/`);
  expect(draftRes.ok()).toBeTruthy();
  const draft = await draftRes.json();
  expect(draft.status).toBe("draft");
  expect(draft.sessions).toHaveLength(0);

  // --- Step 2: place a field on the draft -------------------------------
  await page.getByRole("link", { name: "Place fields" }).click();
  await expect(
    page.getByRole("heading", { name: /Place fields/ }),
  ).toBeVisible();
  const img = page.getByAltText("Document page 1");
  await expect(img).toBeVisible();
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
  const fieldBox = page.getByTestId("field-box");
  await expect(fieldBox).toContainText("signature");
  await expect(fieldBox).toContainText("S1");

  // The wizard exit leads back to review, never to a blank form.
  await page.getByRole("link", { name: "Continue to review →" }).click();
  await expect(page.getByText(/Step 3 of 3/)).toBeVisible();
  await expect(page.getByText(title)).toBeVisible();
  await expect(page.getByText(signerEmail)).toBeVisible();
  await expect(page.getByText(/1 field/)).toBeVisible();

  // No signer email has been sent yet: Mailpit holds nothing for the
  // signer after steps 1–2.
  const mail = await request.newContext();
  const beforeRes = await mail.get(
    `${MAILPIT_URL}/api/v1/search?query=to:${signerEmail}`,
  );
  expect(beforeRes.ok()).toBeTruthy();
  const beforeData = await beforeRes.json();
  expect(beforeData.messages ?? []).toHaveLength(0);

  // --- Step 3: Send - sessions created, invite emailed ------------------
  await page.getByRole("button", { name: "Send document" }).click();
  await expect(page.getByText("Ready to sign")).toBeVisible();
  const signingUrl = (await page.locator("code").first().innerText()).trim();
  expect(signingUrl).toContain("/s/");
  await expect(page.locator("svg").first()).toBeVisible(); // QR code

  const sentRes = await api.get(`/api/documents/${draftId}/`);
  expect((await sentRes.json()).status).toBe("pending");

  const msg = await waitForMail(`to:${signerEmail}`, (m) =>
    m.Subject.startsWith("Please sign:"),
  );
  const body = await mailBody(msg.ID);
  expect(body).toContain("/s/");
});

test("send flow: draft shows in the dashboard and can be deleted", async ({
  page,
}) => {
  const id = runId();
  const email = `e2e-flow-dash-${id}@example.com`;
  await page.goto("/signup");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password (10+ characters)").fill("e2e-password-1234");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Your documents" })).toBeVisible();

  const title = `E2E Flow Draft ${id}`;
  await page.goto("/send");
  await page.getByPlaceholder("e.g. Contractor Agreement").fill(title);
  await page
    .getByPlaceholder("jane@example.com")
    .fill(`e2e-flow-dash-signer-${id}@example.com`);
  await page.locator('input[type="file"]').setInputFiles(samplePdf());
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByText(/Step 2 of 3/)).toBeVisible();

  await page.goto("/dashboard");
  await page.getByRole("tab", { name: /Draft/ }).click();
  await expect(page.getByText(title)).toBeVisible();
  await expect(page.getByText("draft").first()).toBeVisible();
  // Continuing the draft returns to the wizard, not a blank form.
  await page.getByRole("link", { name: "Continue draft" }).click();
  await expect(page.getByText(/Step 1 of 3/)).toBeVisible();

  await page.goto("/dashboard");
  await page.getByRole("tab", { name: /Draft/ }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(page.getByText(title)).toHaveCount(0);
});
