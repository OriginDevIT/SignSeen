// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";

import LegalDoc from "./LegalDoc";

describe("LegalDoc site navigation (#164)", () => {
  it("renders the shared navigation above the legal content", () => {
    const html = renderToString(
      <LegalDoc title="Terms of Service" updated="October 21, 2026">
        <p>Terms body.</p>
      </LegalDoc>
    );
    // Brand link home (the wordmark is the Home link), plus the shared navigation links.
    expect(html).toContain('href="/"');
    expect(html).toContain(">SignSeen</a>");
    expect(html).not.toContain(">Home</a>");
    expect(html).toContain('href="/send"');
    expect(html).toContain(">Send a document</a>");
    // Signed-out navigation (server render runs no effects, so the
    // logged-out links render).
    expect(html).toContain('href="/login"');
    expect(html).toContain(">Log in</a>");
    expect(html).toContain("Terms body.");
  });
});
