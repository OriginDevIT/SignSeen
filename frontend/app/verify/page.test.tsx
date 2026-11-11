import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import VerifyPage, {
  MAX_VERIFY_FILE_BYTES,
  VERIFY_REASON_TEXT,
} from "./page";

describe("VerifyPage", () => {
  it("renders the upload control, the retention promise, and the honest semantics", () => {
    const html = renderToString(<VerifyPage />);
    expect(html).toContain("Verify a signed document");
    expect(html).toContain("Drop a PDF here, or click to choose one");
    expect(html).toContain("PDF only, up to 15 MB.");
    expect(html).toContain("Verify this document");
    // Retention promise, in plain words. (The apostrophe is HTML-
    // escaped in server-rendered output, so assert around it.)
    expect(html).toContain("We don");
    expect(html).toContain("store your document.");
    expect(html).toContain("deleted right away");
    // Honest semantics: a copy verifies as valid; this proves
    // genuineness, not uniqueness.
    expect(html).toContain(
      "A copy of a genuine sealed document verifies as valid.",
    );
    expect(html).toContain("not that it is the only or original copy.");
  });

  it("caps uploads at 15 MB", () => {
    expect(MAX_VERIFY_FILE_BYTES).toBe(15 * 1024 * 1024);
  });

  it("explains every invalid reason category in plain words", () => {
    expect(Object.keys(VERIFY_REASON_TEXT).sort()).toEqual([
      "chain_broken",
      "file_altered",
      "not_a_signseen_document",
      "seal_mismatch",
    ]);
    for (const text of Object.values(VERIFY_REASON_TEXT)) {
      expect(text.length).toBeGreaterThan(0);
    }
  });
});
