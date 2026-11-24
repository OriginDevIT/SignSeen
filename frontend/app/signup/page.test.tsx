// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import SignupPage from "./page";
import { signup, startCheckout } from "../../lib/api";

vi.mock("next/navigation", () => {
  const router = { replace: vi.fn(), push: vi.fn() };
  return { useRouter: () => router };
});

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    signup: vi.fn(),
    startCheckout: vi.fn(),
  };
});

vi.mock("../../components/GoogleSignIn", () => ({
  default: () => null,
}));

async function fillAndSubmit() {
  fireEvent.change(screen.getByPlaceholderText("Email"), {
    target: { value: "new@example.com" },
  });
  fireEvent.change(
    screen.getByPlaceholderText("Password (10+ characters)"),
    { target: { value: "password-123" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: /Create account/ }),
  );
}

describe("SignupPage plan choice (#173)", () => {
  let navigatedTo = "";
  let originalLocation: Location;

  beforeEach(() => {
    vi.clearAllMocks();
    navigatedTo = "";
    originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        set href(url: string) {
          navigatedTo = url;
        },
        get href() {
          return navigatedTo;
        },
      },
    });
    vi.mocked(signup).mockResolvedValue({
      token: "tok-1",
      account: { email: "new@example.com" },
    } as never);
    vi.mocked(startCheckout).mockResolvedValue(
      "https://checkout.stripe.test/session-1",
    );
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("Free (default) creates the account and routes to the dashboard without checkout", async () => {
    const { useRouter } = await import("next/navigation");
    render(<SignupPage />);
    expect(
      screen.getByRole("radio", { name: /Free/ }),
    ).toHaveProperty("checked", true);

    await fillAndSubmit();

    await waitFor(() =>
      expect(vi.mocked(signup)).toHaveBeenCalledWith(
        "new@example.com",
        "password-123",
        "",
      ),
    );
    expect(vi.mocked(startCheckout)).not.toHaveBeenCalled();
    expect(useRouter().push).toHaveBeenCalledWith("/dashboard");
    expect(navigatedTo).toBe("");
  });

  it("Premium annual calls startCheckout('annual') and navigates to Stripe", async () => {
    render(<SignupPage />);
    fireEvent.click(
      screen.getByRole("radio", { name: /Premium - \$50\/yr/ }),
    );
    expect(
      screen.getByRole("button", {
        name: "Create account and continue to payment",
      }),
    ).toBeTruthy();

    await fillAndSubmit();

    await waitFor(() =>
      expect(vi.mocked(startCheckout)).toHaveBeenCalledWith("annual"),
    );
    expect(navigatedTo).toBe("https://checkout.stripe.test/session-1");
  });

  it("Premium monthly calls startCheckout('monthly')", async () => {
    render(<SignupPage />);
    fireEvent.click(
      screen.getByRole("radio", { name: /Premium - \$5\/mo/ }),
    );

    await fillAndSubmit();

    await waitFor(() =>
      expect(vi.mocked(startCheckout)).toHaveBeenCalledWith("monthly"),
    );
    expect(navigatedTo).toBe("https://checkout.stripe.test/session-1");
  });

  it("a failed checkout keeps the free account and shows the error", async () => {
    vi.mocked(startCheckout).mockRejectedValue(new Error("Checkout failed"));
    render(<SignupPage />);
    fireEvent.click(
      screen.getByRole("radio", { name: /Premium - \$50\/yr/ }),
    );

    await fillAndSubmit();

    await waitFor(() =>
      expect(screen.getByText("Checkout failed")).toBeTruthy(),
    );
    expect(navigatedTo).toBe("");
    expect(
      screen.getByRole("button", {
        name: "Create account and continue to payment",
      }),
    ).toHaveProperty("disabled", false);
  });
});

describe("SignupPage site navigation (#164)", () => {
  it("shows the shared navigation", () => {
    render(<SignupPage />);
    expect(screen.getByRole("link", { name: "SignSeen" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "SignSeen" }).getAttribute("href")
    ).toBe("/");
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Send a document" })
        .getAttribute("href")
    ).toBe("/send");
    // The header and the page's own "Already have one? Log in" link
    // both read "Log in" and both point at /login.
    const logins = screen.getAllByRole("link", { name: "Log in" });
    expect(logins).toHaveLength(2);
    expect(logins.every((l) => l.getAttribute("href") === "/login")).toBe(
      true
    );
    expect(screen.getByRole("link", { name: "Create account" })).toBeTruthy();
  });
});
