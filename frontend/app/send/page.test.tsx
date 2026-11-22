// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import SendPage from "./page";
import {
  discardDraft,
  getAuthToken,
  getDocument,
  getDocumentFields,
  myAccount,
  sendDocument,
  uploadDocument,
} from "../../lib/api";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getAuthToken: vi.fn(),
    myAccount: vi.fn(),
    uploadDocument: vi.fn(),
    createDocumentFromUrl: vi.fn(),
    getDocument: vi.fn(),
    getDocumentFields: vi.fn(),
    patchDocument: vi.fn(),
    sendDocument: vi.fn(),
    discardDraft: vi.fn(),
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const FREE_ACCOUNT = {
  id: "acc-1",
  email: "owner@example.com",
  tier: "free" as const,
  is_premium: false,
  alerts_enabled: false,
  billing_status: "active" as const,
};

const PREMIUM_ACCOUNT = {
  ...FREE_ACCOUNT,
  tier: "premium" as const,
  is_premium: true,
};

function photoCheckbox() {
  return screen.getByRole("checkbox", { name: /Require a witness photo/ });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
  window.sessionStorage.clear();
});

describe("SendPage branding (#112)", () => {
  it("shows the SignSeen brand header linking home", () => {
    vi.mocked(getAuthToken).mockReturnValue(null);

    render(<SendPage />);

    expect(
      screen.getByRole("link", { name: "SignSeen" }).getAttribute("href"),
    ).toBe("/");
  });
});

describe("SendPage session loading (#82)", () => {
  it("shows a loading state, not the logged-out view, while the session resolves", async () => {
    vi.mocked(getAuthToken).mockReturnValue("token-1");
    const pending = deferred<typeof FREE_ACCOUNT>();
    vi.mocked(myAccount).mockReturnValue(pending.promise);

    render(<SendPage />);

    // The session is still unknown: neither the signed-in line nor
    // the anonymous line may appear, and the photo checkbox must not
    // present itself as a disabled premium feature yet.
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(
      screen.queryByText(/Sending without an account is fine/),
    ).toBeNull();
    expect(screen.queryByText(/Signed in as/)).toBeNull();
    expect(screen.queryByText(/Premium feature/)).toBeNull();
    expect(photoCheckbox()).toHaveProperty("disabled", true);

    pending.resolve(PREMIUM_ACCOUNT);
    await waitFor(() =>
      expect(screen.getByText(/Signed in as owner@example.com/)).toBeTruthy(),
    );
    expect(screen.queryByText("Loading…")).toBeNull();
    expect(photoCheckbox()).toHaveProperty("disabled", false);
  });

  it("shows the premium note only once a free account is known", async () => {
    vi.mocked(getAuthToken).mockReturnValue("token-1");
    vi.mocked(myAccount).mockResolvedValue(FREE_ACCOUNT);

    render(<SendPage />);

    await waitFor(() =>
      expect(screen.getByText(/Signed in as owner@example.com/)).toBeTruthy(),
    );
    expect(screen.queryByText("Loading…")).toBeNull();
    expect(photoCheckbox()).toHaveProperty("disabled", true);
    expect(screen.getByText(/Premium feature/)).toBeTruthy();
  });

  it("shows the logged-out view once a missing session is known", async () => {
    vi.mocked(getAuthToken).mockReturnValue(null);
    render(<SendPage />);

    await waitFor(() =>
      expect(
        screen.getByText(/Sending without an account is fine/),
      ).toBeTruthy(),
    );
    expect(screen.queryByText("Loading…")).toBeNull();
    expect(vi.mocked(myAccount)).not.toHaveBeenCalled();
    expect(photoCheckbox()).toHaveProperty("disabled", true);
    expect(screen.getByText(/Premium feature/)).toBeTruthy();
  });
});

const DRAFT_DOC = {
  id: "draft-1",
  title: "Contract",
  status: "draft",
  sender_email: "sender@example.com",
  signed_file: null,
  signing_mode: "parallel" as const,
  photo_required: false,
  signer_list: [{ name: "", email: "jane@example.com" }],
  draft_token: "tok-1",
  created_at: "2026-11-21T00:00:00Z",
  updated_at: "2026-11-21T00:00:00Z",
};

