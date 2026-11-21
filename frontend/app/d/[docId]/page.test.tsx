// @vitest-environment jsdom
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import TrackDocumentPage from "./page";
import { getDocument, type DocumentInfo } from "../../../lib/api";

vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    getDocument: vi.fn(),
  };
});

const mockedGetDocument = vi.mocked(getDocument);

const PENDING_DOC: DocumentInfo = {
  id: "doc-1",
  title: "Test document",
  status: "pending",
  sender_email: "sender@example.com",
  signed_file: null,
  signing_mode: "parallel",
  photo_required: false,
  signing_url: "https://example.com/s/token-1",
  sessions: [
    {
      id: "sess-1",
      signer_name: "Signer One",
      signer_email: "signer@example.com",
      status: "pending",
      order: 0,
      signed_at: null,
    },
  ],
  created_at: "2026-11-21T13:00:00Z",
  updated_at: "2026-11-21T13:00:00Z",
};

function renderPage() {
  // The page unwraps its route params with React's use(). A plain
  // resolved promise suspends and its retry never flushes in this
  // vitest/jsdom environment, so pass a promise already marked
  // resolved — use() reads the status/value fields it attaches to
  // thenables and returns synchronously. The boundary stays: the
  // page suspends in production until the params resolve.
  const params = Promise.resolve({ docId: "doc-1" }) as Promise<{
    docId: string;
  }> & { status?: string; value?: { docId: string } };
  params.status = "fulfilled";
  params.value = { docId: "doc-1" };
  return render(
    <Suspense fallback={null}>
      <TrackDocumentPage params={params} />
    </Suspense>
  );
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("TrackDocumentPage branding", () => {
  it("shows the SignSeen brand header linking home", async () => {
    mockedGetDocument.mockResolvedValue(PENDING_DOC);
    renderPage();

    await waitFor(() =>
      expect(screen.getByRole("link", { name: "SignSeen" })).toBeTruthy()
    );
    expect(
      screen.getByRole("link", { name: "SignSeen" }).getAttribute("href")
    ).toBe("/");
  });

  it("shows the brand header on the not-found state", async () => {
    mockedGetDocument.mockRejectedValue(new Error("Not found"));
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Document not found")).toBeTruthy()
    );
    expect(
      screen.getByRole("link", { name: "SignSeen" }).getAttribute("href")
    ).toBe("/");
  });
});

describe("TrackDocumentPage navigation", () => {
  it("links back to the dashboard and to sending another document", async () => {
    mockedGetDocument.mockResolvedValue(PENDING_DOC);
    renderPage();

    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "View in dashboard" })
      ).toBeTruthy()
    );
    expect(
      screen
        .getByRole("link", { name: "View in dashboard" })
        .getAttribute("href")
    ).toBe("/dashboard");
    expect(
      screen
        .getByRole("link", { name: "Send another document" })
        .getAttribute("href")
    ).toBe("/send");
  });

  it("shows the same navigation on a signed document", async () => {
    mockedGetDocument.mockResolvedValue({
      ...PENDING_DOC,
      status: "signed",
      signed_file: "/media/signed.pdf",
      signing_url: null,
      sessions: [
        { ...PENDING_DOC.sessions![0], status: "signed" },
      ],
    });
    renderPage();

    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "View in dashboard" })
      ).toBeTruthy()
    );
    expect(
      screen
        .getByRole("link", { name: "Send another document" })
        .getAttribute("href")
    ).toBe("/send");
  });

  it("shows the signed date and time next to a signed signer, and none for a pending one", async () => {
    const signedAt = "2026-11-21T13:24:14Z";
    mockedGetDocument.mockResolvedValue({
      ...PENDING_DOC,
      status: "signed",
      signed_file: "/media/signed.pdf",
      signing_url: null,
      sessions: [
        { ...PENDING_DOC.sessions![0], status: "signed", signed_at: signedAt },
        {
          id: "sess-2",
          signer_name: "Signer Two",
          signer_email: "two@example.com",
          status: "pending",
          order: 1,
          signed_at: null,
        },
      ],
    });
    renderPage();

    const rendered = new Date(signedAt).toLocaleString();
    await waitFor(() =>
      expect(document.body.textContent).toContain(`signed — ${rendered}`)
    );
    expect(document.body.textContent).toContain("pending");
    // The pending row carries no timestamp.
    expect(document.body.textContent).not.toContain(`pending — ${rendered}`);
  });

  it("the signed-PDF link prompts a download instead of opening a new tab (#122)", async () => {
    mockedGetDocument.mockResolvedValue({
      ...PENDING_DOC,
      status: "signed",
      signed_file: "/media/signed.pdf",
      signing_url: null,
      sessions: [
        { ...PENDING_DOC.sessions![0], status: "signed" },
      ],
    });
    renderPage();

    const link = await screen.findByRole("link", {
      name: "Download signed PDF",
    });
    // The real mediaUrl prepends the API base in this test env.
    expect(link.getAttribute("href")).toContain("/media/signed.pdf");
    expect(link.hasAttribute("download")).toBe(true);
    expect(link.getAttribute("target")).toBeNull();
  });
});
