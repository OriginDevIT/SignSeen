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

describe("TermsPage summary and contents (#189)", () => {
  it("renders a plain-language summary covering the service, tiers, verification, and governing law", () => {
    const html = renderToString(<TermsPage />);
    expect(html).toContain("In short");
    expect(html).toContain("electronic signature service");
    expect(html).toContain("photographic witness");
    expect(html).toContain("The free tier covers one document");
    expect(html).toContain("$5/month or $50/year");
    expect(html).toContain("check a sealed document");
    expect(html).toContain("public verify page");
    expect(html).toContain("laws of the State of Illinois");
  });

  it("renders a contents list linking to all 11 sections", () => {
    const html = renderToString(<TermsPage />);
    for (let n = 1; n <= 11; n++) {
      expect(html).toContain(`href="#section-${n}"`);
      expect(html).toContain(`id="section-${n}"`);
    }
    expect(html).toContain("4. Plans, billing, and the account lifecycle");
    expect(html).toContain("10. General");
  });
});