const SENT_SESSION = {
  id: "sess-1",
  document: "draft-1",
  document_title: "Contract",
  document_status: "pending",
  photo_required: false,
  sender_email: "sender@example.com",
  token: "tok-s",
  signer_name: "",
  signer_email: "jane@example.com",
  status: "pending",
  order: 0,
  usable: true,
  waiting: false,
  branding: { name: "", color: "", logo: null },
  expires_at: "2026-12-21T00:00:00Z",
  created_at: "2026-11-21T00:00:00Z",
  signing_url: "http://localhost:3000/s/tok-s",
  fields: [],
};

function renderAnonymous() {
  vi.mocked(getAuthToken).mockReturnValue(null);
  render(<SendPage />);
  return waitFor(() =>
    expect(
      screen.getByText(/Sending without an account is fine/),
    ).toBeTruthy(),
  );
}

function fillStep1() {
  fireEvent.change(screen.getByPlaceholderText("e.g. Contractor Agreement"), {
    target: { value: "Contract" },
  });
  fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
    target: { value: "sender@example.com" },
  });
  fireEvent.change(screen.getByPlaceholderText("jane@example.com"), {
    target: { value: "jane@example.com" },
  });
  const fileInput = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  fireEvent.change(fileInput, {
    target: {
      files: [
        new File(["%PDF-"], "contract.pdf", { type: "application/pdf" }),
      ],
    },
  });
}

