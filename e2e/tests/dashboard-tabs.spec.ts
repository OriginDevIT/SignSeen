import { test, expect } from "@playwright/test";
import { samplePdf, runId } from "./fixtures";
import { createSigningLink, documentIdForToken } from "./helpers";

// Dashboard tabs (#104): owned documents group into In Progress,
// Draft, and Complete tabs, and each row offers Download and Delete
// (with a confirmation step) without opening the document page.
test("dashboard tabs: draft row downloads and deletes from the Draft tab", async ({
  page,
}) => {
  const id = runId();
  const title = `E2E Tabs Draft ${id}`;

  await page.goto("/login");
  await page.getByPlaceholder("Email").fill("e2e-premium@example.com");
  await page.getByPlaceholder("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Your documents" })).toBeVisible();

  // Create a draft through step 1 of the send wizard.
  await page.goto("/send");
  await page.getByPlaceholder("e.g. Contractor Agreement").fill(title);
  await page.getByPlaceholder("you@example.com").first().fill("e2e-premium@example.com");
  await page.getByPlaceholder("jane@example.com").fill(`e2e-tabs-signer-${id}@example.com`);
  await page.locator('input[type="file"]').setInputFiles(samplePdf());
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByText(/Step 2 of 3/)).toBeVisible();
  const draftId = new URL(page.url()).searchParams.get("draft");
  expect(draftId).toBeTruthy();

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Your documents" })).toBeVisible();
  await page.getByRole("tab", { name: /Draft/ }).click();
  const row = page.getByTestId(`doc-row-${draftId}`);
  await expect(row).toBeVisible();
  await expect(row.getByText(title)).toBeVisible();
  // The draft downloads the original upload.
  const download = row.getByRole("link", { name: "Download" });
  expect(await download.getAttribute("href")).toContain("/media/originals/");
  expect(await download.getAttribute("download")).toBeTruthy();

  // Delete asks first, then removes the row.
  await row.getByRole("button", { name: "Delete" }).click();
  await expect(row.getByText(/Delete this document\?/)).toBeVisible();
  await row.getByRole("button", { name: "Confirm delete" }).click();
  await expect(row).toHaveCount(0);
});

test("dashboard tabs: sent document shows in In Progress with download and delete", async ({
  page,
}) => {
  const id = runId();
  const title = `E2E Tabs Pending ${id}`;

  await page.goto("/login");
  await page.getByPlaceholder("Email").fill("e2e-premium@example.com");
  await page.getByPlaceholder("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Your documents" })).toBeVisible();

  const { token } = await createSigningLink(page, {
    title,
    senderEmail: "e2e-premium@example.com",
    signerEmail: `e2e-tabs-signer-${id}@example.com`,
  });
  const docId = await documentIdForToken(token);

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Your documents" })).toBeVisible();
  // In Progress is the default tab.
  const row = page.getByTestId(`doc-row-${docId}`);
  await expect(row).toBeVisible();
  await expect(row.getByText(title)).toBeVisible();
  const download = row.getByRole("link", { name: "Download" });
  expect(await download.getAttribute("href")).toContain("/media/originals/");
  expect(await download.getAttribute("download")).toBeTruthy();
  // The signing link stays available on the pending row.
  await expect(row.getByRole("button", { name: "Copy signing link" })).toBeVisible();

  await row.getByRole("button", { name: "Delete" }).click();
  await expect(row.getByText(/Delete this document\?/)).toBeVisible();
  await row.getByRole("button", { name: "Confirm delete" }).click();
  await expect(row).toHaveCount(0);
});
