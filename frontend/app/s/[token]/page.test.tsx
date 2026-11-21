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
    sessionPageUrl: vi.fn((_token: string, page: number) => `/page-${page}.png`),
    sessionDocumentUrl: vi.fn(() => "/document.pdf"),
    mediaUrl: vi.fn((u: string | null) => u),
  };
});

import { getDocument, getSession, getSessionEvents } from "../../../lib/api";

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
  type: "signature" | "initials" | "checkbox" | "text" | "date",
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

  it("the continue button unlocks once every required field is complete", async () => {
    await renderSigning();
    const continueBtn = screen.getByText(
      "Looks good — continue"
    ) as HTMLButtonElement;
    expect(continueBtn.disabled).toBe(true);

    // Required: signature + text. Optional fields stay undone.
    fireEvent.click(screen.getByLabelText(/signature field on page 1/));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByText("Use this signature"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull()
    );
    expect(continueBtn.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText(/text field on page 1/));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByPlaceholderText("Type here"), {
      target: { value: "Agreed" },
    });
    fireEvent.click(screen.getByText("Done"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull()
    );
    await waitFor(() => expect(continueBtn.disabled).toBe(false));
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
