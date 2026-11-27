// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import DashboardPage from "./page";
import {
  deleteDocument,
  getAuthToken,
  getBranding,
  myAccount,
  myDashboard,
  startCheckout,
} from "../../lib/api";

vi.mock("next/navigation", () => {
  // The page's load effect depends on the router object, so it must
  // be referentially stable across renders (as the real router is) -
  // a fresh object per call would re-run the effect every render.
  const router = { replace: vi.fn(), push: vi.fn() };
  return { useRouter: () => router };
});

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getAuthToken: vi.fn(),
    myAccount: vi.fn(),
    myDashboard: vi.fn(),
    getBranding: vi.fn(),
    deleteDocument: vi.fn(),
    startCheckout: vi.fn(),
  };
});

const FREE_ACCOUNT = {
  id: "acc-1",
  email: "owner@example.com",
  tier: "free" as const,
  is_premium: false,
  alerts_enabled: false,
  billing_status: "active" as const,
};

function doc(overrides: Record<string, unknown>) {
  return {
    id: "doc-1",
    title: "Contract",
    status: "pending",
    sender_email: "owner@example.com",
    original_file: "/media/originals/contract.pdf",
    signed_file: null,
    signing_mode: "parallel" as const,
    photo_required: false,
    signing_url: null,
    created_at: "2026-11-21T13:00:00Z",
    updated_at: "2026-11-21T13:00:00Z",
    ...overrides,
  };
}

const PENDING = doc({
  id: "doc-pending",
  title: "Pending contract",
  signing_url: "https://staging.getsignseen.com/s/token-1",
});
const DRAFT = doc({
  id: "doc-draft",
  title: "Draft contract",
  status: "draft",
});
const SIGNED = doc({
  id: "doc-signed",
  title: "Signed contract",
  status: "signed",
  signed_file: "/media/signed/signed.pdf",
});
const EXPIRED = doc({
  id: "doc-expired",
  title: "Expired contract",
  status: "expired",
});

