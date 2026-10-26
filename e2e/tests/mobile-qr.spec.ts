import { test, expect, type Page } from "@playwright/test";
import { samplePdf, runId } from "./fixtures";

// Issue #47: the QR code views did not adapt to a phone viewport.
// Both QR sites are checked at a strict 360px width: no horizontal
// overflow anywhere, the QR itself inside the viewport, and the copy
// controls reachable (not pushed off-screen).
const PHONE = { width: 360, height: 740 };

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function assertQrInViewport(page: Page) {
  const qr = page.locator("svg").first();
  await expect(qr).toBeVisible();
  const box = await qr.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(PHONE.width);
}

test("QR on the /send confirmation fits a 360px phone", async ({
  browser,
}) => {
  const ctx = await browser.newContext({
    viewport: PHONE,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const id = runId();

  await page.goto("/send");
  await page
    .getByPlaceholder("e.g. Contractor Agreement")
    .fill(`E2E QR ${id}`);
  await page.getByPlaceholder("you@example.com").first().fill("sender@example.com");
  await page.locator('input[type="file"]').setInputFiles(samplePdf());
  await page.getByRole("button", { name: "Create signing link" }).click();

  await expect(page.getByText("Ready to sign")).toBeVisible();
  await assertQrInViewport(page);
  await expect(
    page.getByRole("button", { name: "Copy link" }).first(),
  ).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await ctx.close();
});

test("QR in the dashboard signing-link panel fits a 360px phone", async ({
  browser,
}) => {
  const ctx = await browser.newContext({
    viewport: PHONE,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const id = runId();

  // Seeded test-stack account only (see seed_e2e); the doc created
  // while logged in attaches to the account and appears on /dashboard.
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill("e2e-free@example.com");
  await page.getByPlaceholder("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Your documents")).toBeVisible();

  await page.goto("/send");
  await page
    .getByPlaceholder("e.g. Contractor Agreement")
    .fill(`E2E QR Dash ${id}`);
  await page.locator('input[type="file"]').setInputFiles(samplePdf());
  await page.getByRole("button", { name: "Create signing link" }).click();
  await expect(page.getByText("Ready to sign")).toBeVisible();

  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Show QR code" }).first().click();
  await assertQrInViewport(page);
  await expect(
    page.getByRole("button", { name: "Copy signing link" }).first(),
  ).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await ctx.close();
});
