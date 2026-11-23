import { test, expect } from "@playwright/test";

// Issue #82/#83: the /send page must not flash the logged-out view to
// a signed-in sender while the session check settles. Until the check
// (GET /api/auth/me/) resolves, the page shows "Loading…" and no step
// content renders at all (#153) — the photo checkbox is absent, not
// disabled; only then does the signed-in copy appear. Delaying the
// session check makes the loading state observable instead of a race.
test("signed-in sender: loading state, then signed-in copy, no anonymous flash", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill("e2e-premium@example.com");
  await page.getByPlaceholder("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(
    page.getByRole("heading", { name: "Your documents" }),
  ).toBeVisible();

  await page.route("**/api/auth/me/", async (route) => {
    await new Promise((r) => setTimeout(r, 1000));
    await route.continue();
  });
  await page.goto("/send");
  await expect(page.getByText("Loading…")).toBeVisible();
  await expect(
    page.getByText("Sending without an account is fine."),
  ).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: /Require a witness photo/ }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Signed in as e2e-premium@example.com"),
  ).toBeVisible();
  await expect(
    page.getByText("Sending without an account is fine."),
  ).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: /Require a witness photo/ }),
  ).toBeEnabled();
});

test("anonymous sender: settled view is the anonymous copy", async ({
  page,
}) => {
  await page.goto("/send");
  await expect(
    page.getByText("Sending without an account is fine."),
  ).toBeVisible();
  await expect(page.getByText(/Signed in as/)).toHaveCount(0);
});
