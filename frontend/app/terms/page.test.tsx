import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import TermsPage from "./page";

describe("TermsPage premium list (#187)", () => {
  it("names the premium-only features: 20 signers, sequential signing, photo-required, expiry alerts, 10 drafts", () => {
    const html = renderToString(<TermsPage />);
    expect(html).toContain("up to 20 signers");
    expect(html).toContain("per document with sequential signing");
    expect(html).toContain("the option to require a");
    expect(html).toContain("witness photo");
    expect(html).toContain("status tracking and expiry alerts");
    expect(html).toContain("10 drafts instead of 3 on the free tier");
  });
});
