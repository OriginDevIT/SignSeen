// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// jsdom has no PointerEvent, so without this fireEvent.pointerDown
// builds a plain Event and clientX/clientY are lost (the drag code
// then reads NaN coordinates). Polyfill from MouseEvent, which carries
// the coordinates the page reads.
if (typeof window.PointerEvent === "undefined") {
  class TestPointerEvent extends MouseEvent {
    readonly pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  (window as unknown as { PointerEvent: typeof TestPointerEvent }).PointerEvent =
    TestPointerEvent;
}

import SendPage from "./page";
import {
  discardDraft,
  getAuthToken,
  getDocument,
  getDocumentFields,
  myAccount,
  sendDocument,
  startCheckout,
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
    startCheckout: vi.fn(),
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
  name: "",
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
    // the anonymous line may appear, and no step content renders yet
    // — the photo checkbox must not present itself as a disabled
    // premium feature, or at all, until the page is ready.
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(
      screen.queryByText(/Sending without an account is fine/),
    ).toBeNull();
    expect(screen.queryByText(/Signed in as/)).toBeNull();
    expect(screen.queryByText(/Premium feature/)).toBeNull();
    expect(
      screen.queryByRole("checkbox", { name: /Require a witness photo/ }),
    ).toBeNull();

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

  it("uses the account name for the 'Send to me' signer entry", async () => {
    vi.mocked(getAuthToken).mockReturnValue("token-1");
    vi.mocked(myAccount).mockResolvedValue({
      ...PREMIUM_ACCOUNT,
      name: "Owner Person",
    });
    vi.mocked(uploadDocument).mockResolvedValue(DRAFT_DOC as never);
    vi.mocked(getDocumentFields).mockResolvedValue({
      page_count: 1,
      fields: [],
    });
    render(<SendPage />);
    await waitFor(() =>
      expect(screen.getByText(/Signed in as owner@example.com/)).toBeTruthy(),
    );
    fillStep1();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Send to me for signature also/ }),
    );
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
      [
        { name: "", email: "jane@example.com" },
        { name: "Owner Person", email: "sender@example.com" },
      ],
    );
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

  it("resuming to step 3 never shows the step-1 form first (#153)", async () => {
    window.history.replaceState(null, "", "/send?draft=draft-1&step=3");
    window.sessionStorage.setItem("signseen_draft_token:draft-1", "tok-1");
    const pending = deferred<typeof DRAFT_DOC>();
    vi.mocked(getDocument).mockReturnValue(pending.promise);
    vi.mocked(getDocumentFields).mockResolvedValue({
      page_count: 1,
      fields: [],
    });
    vi.mocked(getAuthToken).mockReturnValue(null);
    render(<SendPage />);

    // The draft is still loading: only the loading state may appear —
    // no step-1 label and no details form fields.
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(
      screen.queryByText("Step 1 of 3 — Signers & document"),
    ).toBeNull();
    expect(
      screen.queryByPlaceholderText("e.g. Contractor Agreement"),
    ).toBeNull();

    pending.resolve(DRAFT_DOC);
    await waitFor(() =>
      expect(
        screen.getByText("Step 3 of 3 — Review & send"),
      ).toBeTruthy(),
    );
    // The details form never appeared on the way here.
    expect(
      screen.queryByPlaceholderText("e.g. Contractor Agreement"),
    ).toBeNull();
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

    // One signer row is the free limit for adding: the second signer
    // comes only via "Send to me", so the button is greyed out with
    // one row and the limit is explained — not only once two rows
    // exist (#150).
    expect(screen.getAllByPlaceholderText("Jane Doe")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Add another signer" }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByText(/The free plan allows up to 2 signers/),
    ).toBeTruthy();
    expect(
      screen.getByRole("checkbox", { name: /Send to me for signature also/ }),
    ).toHaveProperty("disabled", false);

    // Adding the sender via the checkbox keeps the button greyed out.
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Send to me for signature also/ }),
    );
    expect(screen.getAllByPlaceholderText("Jane Doe")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Add another signer" }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByText(/The free plan allows up to 2 signers/),
    ).toBeTruthy();
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

describe("SendPage 'Send to me' label (#169)", () => {
  async function renderSignedIn(account: typeof FREE_ACCOUNT) {
    vi.mocked(getAuthToken).mockReturnValue("token-1");
    vi.mocked(myAccount).mockResolvedValue(account);
    render(<SendPage />);
    await waitFor(() =>
      expect(screen.getByText(/Signed in as owner@example.com/)).toBeTruthy(),
    );
  }

  it("free accounts never see the 'sign last' clause (parallel only)", async () => {
    await renderSignedIn(FREE_ACCOUNT);
    expect(screen.getByText(/adds you as a signer/)).toBeTruthy();
    expect(screen.queryByText(/in sequential mode you sign last/)).toBeNull();
  });

  it("premium accounts see the clause only in sequential mode", async () => {
    await renderSignedIn(PREMIUM_ACCOUNT);
    // Parallel is the default: no signing order is promised.
    expect(screen.getByText(/adds you as a signer/)).toBeTruthy();
    expect(screen.queryByText(/in sequential mode you sign last/)).toBeNull();

    fireEvent.change(screen.getByLabelText(/Signing order/), {
      target: { value: "sequential" },
    });
    expect(screen.getByText(/in sequential mode you sign last/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Signing order/), {
      target: { value: "parallel" },
    });
    expect(screen.queryByText(/in sequential mode you sign last/)).toBeNull();
  });
});

