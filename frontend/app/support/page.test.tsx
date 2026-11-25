// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";

import SupportPage from "./page";

describe("SupportPage site navigation (#164)", () => {
  it("renders the shared navigation above the support content", () => {
    const html = renderToString(<SupportPage />);
    // Brand link home (the wordmark is the Home link), plus the shared navigation links.
    expect(html).toContain('href="/"');
    expect(html).toContain(">SignSeen</a>");
    expect(html).not.toContain(">Home</a>");
    expect(html).toContain('href="/send"');
    expect(html).toContain(">Send a document</a>");
    // No auth links in the server render (the account check has not
    // settled yet, so the header shows no auth links at all, #201).
    expect(html).not.toContain('href="/login"');
    expect(html).not.toContain('href="/signup"');
    expect(html).not.toContain('href="/dashboard"');
    expect(html).toContain("Support");
  });
});
