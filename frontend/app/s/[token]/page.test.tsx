// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useParams: () => ({ token: "tok-1" }),
}));

vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    getSession: vi.fn(),
    getDocument: vi.fn(),
    getSessionEvents: vi.fn(),
    submitSignature: vi.fn(),
    sessionPageUrl: vi.fn((_token: string, page: number) => `/page-${page}.png`),
    sessionDocumentUrl: vi.fn(() => "/document.pdf"),
    mediaUrl: vi.fn((u: string | null) => u),
  };
});

import { getDocument, getSession, getSessionEvents, submitSignature } from "../../../lib/api";

// The draw pads are canvas-based; jsdom has no 2d context, so the
// stub stands in with a handle that reports ink and hands back a
// fixed data URL — enough to exercise capture and reuse.
vi.mock("../../../components/SignaturePad", async () => {
  const React = await import("react");
  const Stub = React.forwardRef((_props: { height?: number }, ref) => {
    React.useImperativeHandle(ref, () => ({
      clear: () => {},
      isEmpty: () => false,
      toDataURL: () => "data:image/png;base64,stubpad",
    }));
    return <div data-testid="stub-pad">stub pad</div>;
  });
  return { default: Stub };
});

import SignPage from "./page";

const field = (
  id: string,
  type: "signature" | "initials" | "checkbox" | "text" | "date" | "signed_date",
  page: number,
  x: number,
  y: number,
  required = true
) => ({
  id,
  document: "doc-1",
  session: "sess-1",
  type,
  page,
  x,
  y,
  width: 0.3,
  height: 0.15,
  required,
  value: "",
  completed: false,
  completed_at: null,
  created_at: "2026-11-11T00:00:00Z",
});

const SESSION = {
  id: "sess-1",
  document: "doc-1",
  document_title: "Contract",
  document_status: "pending",
  photo_required: false,
  sender_email: "owner@example.com",
  token: "tok-1",
  signer_name: "Alice",
  signer_email: "alice@example.com",
  status: "pending",
  order: 0,
  usable: true,
  waiting: false,
  branding: { name: "", color: "", logo: null },
  expires_at: "2026-12-11T00:00:00Z",
  created_at: "2026-11-11T00:00:00Z",
  signing_url: "https://example.com/s/tok-1",
  fields: [
    field("f-sig", "signature", 1, 0.1, 0.2),
    field("f-text", "text", 1, 0.1, 0.45),
    field("f-check", "checkbox", 1, 0.1, 0.6, false),
    field("f-date", "date", 2, 0.1, 0.2, false),
    field("f-init", "initials", 2, 0.1, 0.45, false),
    field("f-sig2", "signature", 2, 0.1, 0.65, false),
  ],
};

async function renderIntro() {
  vi.mocked(getSession).mockResolvedValue(SESSION as never);
  render(<SignPage />);
  await screen.findByText("Contract");
}

async function renderSigning() {
  await renderIntro();
  fireEvent.click(screen.getByText("Start signing"));
  await screen.findByText("1. Your fields on this document");
}

describe("SignPage phone QR (#94)", () => {
  let scrollIntoViewMock: ReturnType<typeof vi.fn>;
  let origScrollIntoView: typeof Element.prototype.scrollIntoView;

  beforeEach(() => {
    scrollIntoViewMock = vi.fn();
    origScrollIntoView = Element.prototype.scrollIntoView;
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: scrollIntoViewMock,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: origScrollIntoView,
      configurable: true,
      writable: true,
    });
    vi.clearAllMocks();
  });

  it("intro step offers a continue-on-your-phone QR with the signing URL", async () => {
    await renderIntro();
    expect(screen.queryByText("https://example.com/s/tok-1")).toBeNull();
    fireEvent.click(screen.getByText("Continue on your phone"));
    expect(screen.getByText("https://example.com/s/tok-1")).toBeTruthy();
    expect(screen.getByText("Hide QR code")).toBeTruthy();
    // Toggling hides it again.
    fireEvent.click(screen.getByText("Hide QR code"));
    expect(screen.queryByText("https://example.com/s/tok-1")).toBeNull();
  });

  it("sign step offers the same QR", async () => {
    await renderIntro();
    fireEvent.click(screen.getByText("Start signing"));
    await screen.findByText("1. Your fields on this document");
    fireEvent.click(screen.getByText("Continue on your phone"));
    expect(screen.getByText("https://example.com/s/tok-1")).toBeTruthy();
  });
});

