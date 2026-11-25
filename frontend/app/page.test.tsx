// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import Home from "./page";

afterEach(() => {
  cleanup();
});

describe("Home", () => {
  it("links to the document validation page from the hero (#149)", () => {
    render(<Home />);
    expect(
      screen
        .getByRole("link", { name: "Validate a signed document" })
        .getAttribute("href")
    ).toBe("/verify");
  });

  it("states no specific signing time in the hero (#202)", () => {
    const { container } = render(<Home />);
    expect(container.textContent).toContain("signs on their phone in moments");
    expect(container.textContent).not.toContain("30 seconds");
  });
});
