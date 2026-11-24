// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import LoginPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

afterEach(() => {
  cleanup();
});

describe("LoginPage site navigation (#164)", () => {
  it("shows the shared navigation", () => {
    render(<LoginPage />);
    expect(screen.getByRole("link", { name: "SignSeen" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "SignSeen" }).getAttribute("href")
    ).toBe("/");
    expect(screen.getByRole("link", { name: "Home" })).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Send a document" })
        .getAttribute("href")
    ).toBe("/send");
    expect(screen.getByRole("link", { name: "Log in" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Create account" })).toBeTruthy();
  });
});
