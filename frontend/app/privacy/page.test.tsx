// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";

import PrivacyPage from "./page";

describe("Privacy page tracking-link disclosure (#188)", () => {
  it("says a tracking link exposes signer names, emails, and signed times", () => {
    const html = renderToString(<PrivacyPage />);
    expect(html).toContain(
      "can see that document’s status, the names and email addresses of its signers, and when each signer signed"
    );
  });
});

describe("Privacy page Google sign-in disclosure (#209)", () => {
  it("says Google sign-in provides the verified email and, for a new account, the name", () => {
    const html = renderToString(<PrivacyPage />);
    expect(html).toContain(
      "Google provides your verified email address and, for a new account, your name"
    );
    expect(html).toContain("an optional name you can add or change on your profile page");
  });
});
