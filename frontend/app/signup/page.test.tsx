// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import SignupPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

afterEach(() => {
  cleanup();
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
