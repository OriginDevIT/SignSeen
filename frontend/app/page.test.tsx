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
});
