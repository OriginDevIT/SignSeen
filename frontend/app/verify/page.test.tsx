import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import VerifyPage from "./page";
import {
  MAX_VERIFY_FILE_BYTES,
  VERIFY_REASON_TEXT,
} from "../../lib/api";

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
    // Rate limits are disclosed up front, before the user hits them.
    expect(html).toContain("one document per minute");
    expect(html).toContain("up to 20 documents per hour");
  });

  it("explains what sealed means, what Valid and Invalid mean, and what to do if Invalid", () => {
    const html = renderToString(<VerifyPage />);
    expect(html).toContain("Sealed means locked");
    expect(html).toContain("A Valid result means the file matches the sealed original.");
    expect(html).toContain("An Invalid result means it does not match");
    expect(html).toContain("ask the sender for a fresh copy of the sealed file.");
  });

  it("renders the site navigation: brand home, Send, Log in (no separate Home link)", () => {
    const html = renderToString(<VerifyPage />);
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