describe("SendPage signer reorder (#111)", () => {
  function signerEmails() {
    return screen
      .getAllByPlaceholderText("jane@example.com")
      .map((el) => (el as HTMLInputElement).value);
  }

  async function renderPremiumWithThreeSigners() {
    vi.mocked(getAuthToken).mockReturnValue("token-1");
    vi.mocked(myAccount).mockResolvedValue(PREMIUM_ACCOUNT);
    render(<SendPage />);
    await waitFor(() =>
      expect(screen.getByText(/Signed in as owner@example.com/)).toBeTruthy(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Add another signer" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Add another signer" }),
    );
    const emails = screen.getAllByPlaceholderText("jane@example.com");
    expect(emails).toHaveLength(3);
    fireEvent.change(emails[0], { target: { value: "a@example.com" } });
    fireEvent.change(emails[1], { target: { value: "b@example.com" } });
    fireEvent.change(emails[2], { target: { value: "c@example.com" } });
  }

  it("move up/down buttons reorder the signers", async () => {
    await renderPremiumWithThreeSigners();
    expect(signerEmails()).toEqual([
      "a@example.com",
      "b@example.com",
      "c@example.com",
    ]);

    // The first row cannot move up and the last cannot move down.
    expect(
      screen.getByRole("button", { name: "Move signer 1 up" }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("button", { name: "Move signer 3 down" }),
    ).toHaveProperty("disabled", true);

    fireEvent.click(
      screen.getByRole("button", { name: "Move signer 1 down" }),
    );
    expect(signerEmails()).toEqual([
      "b@example.com",
      "a@example.com",
      "c@example.com",
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "Move signer 3 up" }),
    );
    expect(signerEmails()).toEqual([
      "b@example.com",
      "c@example.com",
      "a@example.com",
    ]);
  });

  it("dragging a signer row by its handle reorders the list", async () => {
    await renderPremiumWithThreeSigners();
    const rows = screen.getAllByTestId("signer-row");
    expect(rows).toHaveLength(3);
    // jsdom has no layout, so the rows report zero-size rects. Give
    // each row a stacked rect, as the place-fields tests do.
    const rects = new Map<HTMLElement, DOMRect>();
    rows.forEach((row, idx) => {
      rects.set(row as HTMLElement, {
        top: idx * 120,
        bottom: idx * 120 + 100,
        height: 100,
        width: 400,
        left: 0,
        right: 400,
        x: 0,
        y: idx * 120,
      } as DOMRect);
    });
    const spy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        return (
          rects.get(this as HTMLElement) ?? ({} as unknown as DOMRect)
        );
      });
    try {
      const handle = screen.getByTestId("reorder-handle-0");
      fireEvent.pointerDown(handle, { clientY: 50, pointerId: 1 });
      // Row 3 spans 240-340, midpoint 290: dropping at 260 lands
      // the first signer after the second, at the end of the list.
      fireEvent.pointerMove(handle, { clientY: 260, pointerId: 1 });
      fireEvent.pointerUp(handle, { clientY: 260, pointerId: 1 });
      expect(signerEmails()).toEqual([
        "b@example.com",
        "c@example.com",
        "a@example.com",
      ]);
    } finally {
      spy.mockRestore();
    }
  });

  it("a drag that ends on its own row leaves the order unchanged", async () => {
    await renderPremiumWithThreeSigners();
    const rows = screen.getAllByTestId("signer-row");
    const rects = new Map<HTMLElement, DOMRect>();
    rows.forEach((row, idx) => {
      rects.set(row as HTMLElement, {
        top: idx * 120,
        bottom: idx * 120 + 100,
        height: 100,
        width: 400,
        left: 0,
        right: 400,
        x: 0,
        y: idx * 120,
      } as DOMRect);
    });
    const spy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        return (
          rects.get(this as HTMLElement) ?? ({} as unknown as DOMRect)
        );
      });
    try {
      const handle = screen.getByTestId("reorder-handle-1");
      // Row 2 spans 120-220, midpoint 170: a small move that stays
      // above the midpoint keeps the drop target on its own row.
      fireEvent.pointerDown(handle, { clientY: 140, pointerId: 1 });
      fireEvent.pointerMove(handle, { clientY: 160, pointerId: 1 });
      fireEvent.pointerUp(handle, { clientY: 160, pointerId: 1 });
      expect(signerEmails()).toEqual([
        "a@example.com",
        "b@example.com",
        "c@example.com",
      ]);
    } finally {
      spy.mockRestore();
    }
  });

  it("submitting step 1 sends the reordered signer list", async () => {
    vi.mocked(uploadDocument).mockImplementation(
      async (
        _file: File,
        _title: string,
        _sender: string,
        _mode: string,
        _photo: boolean,
        signers: { name: string; email: string }[],
      ) =>
        ({
          ...DRAFT_DOC,
          signer_list: signers,
        }) as never,
    );
    vi.mocked(getDocumentFields).mockResolvedValue({
      page_count: 1,
      fields: [],
    });
    // Two signer rows need a premium account now that free senders
    // add a second signer only via "Send to me" (#150).
    vi.mocked(getAuthToken).mockReturnValue("token-1");
    vi.mocked(myAccount).mockResolvedValue(PREMIUM_ACCOUNT);
    render(<SendPage />);
    await waitFor(() =>
      expect(screen.getByText(/Signed in as owner@example.com/)).toBeTruthy(),
    );
    fireEvent.change(
      screen.getByPlaceholderText("e.g. Contractor Agreement"),
      { target: { value: "Contract" } },
    );
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "sender@example.com" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Add another signer" }),
    );
    const emails = screen.getAllByPlaceholderText("jane@example.com");
    fireEvent.change(emails[0], { target: { value: "a@example.com" } });
    fireEvent.change(emails[1], { target: { value: "b@example.com" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Move signer 1 down" }),
    );
    expect(signerEmails()).toEqual(["b@example.com", "a@example.com"]);
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
      [
        { name: "", email: "b@example.com" },
        { name: "", email: "a@example.com" },
      ],
    );

    // The review step shows the reordered list, which is what send
    // turns into sessions, in order.
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
    const signersBlock = screen.getByText("Signers:").parentElement as HTMLElement;
    const reviewItems = within(signersBlock)
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");
    expect(reviewItems[0]).toContain("b@example.com");
    expect(reviewItems[1]).toContain("a@example.com");
  });
});

