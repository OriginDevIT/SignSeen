// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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

import PlaceFieldsPage from "./page";
import {
  createDocumentField,
  fetchDocumentPageImageUrl,
  getDocument,
  getDocumentFields,
} from "../../../lib/api";

vi.mock("next/navigation", () => ({
  useParams: () => ({ docId: "doc-1" }),
}));

vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    getDocument: vi.fn(),
    getDocumentFields: vi.fn(),
    fetchDocumentPageImageUrl: vi.fn(),
    createDocumentField: vi.fn(),
    deleteDocumentField: vi.fn(),
  };
});

const DOC = {
  id: "doc-1",
  title: "Contract",
  status: "draft",
  sender_email: "owner@example.com",
  signed_file: null,
  signing_mode: "sequential" as const,
  sessions: [
    {
      id: "sess-1",
      signer_name: "Alice",
      signer_email: "alice@example.com",
      status: "pending",
      order: 0,
    },
  ],
  created_at: "2026-11-11T00:00:00Z",
  updated_at: "2026-11-11T00:00:00Z",
};

const DRAWN_FIELD = {
  id: "f1",
  session: "sess-1",
  type: "signature" as const,
  page: 1,
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.15,
  required: true,
  value: "",
  completed: false,
  completed_at: null,
  created_at: "2026-11-11T00:00:00Z",
};

const CLICK_FIELD = {
  ...DRAWN_FIELD,
  id: "f2",
  width: null,
  height: null,
};

/** The rendered page image is 700x900 in the test, so normalized
 * coordinates are client pixels / 700 (x) and / 900 (y). */
async function renderLoaded(fields: typeof DRAWN_FIELD[] = []) {
  vi.mocked(getDocument).mockResolvedValue(DOC);
  vi.mocked(getDocumentFields).mockResolvedValue({
    page_count: 2,
    fields: fields as never,
  });
  vi.mocked(fetchDocumentPageImageUrl).mockResolvedValue("blob:page-1.png");
  render(<PlaceFieldsPage />);
  const img = (await screen.findByAltText(
    "Document page 1"
  )) as HTMLImageElement;
  vi.spyOn(img, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 700,
    bottom: 900,
    width: 700,
    height: 900,
    toJSON: () => ({}),
  } as DOMRect);
  return img;
}

describe("PlaceFieldsPage drag-to-draw (#78)", () => {
  beforeEach(() => {
    // jsdom has no URL.revokeObjectURL; the page calls it on unmount.
    vi.stubGlobal("URL", { ...URL, revokeObjectURL: vi.fn() });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("drag creates a field with the drawn box size", async () => {
    // Echo the placed field back, so the rendered box is the drawn one.
    vi.mocked(createDocumentField).mockImplementation(
      async (_docId: string, body) =>
        ({
          ...DRAWN_FIELD,
          x: body.x,
          y: body.y,
          width: body.width ?? null,
          height: body.height ?? null,
        }) as never
    );
    const img = await renderLoaded();

    fireEvent.pointerDown(img, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(img, { clientX: 310, clientY: 280, pointerId: 1 });
    expect(screen.getByTestId("field-draft")).toBeTruthy();
    fireEvent.pointerUp(img, { clientX: 310, clientY: 280, pointerId: 1 });

    await waitFor(() =>
      expect(vi.mocked(createDocumentField)).toHaveBeenCalled()
    );
    expect(vi.mocked(createDocumentField).mock.calls[0][1]).toEqual({
      session_id: "sess-1",
      type: "signature",
      page: 1,
      x: 0.1429,
      y: 0.1111,
      width: 0.3,
      height: 0.2,
    });

    const box = await screen.findByTestId("field-box");
    expect(box.style.left).toContain("14.29");
    expect(box.style.top).toContain("11.11");
    expect(box.style.width).toContain("30");
    expect(box.style.height).toContain("20");
    expect(box.textContent).toContain("signature");
    expect(box.textContent).toContain("S1");
  });

  it("click places a default-size field (no size sent)", async () => {
    vi.mocked(createDocumentField).mockResolvedValue(CLICK_FIELD as never);
    const img = await renderLoaded();

    fireEvent.pointerDown(img, { clientX: 200, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(img, { clientX: 200, clientY: 200, pointerId: 1 });

    await waitFor(() =>
      expect(vi.mocked(createDocumentField)).toHaveBeenCalled()
    );
    expect(vi.mocked(createDocumentField).mock.calls[0][1]).toEqual({
      session_id: "sess-1",
      type: "signature",
      page: 1,
      x: 0.2857,
      y: 0.2222,
    });

    await screen.findByText(/Placed fields \(1\)/);
    // A click-placed field renders as a marker pill, not a box.
    expect(screen.queryByTestId("field-box")).toBeNull();
  });

  it("clicking a drawn box selects it without creating a field", async () => {
    const img = await renderLoaded([DRAWN_FIELD]);
    await screen.findByTestId("field-box");

    // Inside the box: x 0.1–0.4 -> 70–280px, y 0.2–0.35 -> 180–315px.
    fireEvent.pointerDown(img, { clientX: 150, clientY: 250, pointerId: 1 });
    fireEvent.pointerUp(img, { clientX: 150, clientY: 250, pointerId: 1 });

    const box = screen.getByTestId("field-box");
    await waitFor(() =>
      expect(getComputedStyle(box).borderColor).toBe("rgb(37, 99, 235)")
    );
    expect(vi.mocked(createDocumentField)).not.toHaveBeenCalled();
  });

  it("a too-small drag shows an error and creates nothing", async () => {
    const img = await renderLoaded();

    fireEvent.pointerDown(img, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(img, { clientX: 105, clientY: 102, pointerId: 1 });
    fireEvent.pointerUp(img, { clientX: 105, clientY: 102, pointerId: 1 });

    await screen.findByText("That box is too small — drag a larger one.");
    expect(vi.mocked(createDocumentField)).not.toHaveBeenCalled();
  });
});
