import { test, expect } from "@playwright/test";
import crypto from "node:crypto";
import { runId } from "./fixtures";
import { API_URL, createSigningLink, sealCeremony, apiContext } from "./helpers";

// Manual test script §F: Stripe test-mode flows. The suite cannot
// invent keys, so the two halves gate on the same variables the test
// stack passes through (see docker-compose.test.yml):
// - without keys: the dashboard upgrade fails cleanly with the
//   "billing is not configured" message (this is what CI runs);
// - with test-mode keys: hosted Checkout with the 4242 card, return
//   to /dashboard?upgraded=1, then a locally signed
//   checkout.session.completed event stands in for the webhook Stripe
//   cannot deliver to localhost, and the dashboard flips to Premium.
const STRIPE_KEYS =
  process.env.E2E_STRIPE_SECRET_KEY &&
  process.env.E2E_STRIPE_WEBHOOK_SECRET &&
  process.env.E2E_STRIPE_PRICE_ID_ANNUAL;

test("billing unconfigured: upgrade fails cleanly, account stays free", async ({
  page,
}) => {
  test.skip(!!STRIPE_KEYS, "this half needs a stack without Stripe keys");
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill("e2e-free@example.com");
  await page.getByPlaceholder("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Your documents" })).toBeVisible();
  await expect(page.getByText("Free plan")).toBeVisible();
  await page.getByRole("button", { name: "Premium — $50/yr" }).click();
  await expect(
    page.getByText("billing is not configured on this server"),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("Free plan")).toBeVisible();
});

test("billing checkout: 4242 card -> return -> signed webhook -> Premium", async ({
  page,
  browser,
}) => {
  test.skip(
    !STRIPE_KEYS,
    "needs test-mode keys in both the stack and the spec env",
  );
  const id = runId();
  const email = `e2e-billing-${id}@example.com`;
  const password = "e2e-password-1234";

  await page.goto("/signup");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password (10+ characters)").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Your documents" })).toBeVisible();

  // The account id the webhook payload must name.
  const api = await apiContext();
  const loginRes = await api.post("/api/auth/login/", {
    data: { email, password },
  });
  expect(loginRes.ok()).toBeTruthy();
  const accountId = (await loginRes.json()).account.id;

  await page.getByRole("button", { name: "Premium — $50/yr" }).click();
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });
  // Stripe's hosted Checkout is a real form (no iframes): the
  // autocomplete attributes are the stable hooks.
  await page.locator('input[autocomplete="cc-number"]').fill("4242424242424242");
  await page.locator('input[autocomplete="cc-exp"]').fill("12/34");
  await page.locator('input[autocomplete="cc-csc"]').fill("123");
  await page.getByRole("button", { name: /Pay/ }).click();
  await page.waitForURL(/\/dashboard\?upgraded=1$/, { timeout: 60_000 });
  // Stripe cannot deliver webhooks to localhost, so the account is
  // still free here — that is the gap the signed event below closes.
  await expect(page.getByText("Free plan")).toBeVisible();

  const payload = JSON.stringify({
    id: `evt_e2e_${id}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_e2e_${id}`,
        customer: `cus_e2e_${id}`,
        subscription: `sub_e2e_${id}`,
        metadata: { account_id: accountId },
      },
    },
  });
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto
    .createHmac("sha256", process.env.E2E_STRIPE_WEBHOOK_SECRET!)
    .update(`${t}.${payload}`)
    .digest("hex");
  const hookRes = await api.post("/api/billing/webhook/", {
    data: payload,
    headers: {
      "Content-Type": "application/json",
      "Stripe-Signature": `t=${t},v1=${v1}`,
    },
  });
  expect(hookRes.ok()).toBeTruthy();

  await page.reload();
  await expect(page.getByText("Premium plan")).toBeVisible();

  // A premium account still seals fine (its sealed PDF is the
  // no-watermark case the gallery covers via the branded doc).
  const { signingUrl } = await createSigningLink(page, {
    title: `E2E Billing Doc ${id}`,
    senderEmail: email,
    signerEmail: `e2e-billing-signer-${id}@example.com`,
  });
  await sealCeremony(browser, signingUrl);
});