describe("SendPage wizard (#89)", () => {
  it("step 1 creates a draft with the signer list and advances to step 2", async () => {
    vi.mocked(uploadDocument).mockResolvedValue(DRAFT_DOC as never);
    vi.mocked(getDocumentFields).mockResolvedValue({
      page_count: 1,
      fields: [],
    });
    await renderAnonymous();
    fillStep1();
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);

    await waitFor(() =>
      expect(
        screen.getByText("Step 2 of 3 — Place fields (optional)"),
      ).toBeTruthy(),
    );
    expect(vi.mocked(uploadDocument)).toHaveBeenCalledWith(
      expect.any(File),
      "Contract",
      "sender@example.com",
      "parallel",
      false,
      [{ name: "", email: "jane@example.com" }],
    );
    expect(
      window.sessionStorage.getItem("signseen_draft_token:draft-1"),
    ).toBe("tok-1");
    // No session was created and no email sent at step 1: the page
    // holds no signing link yet.
    expect(screen.queryByText("Ready to sign")).toBeNull();
  });

  it("step 2 skip -> review -> send shows the confirmation with links", async () => {
    vi.mocked(uploadDocument).mockResolvedValue(DRAFT_DOC as never);
    vi.mocked(getDocumentFields).mockResolvedValue({
      page_count: 1,
      fields: [],
    });
    vi.mocked(sendDocument).mockResolvedValue({
      document: { ...DRAFT_DOC, status: "pending" },
      sessions: [SENT_SESSION],
    } as never);
    await renderAnonymous();
    fillStep1();
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    await waitFor(() =>
      expect(
        screen.getByText("Step 2 of 3 — Place fields (optional)"),
      ).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Skip — no fields needed, continue to review",
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByText("Step 3 of 3 — Review & send"),
      ).toBeTruthy(),
    );
    expect(screen.getByText(/jane@example.com/)).toBeTruthy();
    expect(screen.getByText(/Fields placed:/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Send document" }));
    await waitFor(() =>
      expect(screen.getByText("Ready to sign")).toBeTruthy(),
    );
    expect(vi.mocked(sendDocument)).toHaveBeenCalledWith("draft-1", "tok-1");
    expect(
      window.sessionStorage.getItem("signseen_send_result:draft-1"),
    ).toContain("tok-s");
    // The post-send page has no add-another-signer block.
    expect(screen.queryByText(/Add another signer/)).toBeNull();
    // The sent confirmation offers no way back to field placement:
    // fields are placed before sending (#95).
    expect(
      screen.queryByRole("link", { name: /Place fields on this document/ }),
    ).toBeNull();
    // The dashboard link still offers a way out of the confirmation.
    expect(
      screen.getByRole("link", { name: "View in dashboard" }),
    ).toBeTruthy();
  });

  it("discard draft deletes it and returns to a fresh step 1", async () => {
    vi.mocked(uploadDocument).mockResolvedValue(DRAFT_DOC as never);
    vi.mocked(getDocumentFields).mockResolvedValue({
      page_count: 1,
      fields: [],
    });
    vi.mocked(discardDraft).mockResolvedValue(undefined as never);
    await renderAnonymous();
    fillStep1();
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    await waitFor(() =>
      expect(
        screen.getByText("Step 2 of 3 — Place fields (optional)"),
      ).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    await waitFor(() =>
      expect(
        screen.getByText("Step 1 of 3 — Signers & document"),
      ).toBeTruthy(),
    );
    expect(vi.mocked(discardDraft)).toHaveBeenCalledWith("draft-1", "tok-1");
    expect(
      window.sessionStorage.getItem("signseen_draft_token:draft-1"),
    ).toBeNull();
  });

  it("refreshing mid-flow resumes the draft from the URL", async () => {
    window.history.replaceState(null, "", "/send?draft=draft-1&step=3");
    window.sessionStorage.setItem("signseen_draft_token:draft-1", "tok-1");
    vi.mocked(getDocument).mockResolvedValue(DRAFT_DOC as never);
    vi.mocked(getDocumentFields).mockResolvedValue({
      page_count: 1,
      fields: [],
    });
    await renderAnonymous();
    await waitFor(() =>
      expect(
        screen.getByText("Step 3 of 3 — Review & send"),
      ).toBeTruthy(),
    );
    expect(vi.mocked(getDocument)).toHaveBeenCalledWith("draft-1", "tok-1");
    expect(screen.getByText(/jane@example.com/)).toBeTruthy();
    expect(screen.getByText("Contract")).toBeTruthy();
  });

  it("free accounts are capped at 2 signers and parallel only", async () => {
    vi.mocked(getAuthToken).mockReturnValue("token-1");
    vi.mocked(myAccount).mockResolvedValue(FREE_ACCOUNT);
    render(<SendPage />);
    await waitFor(() =>
      expect(screen.getByText(/Signed in as owner@example.com/)).toBeTruthy(),
    );

    // Sequential is disabled for free, with the premium note.
    expect(
      screen.getByRole("option", { name: /Sequential/ }),
    ).toHaveProperty("disabled", true);
    expect(screen.getByText(/Sequential order is a premium feature/)).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Add another signer" }),
    );
    expect(screen.getAllByPlaceholderText("Jane Doe")).toHaveLength(2);
    // At the cap the add control disables and the limit is explained.
    expect(
      screen.getByRole("button", { name: "Add another signer" }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByText(/The free plan allows up to 2 signers/),
    ).toBeTruthy();
    expect(
      screen.getByRole("checkbox", { name: /Send to me for signature also/ }),
    ).toHaveProperty("disabled", true);
  });

  it("premium accounts can add a third signer and choose sequential", async () => {
    vi.mocked(getAuthToken).mockReturnValue("token-1");
    vi.mocked(myAccount).mockResolvedValue(PREMIUM_ACCOUNT);
    render(<SendPage />);
    await waitFor(() =>
      expect(screen.getByText(/Signed in as owner@example.com/)).toBeTruthy(),
    );

    expect(
      screen.getByRole("option", { name: /Sequential/ }),
    ).toHaveProperty("disabled", false);
    fireEvent.click(
      screen.getByRole("button", { name: "Add another signer" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Add another signer" }),
    );
    expect(screen.getAllByPlaceholderText("Jane Doe")).toHaveLength(3);
    expect(
      screen.getByRole("button", { name: "Add another signer" }),
    ).toHaveProperty("disabled", false);
  });

  it("draft token storage round-trips per draft id", async () => {
    const api = await import("../../lib/api");
    expect(api.getDraftToken("draft-1")).toBeNull();
    api.setDraftToken("draft-1", "tok-1");
    api.setDraftToken("draft-2", "tok-2");
    expect(api.getDraftToken("draft-1")).toBe("tok-1");
    expect(api.getDraftToken("draft-2")).toBe("tok-2");
    api.clearDraftToken("draft-1");
    expect(api.getDraftToken("draft-1")).toBeNull();
    expect(api.getDraftToken("draft-2")).toBe("tok-2");
  });
});
