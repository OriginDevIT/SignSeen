// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import ComingSoon from "./page";

const FORM_URL = "https://example.com/launch-form";

afterEach(() => {
  cleanup();
  delete process.env.NEXT_PUBLIC_GHL_LAUNCH_FORM_URL;
});

describe("coming-soon page", () => {
  it("renders the hero, the three steps, and the capture section", () => {
    render(<ComingSoon />);
    // getBy* throws when the element is missing, so reaching the end
    // of this test is the assertion.
    screen.getByText("Coming soon");
    screen.getByRole("heading", { name: "SignSeen" });
    screen.getByText("Be first to know when it launches");
    screen.getByText("1 · Signed");
    screen.getByText("2 · Seen");
    screen.getByText("3 · Sealed");
  });

  it("has no live-app links", () => {
    render(<ComingSoon />);
    expect(screen.queryByRole("link", { name: /send a document/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /create a free account/i })).toBeNull();
    expect(document.querySelector('a[href="/send"]')).toBeNull();
    expect(document.querySelector('a[href="/signup"]')).toBeNull();
  });

  it("falls back to a mailto link when the GHL form URL is unset", () => {
    render(<ComingSoon />);
    expect(screen.queryByTestId("launch-form")).toBeNull();
    const link = screen.getByRole("link", {
      name: "Email us to join the launch list",
    });
    expect(link.getAttribute("href")).toContain(
      "mailto:hello@getsignseen.com"
    );
  });

  it("renders the GHL form iframe when the form URL is set", () => {
    process.env.NEXT_PUBLIC_GHL_LAUNCH_FORM_URL = FORM_URL;
    render(<ComingSoon />);
    const frame = screen.getByTestId("launch-form");
    expect(frame.getAttribute("src")).toBe(FORM_URL);
    expect(
      screen.queryByRole("link", { name: "Email us to join the launch list" })
    ).toBeNull();
  });
});