describe("SendPage upgrade notices (#151)", () => {
  // Intercept the checkout navigation: jsdom cannot navigate, so
  // capture the URL the page assigns instead of letting it warn.
  function spyOnNavigation() {
    const original = window.location;
    let target = "";
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...original,
        set href(url: string) {
          target = url;
        },
        get href() {
          return target;
        },
      },
    });
    return {
      get target() {
        return target;
      },
      restore() {
        Object.defineProperty(window, "location", {
          configurable: true,
          value: original,
        });
      },
    };
  }

  it("anonymous visitors get signup links on every notice", async () => {
    await renderAnonymous();

    expect(
      screen.getByRole("link", { name: "upgrade" }).getAttribute("href"),
    ).toBe("/signup");
    expect(
      screen
        .getByRole("link", { name: "Upgrade to enable it." })
        .getAttribute("href"),
    ).toBe("/signup");

    fireEvent.click(
      screen.getByRole("button", { name: "Add another signer" }),
    );
    expect(
      screen.getByRole("link", { name: "Upgrade" }).getAttribute("href"),
    ).toBe("/signup");
    expect(vi.mocked(startCheckout)).not.toHaveBeenCalled();
  });

  it("logged-in free senders get checkout buttons (annual by default)", async () => {
    vi.mocked(getAuthToken).mockReturnValue("token-1");
    vi.mocked(myAccount).mockResolvedValue(FREE_ACCOUNT);
    vi.mocked(startCheckout).mockResolvedValue(
      "https://checkout.stripe.test/session-1",
    );
    const nav = spyOnNavigation();
    try {
      render(<SendPage />);
      await waitFor(() =>
        expect(
          screen.getByText(/Signed in as owner@example.com/),
        ).toBeTruthy(),
      );

      const photoUpgrade = screen.getByRole("button", { name: "upgrade" });
      const sequentialUpgrade = screen.getByRole("button", {
        name: "Upgrade to enable it.",
      });
      fireEvent.click(photoUpgrade);
      await waitFor(() =>
        expect(vi.mocked(startCheckout)).toHaveBeenCalledWith("annual"),
      );
      expect(nav.target).toBe("https://checkout.stripe.test/session-1");

      fireEvent.click(sequentialUpgrade);
      await waitFor(() =>
        expect(vi.mocked(startCheckout)).toHaveBeenCalledTimes(2),
      );

      fireEvent.click(
        screen.getByRole("button", { name: "Add another signer" }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
      await waitFor(() =>
        expect(vi.mocked(startCheckout)).toHaveBeenCalledTimes(3),
      );
    } finally {
      nav.restore();
    }
  });
});
