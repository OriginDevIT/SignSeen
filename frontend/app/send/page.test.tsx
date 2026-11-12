// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import SendPage from "./page";
import { getAuthToken, myAccount } from "../../lib/api";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getAuthToken: vi.fn(),
    myAccount: vi.fn(),
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const FREE_ACCOUNT = {
  id: "acc-1",
  email: "owner@example.com",
  tier: "free" as const,
  is_premium: false,
  alerts_enabled: false,
  billing_status: "active" as const,
};

const PREMIUM_ACCOUNT = {
  ...FREE_ACCOUNT,
  tier: "premium" as const,
  is_premium: true,
};

function photoCheckbox() {
  return screen.getByRole("checkbox");
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SendPage session loading (#82)", () => {
  it("shows a loading state, not the logged-out view, while the session resolves", async () => {
    vi.mocked(getAuthToken).mockReturnValue("token-1");
    const pending = deferred<typeof FREE_ACCOUNT>();
    vi.mocked(myAccount).mockReturnValue(pending.promise);

    render(<SendPage />);

    // The session is still unknown: neither the signed-in line nor
    // the anonymous line may appear, and the photo checkbox must not
    // present itself as a disabled premium feature yet.
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(
      screen.queryByText(/Sending without an account is fine/),
    ).toBeNull();
    expect(screen.queryByText(/Signed in as/)).toBeNull();
    expect(screen.queryByText(/Premium feature/)).toBeNull();
    expect(photoCheckbox()).toHaveProperty("disabled", true);

    pending.resolve(PREMIUM_ACCOUNT);
    await waitFor(() =>
      expect(screen.getByText(/Signed in as owner@example.com/)).toBeTruthy(),
    );
    expect(screen.queryByText("Loading…")).toBeNull();
    expect(photoCheckbox()).toHaveProperty("disabled", false);
  });

  it("shows the premium note only once a free account is known", async () => {
    vi.mocked(getAuthToken).mockReturnValue("token-1");
    vi.mocked(myAccount).mockResolvedValue(FREE_ACCOUNT);

    render(<SendPage />);

    await waitFor(() =>
      expect(screen.getByText(/Signed in as owner@example.com/)).toBeTruthy(),
    );
    expect(screen.queryByText("Loading…")).toBeNull();
    expect(photoCheckbox()).toHaveProperty("disabled", true);
    expect(screen.getByText(/Premium feature/)).toBeTruthy();
  });

  it("shows the logged-out view once a missing session is known", async () => {
    vi.mocked(getAuthToken).mockReturnValue(null);
    render(<SendPage />);

    await waitFor(() =>
      expect(
        screen.getByText(/Sending without an account is fine/),
      ).toBeTruthy(),
    );
    expect(screen.queryByText("Loading…")).toBeNull();
    expect(vi.mocked(myAccount)).not.toHaveBeenCalled();
    expect(photoCheckbox()).toHaveProperty("disabled", true);
    expect(screen.getByText(/Premium feature/)).toBeTruthy();
  });
});