function loadDashboard(
  documents: ReturnType<typeof doc>[],
  premium = false,
) {
  vi.mocked(getAuthToken).mockReturnValue("token-1");
  vi.mocked(myAccount).mockResolvedValue(
    premium
      ? { ...FREE_ACCOUNT, tier: "premium" as const, is_premium: true }
      : FREE_ACCOUNT,
  );
  vi.mocked(myDashboard).mockResolvedValue({
    tier: premium ? "premium" : "free",
    is_premium: premium,
    storage_used_bytes: 0,
    storage_limit_bytes: (premium ? 5 * 1024 : 100) * 1024 * 1024,
    documents,
    signed_documents: [],
  });
  vi.mocked(getBranding).mockRejectedValue(new Error("no branding"));
  render(<DashboardPage />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DashboardPage document tabs (#104)", () => {
  it("groups documents into In Progress, Draft, Complete, and Expired tabs with counts", async () => {
    loadDashboard([PENDING, DRAFT, SIGNED, EXPIRED]);

    expect(await screen.findByRole("tab", { name: "In Progress (1)" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Draft (1)" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Complete (1)" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Expired (1)" })).toBeTruthy();

    // In Progress is the default tab: only the pending document shows.
    expect(screen.getByText("Pending contract")).toBeTruthy();
    expect(screen.queryByText("Draft contract")).toBeNull();
    expect(screen.queryByText("Signed contract")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Draft (1)" }));
    expect(screen.getByText("Draft contract")).toBeTruthy();
    expect(screen.queryByText("Pending contract")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Complete (1)" }));
    expect(screen.getByText("Signed contract")).toBeTruthy();
    expect(screen.queryByText("Expired contract")).toBeNull();
    expect(screen.queryByText("Pending contract")).toBeNull();

    // Expired documents get their own tab (#197): an expired unsigned
    // document is not complete.
    fireEvent.click(screen.getByRole("tab", { name: "Expired (1)" }));
    expect(screen.getByText("Expired contract")).toBeTruthy();
    expect(screen.queryByText("Signed contract")).toBeNull();
  }, 10000);

  it("shows an empty message for a tab with no documents", async () => {
    loadDashboard([PENDING]);

    fireEvent.click(await screen.findByRole("tab", { name: "Draft (0)" }));
    expect(screen.getByText("No drafts.")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Expired (0)" }));
    expect(screen.getByText("No expired documents.")).toBeTruthy();
  });

  it("shows a 'Documents you've sent' header above the tabs (#154)", async () => {
    loadDashboard([PENDING]);

    const header = await screen.findByRole("heading", {
      name: "Documents you've sent",
    });
    expect(header).toBeTruthy();
    const tablist = screen.getByRole("tablist");
    expect(
      header.compareDocumentPosition(tablist) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});

describe("DashboardPage row actions (#104)", () => {
  it("downloads the signed copy for signed documents and the original otherwise", async () => {
    loadDashboard([PENDING, SIGNED]);

    const pendingDownload = await screen.findByRole("link", { name: "Download" });
    expect(pendingDownload.getAttribute("href")).toContain(
      "/media/originals/contract.pdf"
    );

    fireEvent.click(screen.getByRole("tab", { name: "Complete (1)" }));
    const signedDownload = screen.getByRole("link", { name: "Download" });
    expect(signedDownload.getAttribute("href")).toContain("/media/signed/signed.pdf");
    expect(signedDownload.getAttribute("download")).toContain("signed");
  });

  it("asks for confirmation before deleting, then removes the row", async () => {
    loadDashboard([PENDING, DRAFT]);
    vi.mocked(deleteDocument).mockResolvedValue(undefined);

    await screen.findByText("Pending contract");
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);

    // Nothing deleted yet: the confirm step appears first.
    expect(vi.mocked(deleteDocument)).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Delete this document\? The document and its files/)
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() =>
      expect(vi.mocked(deleteDocument)).toHaveBeenCalledWith("doc-pending")
    );
    await waitFor(() =>
      expect(screen.queryByText("Pending contract")).toBeNull()
    );
    // Still on the In Progress tab, now empty.
    expect(screen.getByText("No documents in progress.")).toBeTruthy();
  });

  it("cancelling the delete leaves the document in place", async () => {
    loadDashboard([PENDING]);

    await screen.findByText("Pending contract");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(vi.mocked(deleteDocument)).not.toHaveBeenCalled();
    expect(screen.getByText("Pending contract")).toBeTruthy();
    expect(screen.queryByText(/Delete this document\?/)).toBeNull();
  });

  it("deletes drafts from the Draft tab the same way", async () => {
    loadDashboard([DRAFT]);
    vi.mocked(deleteDocument).mockResolvedValue(undefined);

    fireEvent.click(await screen.findByRole("tab", { name: "Draft (1)" }));
    expect(screen.getByText("Draft contract")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() =>
      expect(vi.mocked(deleteDocument)).toHaveBeenCalledWith("doc-draft")
    );
    await waitFor(() =>
      expect(screen.queryByText("Draft contract")).toBeNull()
    );
    // The last document is gone, so the overall empty state returns.
    expect(screen.getByText(/No documents yet/)).toBeTruthy();
  });
});

describe("DashboardPage upgrade notices (#151)", () => {
  it("the pending-limit and branding notices are checkout buttons (annual by default)", async () => {
    vi.mocked(startCheckout).mockResolvedValue(
      "https://checkout.stripe.test/session-1",
    );
    const originalLocation = window.location;
    let navigatedTo = "";
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        set href(url: string) {
          navigatedTo = url;
        },
        get href() {
          return navigatedTo;
        },
      },
    });
    try {
      loadDashboard([PENDING]);
      await waitFor(() =>
        expect(screen.getByText("Pending contract")).toBeTruthy(),
      );

      fireEvent.click(
        screen.getByRole("button", { name: "upgrade to premium" }),
      );
      await waitFor(() =>
        expect(vi.mocked(startCheckout)).toHaveBeenCalledWith("annual"),
      );
      expect(navigatedTo).toBe("https://checkout.stripe.test/session-1");

      fireEvent.click(screen.getByRole("button", { name: "upgrade" }));
      await waitFor(() =>
        expect(vi.mocked(startCheckout)).toHaveBeenCalledTimes(2),
      );
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
    }
  });
});

describe("DashboardPage site navigation (#164)", () => {
  it("shows the shared navigation above the documents", async () => {
    loadDashboard([PENDING]);

    expect(await screen.findByText("Pending contract")).toBeTruthy();
    expect(screen.getByRole("link", { name: "SignSeen" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
    // The header nav and the page's own "Send a document" button
    // both read "Send a document" and both point at /send.
    const sendLinks = screen.getAllByRole("link", {
      name: "Send a document",
    });
    expect(sendLinks).toHaveLength(2);
    expect(sendLinks.every((l) => l.getAttribute("href") === "/send")).toBe(
      true
    );
    // Signed in here (loadDashboard stores a token), so the header
    // shows Dashboard rather than the logged-out links.
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Dashboard" })).toBeTruthy()
    );
    expect(screen.queryByRole("link", { name: "Log in" })).toBeNull();
  });
});

describe("DashboardPage signing alerts toggle (#186)", () => {
  it("is disabled for free accounts, since alerts only send for premium", async () => {
    loadDashboard([PENDING]);

    const toggle = await screen.findByRole("checkbox", {
      name: /Signing alerts/,
    });
    expect(toggle).toHaveProperty("disabled", true);
  });

  it("is enabled for premium accounts", async () => {
    loadDashboard([PENDING], true);

    const toggle = await screen.findByRole("checkbox", {
      name: /Signing alerts/,
    });
    expect(toggle).toHaveProperty("disabled", false);
  });
});

describe("DashboardPage premium buttons (#198)", () => {
  it("the annual button says it saves $10/yr against monthly billing", async () => {
    loadDashboard([PENDING]);

    await screen.findByText("Pending contract");
    expect(
      screen.getByRole("button", {
        name: "Premium - $50/yr - Save $10/yr",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Premium - $5/mo" }),
    ).toBeTruthy();
  });
});