describe("SignPage field modals (#84)", () => {
  let scrollIntoViewMock: ReturnType<typeof vi.fn>;
  let origScrollIntoView: typeof Element.prototype.scrollIntoView;

  beforeEach(() => {
    scrollIntoViewMock = vi.fn();
    origScrollIntoView = Element.prototype.scrollIntoView;
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: scrollIntoViewMock,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: origScrollIntoView,
      configurable: true,
      writable: true,
    });
    vi.clearAllMocks();
  });

  it("entering the sign step scrolls to the first incomplete field", async () => {
    await renderSigning();
    await waitFor(() =>
      expect(scrollIntoViewMock).toHaveBeenCalled()
    );
    // First incomplete field in document order is the signature box.
    const sigBox = screen.getByLabelText(/signature field on page 1/);
    expect(
      scrollIntoViewMock.mock.instances[0]
    ).toBe(sigBox);
  });

  it("clicking a text field opens its modal; completing it scrolls to the next field", async () => {
    await renderSigning();
    const textBox = screen.getByLabelText(/text field on page 1/);
    fireEvent.click(textBox);

    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBe("Text — page 1");
    const input = screen.getByPlaceholderText("Type here");
    fireEvent.change(input, { target: { value: "Agreed" } });
    fireEvent.click(screen.getByText("Done"));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull()
    );
    // Completed fields render green.
    expect(getComputedStyle(textBox).borderColor).toBe("rgb(21, 128, 61)");
    // Auto-scroll moved on to the next incomplete field (checkbox).
    // The entry scroll is skipped once the signer has opened a field,
    // so the checkbox scroll is the last call — counting calls would
    // depend on whether the 100ms entry timer beat the modal open.
    const checkBox = screen.getByLabelText(/checkbox field on page 1/);
    await waitFor(() =>
      expect(
        scrollIntoViewMock.mock.instances[
          scrollIntoViewMock.mock.instances.length - 1
        ]
      ).toBe(checkBox)
    );
  });

  it("checkbox, date and initials fields each get the right widget", async () => {
    await renderSigning();

    // Checkbox: toggle then Done.
    fireEvent.click(screen.getByLabelText(/checkbox field on page 1/));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByLabelText("Check the box"));
    fireEvent.click(screen.getByText("Done"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull()
    );
    expect(
      getComputedStyle(screen.getByLabelText(/checkbox field on page 1/))
        .borderColor
    ).toBe("rgb(21, 128, 61)");

    // Date: the input defaults to today; Done completes it.
    fireEvent.click(screen.getByLabelText(/date field on page 2/));
    await screen.findByRole("dialog");
    expect(screen.getByDisplayValue(new Date().toISOString().slice(0, 10))).toBeTruthy();
    fireEvent.click(screen.getByText("Done"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull()
    );
    expect(
      getComputedStyle(screen.getByLabelText(/date field on page 2/))
        .borderColor
    ).toBe("rgb(21, 128, 61)");

    // Initials: draw pad with a "Use this initials" button. The
    // document pad renders a stub too, so scope to the dialog.
    fireEvent.click(screen.getByLabelText(/initials field on page 2/));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTestId("stub-pad")).toBeTruthy();
    fireEvent.click(within(dialog).getByText("Use this initials"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull()
    );
    expect(
      getComputedStyle(screen.getByLabelText(/initials field on page 2/))
        .borderColor
    ).toBe("rgb(21, 128, 61)");
  });

  it("Cancel closes the modal without completing the field", async () => {
    await renderSigning();
    fireEvent.click(screen.getByLabelText(/text field on page 1/));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull()
    );
    const textBox = screen.getByLabelText(/text field on page 1/);
    expect(getComputedStyle(textBox).borderColor).toBe("rgb(17, 24, 39)");
  });

  it("a signature drawn in one modal is offered for reuse in the next and in the document pad", async () => {
    await renderSigning();

    // First signature field: draw and use it.
    fireEvent.click(screen.getByLabelText(/signature field on page 1/));
    await screen.findByRole("dialog");
    expect(screen.queryByText("Use your signature")).toBeNull();
    fireEvent.click(screen.getByText("Use this signature"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull()
    );

    // Second signature field: the drawn signature is offered. The
    // document pad shows the same button, so scope to the dialog.
    const sig2Boxes = screen.getAllByLabelText(/signature field on page 2/);
    fireEvent.click(sig2Boxes[0]);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByText("Use your signature"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull()
    );

    // The document pad (after the fields) offers it too.
    fireEvent.click(screen.getByText("Use your signature", { selector: "button" }));
    await screen.findByAltText("Signature preview");
  });

  it("the continue button stays greyed out until every field, optional included, is complete (#118)", async () => {
    await renderSigning();
    const continueBtn = screen.getByText(
      "Looks good — continue"
    ) as HTMLButtonElement;
    expect(continueBtn.disabled).toBe(true);

    // Required: signature + text. Completing only those must NOT
    // unlock the button while optional fields are still undone.
    fireEvent.click(screen.getByLabelText(/signature field on page 1/));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByText("Use this signature"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull()
    );

    fireEvent.click(screen.getByLabelText(/text field on page 1/));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByPlaceholderText("Type here"), {
      target: { value: "Agreed" },
    });
    fireEvent.click(screen.getByText("Done"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull()
    );
    expect(continueBtn.disabled).toBe(true);

    // Optional: checkbox.
    fireEvent.click(screen.getByLabelText(/checkbox field on page 1/));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByLabelText("Check the box"));
    fireEvent.click(screen.getByText("Done"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull()
    );
    expect(continueBtn.disabled).toBe(true);

    // Optional: date (defaults to today; Done completes it).
    fireEvent.click(screen.getByLabelText(/date field on page 2/));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByText("Done"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull()
    );
    expect(continueBtn.disabled).toBe(true);

    // Optional: initials.
    fireEvent.click(screen.getByLabelText(/initials field on page 2/));
    const initialsDialog = await screen.findByRole("dialog");
    fireEvent.click(within(initialsDialog).getByText("Use this initials"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull()
    );
    expect(continueBtn.disabled).toBe(true);

    // Optional: second signature (reuses the drawn signature).
    const sig2Boxes = screen.getAllByLabelText(/signature field on page 2/);
    fireEvent.click(sig2Boxes[0]);
    const sigDialog = await screen.findByRole("dialog");
    fireEvent.click(within(sigDialog).getByText("Use your signature"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull()
    );
    await waitFor(() => expect(continueBtn.disabled).toBe(false));
  });

  it("a date field is not complete from its today default until the signer saves it", async () => {
    await renderSigning();
    // The today default is pre-filled but unconfirmed: the box stays
    // dark and the label says not completed yet.
    const dateBox = screen.getByLabelText(
      "date field on page 2, not completed yet"
    );
    expect(getComputedStyle(dateBox).borderColor).toBe("rgb(17, 24, 39)");

    // Saving the modal — even accepting the today default — completes it.
    fireEvent.click(dateBox);
    await screen.findByRole("dialog");
    expect(
      screen.getByDisplayValue(new Date().toISOString().slice(0, 10))
    ).toBeTruthy();
    fireEvent.click(screen.getByText("Done"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull()
    );
    expect(
      getComputedStyle(
        screen.getByLabelText("date field on page 2, completed")
      ).borderColor
    ).toBe("rgb(21, 128, 61)");
  });

  it("a required date field blocks the continue button until the signer confirms it", async () => {
    const sessionWithRequiredDate = {
      ...SESSION,
      fields: SESSION.fields.map((f) =>
        f.id === "f-date" ? { ...f, required: true } : f
      ),
    };
    vi.mocked(getSession).mockResolvedValue(sessionWithRequiredDate as never);
    render(<SignPage />);
    await screen.findByText("Contract");
    fireEvent.click(screen.getByText("Start signing"));
    await screen.findByText("1. Your fields on this document");

    const continueBtn = screen.getByText(
      "Looks good — continue"
    ) as HTMLButtonElement;
    expect(continueBtn.disabled).toBe(true);

    // Complete the other required fields; the untouched date default
    // must not unlock the button.
    fireEvent.click(screen.getByLabelText(/signature field on page 1/));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByText("Use this signature"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull()
    );

    fireEvent.click(screen.getByLabelText(/text field on page 1/));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByPlaceholderText("Type here"), {
      target: { value: "Agreed" },
    });
    fireEvent.click(screen.getByText("Done"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull()
    );
    expect(continueBtn.disabled).toBe(true);

    // Complete the optional fields too; the unconfirmed date must
    // still hold the button back under the all-fields gate (#118).
    fireEvent.click(screen.getByLabelText(/checkbox field on page 1/));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByLabelText("Check the box"));
    fireEvent.click(screen.getByText("Done"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull()
    );

    fireEvent.click(screen.getByLabelText(/initials field on page 2/));
    const initialsDialog = await screen.findByRole("dialog");
    fireEvent.click(within(initialsDialog).getByText("Use this initials"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull()
    );

    const sig2Boxes = screen.getAllByLabelText(/signature field on page 2/);
    fireEvent.click(sig2Boxes[0]);
    const sigDialog = await screen.findByRole("dialog");
    fireEvent.click(within(sigDialog).getByText("Use your signature"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull()
    );
    expect(continueBtn.disabled).toBe(true);

    // Confirm the date from its modal; the button unlocks.
    fireEvent.click(screen.getByLabelText(/date field on page 2/));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByText("Done"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull()
    );
    await waitFor(() => expect(continueBtn.disabled).toBe(false));
  });

  it("submit sends the confirmed date value once the signer saves it", async () => {
    vi.mocked(submitSignature).mockResolvedValue({
      status: "signed",
      document_final: false,
      document: {},
      audit_seal: "abc123",
      chain_valid: true,
    } as never);
    await renderSigning();

    // Complete every field; the date is confirmed from its modal
    // (accepting the today default) rather than left untouched —
    // under the all-fields gate (#118) submit is unreachable until
    // the date is confirmed, so the untouched default can never
    // reach the server at all.
    fireEvent.click(screen.getByLabelText(/signature field on page 1/));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByText("Use this signature"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull()
    );

    fireEvent.click(screen.getByLabelText(/text field on page 1/));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByPlaceholderText("Type here"), {
      target: { value: "Agreed" },
    });
    fireEvent.click(screen.getByText("Done"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull()
    );

    fireEvent.click(screen.getByLabelText(/checkbox field on page 1/));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByLabelText("Check the box"));
    fireEvent.click(screen.getByText("Done"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull()
    );

    fireEvent.click(screen.getByLabelText(/date field on page 2/));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByText("Done"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull()
    );

    fireEvent.click(screen.getByLabelText(/initials field on page 2/));
    const initialsDialog = await screen.findByRole("dialog");
    fireEvent.click(within(initialsDialog).getByText("Use this initials"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull()
    );

    const sig2Boxes = screen.getAllByLabelText(/signature field on page 2/);
    fireEvent.click(sig2Boxes[0]);
    const sigDialog = await screen.findByRole("dialog");
    fireEvent.click(within(sigDialog).getByText("Use your signature"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull()
    );

    // Continue to the photo step (the stub pad reports ink) and
    // submit without a photo.
    fireEvent.click(screen.getByText("Looks good — continue"));
    await screen.findByText("2. Seen — snap a witness photo");
    fireEvent.click(screen.getByText("Skip photo & submit"));
    await screen.findByText("Signature recorded");

    const payload = vi.mocked(submitSignature).mock.calls[0][1] as {
      fieldValues: { field_id: string; value: string | boolean }[];
    };
    const sentIds = payload.fieldValues.map((f) => f.field_id);
    expect(sentIds).toContain("f-sig");
    expect(sentIds).toContain("f-text");
    expect(sentIds).toContain("f-date");
    const sentDate = payload.fieldValues.find((f) => f.field_id === "f-date");
    expect(sentDate?.value).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe("SignPage cross-device completion (#109)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const DOC = {
    id: "doc-1",
    title: "Contract",
    status: "signed",
    sender_email: "owner@example.com",
    signed_file: "signed/doc-1.pdf",
    signing_mode: "sequential",
    photo_required: false,
    created_at: "2026-11-11T00:00:00Z",
    updated_at: "2026-11-21T00:00:00Z",
  };

  const auditEvent = (event_type: string, hash: string) => ({
    id: `ev-${event_type}`,
    event_type,
    payload: {},
    prev_hash: "0",
    hash,
    created_at: "2026-11-21T00:00:00Z",
  });

  const signedSession = (document_status: string) => ({
    ...SESSION,
    status: "signed",
    document_status,
  });

  // Fake timers + React: advancing time alone does not flush the
  // re-render a poll's state update schedules, so each advance runs
  // inside act().
  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  async function renderAndWaitForIntro() {
    render(<SignPage />);
    await advance(100);
    expect(screen.getByText("Contract")).toBeTruthy();
  }

  it("moves to the done view when the session is signed from another device", async () => {
    vi.mocked(getSession)
      .mockResolvedValueOnce(SESSION as never)
      .mockResolvedValue(signedSession("signed") as never);
    vi.mocked(getDocument).mockResolvedValue(DOC as never);
    vi.mocked(getSessionEvents).mockResolvedValue({
      chain_valid: true,
      events: [
        auditEvent("signature.submitted", "submitted-hash"),
        auditEvent("document.sealed", "sealed-hash"),
      ],
    } as never);

    await renderAndWaitForIntro();
    await advance(5000);

    expect(screen.getByText("Signed. Seen. Sealed.")).toBeTruthy();
    // The seal comes from the sealed event, mirroring the submit response.
    // The seal shares its line with the label, so match by substring.
    expect(screen.getByText(/sealed-hash/)).toBeTruthy();
    expect(screen.getByText("Download signed PDF")).toBeTruthy();

    // Polling stops once done: no further session checks.
    const calls = vi.mocked(getSession).mock.calls.length;
    await advance(15000);
    expect(vi.mocked(getSession).mock.calls.length).toBe(calls);
  });

  it("stays on the signing form while the session is still pending", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as never);
    await renderAndWaitForIntro();
    await advance(15000);
    expect(screen.getByText("Contract")).toBeTruthy();
    expect(screen.queryByText("Signed. Seen. Sealed.")).toBeNull();
    // Initial load plus one poll per interval.
    expect(vi.mocked(getSession).mock.calls.length).toBe(4);
  });

  it("shows the recorded (not sealed) view when the document still awaits other signers", async () => {
    vi.mocked(getSession)
      .mockResolvedValueOnce(SESSION as never)
      .mockResolvedValue(signedSession("pending") as never);
    vi.mocked(getDocument).mockResolvedValue({
      ...DOC,
      status: "pending",
      signed_file: null,
    } as never);
    vi.mocked(getSessionEvents).mockResolvedValue({
      chain_valid: true,
      events: [auditEvent("signature.submitted", "submitted-hash")],
    } as never);

    await renderAndWaitForIntro();
    await advance(5000);

    expect(screen.getByText("Signature recorded")).toBeTruthy();
    // No sealed event, so the seal falls back to the submitted event.
    expect(screen.getByText(/submitted-hash/)).toBeTruthy();
    expect(screen.queryByText("Download signed PDF")).toBeNull();
  });
});

describe("SignPage earlier signers' completed fields (#105)", () => {
  let scrollIntoViewMock: ReturnType<typeof vi.fn>;
  let origScrollIntoView: typeof Element.prototype.scrollIntoView;

  beforeEach(() => {
    scrollIntoViewMock = vi.fn();
    origScrollIntoView = Element.prototype.scrollIntoView;
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: scrollIntoViewMock,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: origScrollIntoView,
      configurable: true,
      writable: true,
    });
    vi.clearAllMocks();
  });

  // A field completed by the earlier signer: stored value, completed
  // flag, and another session id. Size null renders the marker pill.
  const completed = (
    id: string,
    type: "signature" | "initials" | "checkbox" | "text" | "date",
    page: number,
    value: string,
    size: { width: number | null; height: number | null } = { width: 0.3, height: 0.15 }
  ) => ({
    id,
    document: "doc-1",
    session: "sess-0",
    signer_index: 0,
    type,
    page,
    x: 0.1,
    y: 0.2,
    ...size,
    required: true,
    value,
    completed: true,
    completed_at: "2026-11-11T01:00:00Z",
    created_at: "2026-11-11T00:00:00Z",
  });

  const BOB_SESSION = {
    ...SESSION,
    id: "sess-2",
    signer_name: "Bob",
    signer_email: "bob@example.com",
    order: 1,
    fields: [field("f-bob-text", "text", 1, 0.1, 0.45)],
    completed_fields: [
      completed("f-done-text", "text", 1, "Alice agreed"),
      completed("f-done-sig", "signature", 1, ""),
      completed("f-done-date", "date", 2, "2026-10-20"),
      completed("f-done-pill", "text", 2, "Pill note", { width: null, height: null }),
    ],
  };

  async function renderSigningAsBob() {
    vi.mocked(getSession).mockResolvedValue(BOB_SESSION as never);
    render(<SignPage />);
    await screen.findByText("Contract");
    fireEvent.click(screen.getByText("Start signing"));
    await screen.findByText("1. Your fields on this document");
  }

  it("completed text field renders its value read-only and never opens a modal", async () => {
    await renderSigningAsBob();
    expect(
      screen.getByText(/dashed border and cannot be changed/)
    ).toBeTruthy();
    const done = screen.getByLabelText(
      /text field on page 1, completed by an earlier signer/
    );
    expect(done.textContent).toContain("Alice agreed");
    // Dashed border, not the solid dark box of the signer's own fields.
    expect(getComputedStyle(done).borderStyle).toBe("dashed");
    // Not a button: no role, no click behavior.
    expect(done.getAttribute("role")).toBeNull();
    fireEvent.click(done);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("completed signature field renders the stored image", async () => {
    await renderSigningAsBob();
    const done = screen.getByLabelText(
      /signature field on page 1, completed by an earlier signer/
    );
    const img = done.querySelector("img");
    expect(img).toBeTruthy();
    expect(img!.getAttribute("src")).toContain(
      "/api/sessions/tok-1/fields/f-done-sig/image/"
    );
    fireEvent.click(done);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a page with only completed fields still renders, including the marker pill", async () => {
    await renderSigningAsBob();
    expect(screen.getByAltText("Document page 2")).toBeTruthy();
    const date = screen.getByLabelText(
      /date field on page 2, completed by an earlier signer/
    );
    expect(date.textContent).toContain("2026-10-20");
    const pill = screen.getByTestId("completed-field-pill");
    expect(pill.textContent).toContain("text: Pill note");
    expect(pill.getAttribute("role")).toBeNull();
  });

  it("completed fields do not unlock the continue button", async () => {
    await renderSigningAsBob();
    const continueBtn = screen.getByText(
      "Looks good — continue"
    ) as HTMLButtonElement;
    // The signer's own required text field is still incomplete.
    expect(continueBtn.disabled).toBe(true);
  });
});

describe("SignPage signed-date fields (#106)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const today = new Date().toISOString().slice(0, 10);

  async function renderSigningWithFields(
    fields: object[]
  ) {
    vi.mocked(getSession).mockResolvedValue({
      ...SESSION,
      fields,
    } as never);
    render(<SignPage />);
    await screen.findByText("Contract");
    fireEvent.click(screen.getByText("Start signing"));
  }

  it("a signed-date box is read-only, shows today's date, and opens no modal", async () => {
    await renderSigningWithFields([
      field("f-sd", "signed_date", 1, 0.1, 0.2),
      field("f-sig", "signature", 1, 0.1, 0.45),
    ]);
    const box = screen.getByTestId("signed-date-box");
    expect(box.textContent).toContain("signed date");
    expect(box.textContent).toContain(today);
    expect(box.getAttribute("role")).toBeNull();
    fireEvent.click(box);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a click-placed signed-date field renders as a read-only pill", async () => {
    await renderSigningWithFields([
      { ...field("f-sd", "signed_date", 1, 0.5, 0.5), width: null, height: null },
    ]);
    const pill = screen.getByTestId("signed-date-pill");
    expect(pill.textContent).toContain(today);
    expect(pill.getAttribute("role")).toBeNull();
    fireEvent.click(pill);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a required signed-date field never blocks the continue button", async () => {
    await renderSigningWithFields([field("f-sd", "signed_date", 1, 0.1, 0.2)]);
    const continueBtn = screen.getByText(
      "Looks good — continue"
    ) as HTMLButtonElement;
    expect(continueBtn.disabled).toBe(false);
  });
});
