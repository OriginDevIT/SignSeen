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

  it("leads with the photo witness and the public verify page (#214)", () => {
    const { container } = render(<Home />);
    expect(container.textContent).toContain("photographic witness");
    expect(container.textContent).toContain("public verify page");
    expect(container.textContent).toContain(
      "no other major e-signature tool offers one"
    );
    // The verify page is prominent: a hero call to action leads to it.
    expect(
      screen
        .getByRole("link", { name: "Validate a signed document" })
        .getAttribute("href")
    ).toBe("/verify");
  });

  it("leads with the price in the hero (#203)", () => {
    const { container } = render(<Home />);
    expect(container.textContent).toContain(
      "Free to send your first document. Premium is $5/month or $50/year."
    );
  });

  it("states the legality line near the hero (#204)", () => {
    const { container } = render(<Home />);
    expect(container.textContent).toContain(
      "Signatures are legally binding under the ESIGN Act and UETA."
    );
  });

  it("frames the free tier as no monthly limit, one pending at a time (#205)", () => {
    const { container } = render(<Home />);
    expect(container.textContent).toContain(
      "No monthly limit - 1 document pending at a time"
    );
    expect(container.textContent).toContain(
      "No account needed to send a document."
    );
    // The free pricing card no longer implies a one-document cap.
    const freeCard = screen.getByText("Free - $0").closest("div");
    expect(freeCard?.textContent).not.toContain("first document");
  });
});
