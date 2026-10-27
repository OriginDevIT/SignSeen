import { test, expect, devices } from "@playwright/test";
import { runId, shot, drawSignature } from "./fixtures";
import {
  MAILPIT_URL,
  createSigningLink,
  sealCeremony,
  documentIdForToken,
  apiContext,
  waitForMail,
  mailBody,
  recordGalleryDoc,
} from "./helpers";

// Manual test script §E: accounts, dashboard, and email, against the
// real stack. Mailpit assertions only run on the compose test stack
// (E2E_MAILPIT_URL), matching the happy-path convention.
test("signup -> dashboard -> logout -> login, wrong password rejected", async ({
  page,
}) => {
  const id = runId();
  const email = `e2e-acct-${id}@example.com`;
  const password = "e2e-password-1234";

  await page.goto("/signup");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password (10+ characters)").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Your documents" })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText("Free plan")).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill("wrong-password-1234");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("invalid email or password")).toBeVisible();

  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Your documents" })).toBeVisible();
});

test("password reset: request -> Mailpit link -> new password -> login", async ({
  page,
}) => {
  test.skip(!MAILPIT_URL, "needs the compose test stack's Mailpit");
  const id = runId();
  const email = `e2e-reset-${id}@example.com`;
  const oldPassword = "e2e-password-1234";
  const newPassword = "e2e-password-5678";

  await page.goto("/signup");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password (10+ characters)").fill(oldPassword);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Your documents" })).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();

  await page.goto("/reset-password");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(
    page.getByText("If an account exists for that email, a reset link is on its way."),
  ).toBeVisible();

  const msg = await waitForMail(`to:${email}`, (m) =>
    m.Subject.includes("Reset your SignSeen password"),
  );
  const body = await mailBody(msg.ID);
  const match = body.match(
    /https?:\/\/[^\s"']*\/reset-password\?uid=[^&\s"']+&token=[^\s"']+/,
  );
  expect(match).not.toBeNull();
  // The emailed link points at the stack's FRONTEND_URL, which the
  // browser reaches the same way the suite's baseURL does.
  await page.goto(match![0].replace(/&amp;/g, "&"));
  await page
    .getByPlaceholder("New password (10+ characters)")
    .fill(newPassword);
  await page.getByRole("button", { name: "Set new password" }).click();
  // The confirm form redirects to /login on success.
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(newPassword);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Your documents" })).toBeVisible();
});

test("dashboard: logged-in send appears pending, sender email prefilled", async ({
  page,
}) => {
  const id = runId();
  const email = `e2e-dash-${id}@example.com`;
  await page.goto("/signup");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password (10+ characters)").fill("e2e-password-1234");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Your documents" })).toBeVisible();

  await page.goto("/send");
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  const senderInput = page.getByPlaceholder("you@example.com").first();
  await expect(senderInput).toHaveValue(email);

  const title = `E2E Dash ${id}`;
  const { token } = await createSigningLink(page, {
    title,
    senderEmail: email,
    signerEmail: `e2e-dash-signer-${id}@example.com`,
  });
  await shot(page, "09-dashboard-send.png");

  await page.goto("/dashboard");
  await expect(page.getByText(title)).toBeVisible();
  await expect(page.getByText("pending").first()).toBeVisible();
  await expect(page.getByText(/Storage: .* of .* MB/)).toBeVisible();

  // The pending document's tracking page resolves while unsigned.
  const docId = await documentIdForToken(token);
  await page.goto(`/d/${docId}`);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("pending").first()).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
});

test("seal email: sender and signer both get the signed copy", async ({
  page,
  browser,
}) => {
  test.skip(!MAILPIT_URL, "needs the compose test stack's Mailpit");
  const id = runId();
  const senderEmail = `e2e-mail-sender-${id}@example.com`;
  const signerEmail = `e2e-mail-signer-${id}@example.com`;
  const title = `E2E Mail ${id}`;
  const { signingUrl } = await createSigningLink(page, {
    title,
    senderEmail,
    signerEmail,
  });
  await sealCeremony(browser, signingUrl, { withPhoto: true });
  await waitForMail(`to:${senderEmail}`, (m) => m.Subject.startsWith("Signed:"));
  await waitForMail(`to:${signerEmail}`, (m) => m.Subject.startsWith("Signed:"));
});

test("tracking page + done-screen offer: sealed doc downloads, offer prefills signup", async ({
  page,
  browser,
}) => {
  const id = runId();
  const senderEmail = `e2e-track-sender-${id}@example.com`;
  const signerEmail = `e2e-track-signer-${id}@example.com`;
  const title = `E2E Track ${id}`;
  const { signingUrl, token } = await createSigningLink(page, {
    title,
    senderEmail,
    signerEmail,
  });
  const docId = await documentIdForToken(token);

  // Signer seals, then follows the done-screen offer.
  const signerContext = await browser.newContext({ ...devices["Pixel 7"] });
  const signer = await signerContext.newPage();
  try {
    await signer.goto(signingUrl);
    await signer.getByRole("button", { name: "Start signing" }).click();
    await drawSignature(signer);
    await signer.getByRole("button", { name: /Looks good/ }).click();
    await signer.getByRole("button", { name: "Skip photo & submit" }).click();
    await expect(signer.getByText("Signed. Seen. Sealed.")).toBeVisible();
    await signer.getByRole("link", { name: "Create a free account" }).click();
    await expect(signer).toHaveURL(new RegExp(`/signup\\?email=${encodeURIComponent(signerEmail)}`));
    await expect(signer.getByPlaceholder("Email")).toHaveValue(signerEmail);
  } finally {
    await signerContext.close();
  }

  await page.goto(`/d/${docId}`);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("signed").first()).toBeVisible();
  await expect(page.getByText(senderEmail)).toBeVisible();
  const download = page.getByRole("link", { name: "Download signed PDF" });
  await expect(download).toBeVisible();
  const api = await apiContext();
  const href = await download.getAttribute("href");
  const res = await api.get(href!);
  expect(res.ok()).toBeTruthy();
  expect(res.headers()["content-type"]).toContain("application/pdf");
});

test("premium branding: seeded premium account brands, seals, joins the gallery", async ({
  page,
  browser,
}) => {
  const id = runId();
  const brandName = `E2E Brand ${id}`;
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill("e2e-premium@example.com");
  await page.getByPlaceholder("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Your documents" })).toBeVisible();
  await expect(page.getByText("Premium plan")).toBeVisible();

  await page.getByPlaceholder("e.g. Acme Legal").fill(brandName);
  await page.getByRole("button", { name: "Save branding" }).click();
  await expect(page.getByText("Branding saved.")).toBeVisible();

  const { signingUrl, token } = await createSigningLink(page, {
    title: `E2E Brand Doc ${id}`,
    senderEmail: "e2e-premium@example.com",
    signerEmail: `e2e-brand-signer-${id}@example.com`,
  });
  await sealCeremony(browser, signingUrl, { withPhoto: true });
  await shot(page, "10-premium-branding.png");
  // No free-tier watermark + brand name on the certificate: the
  // gallery's rendered last page is where a human confirms both.
  recordGalleryDoc({
    label: `Premium branded — ${id}`,
    docId: await documentIdForToken(token),
    checks: [
      "certificate page shows the brand name",
      "no free-tier watermark on any page",
    ],
  });
});
