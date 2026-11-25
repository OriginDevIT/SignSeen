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
