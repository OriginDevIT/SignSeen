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
  deleteDocumentField,
  fetchDocumentPageImageUrl,
  getDocument,
  getDocumentFields,
  updateDocumentField,
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
    updateDocumentField: vi.fn(),
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
async function renderLoaded(
  fields: typeof DRAWN_FIELD[] = [],
  doc: typeof DOC = DOC
) {
  vi.mocked(getDocument).mockResolvedValue(doc);
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

    await screen.findByText("That box is too small - drag a larger one.");
    expect(vi.mocked(createDocumentField)).not.toHaveBeenCalled();
  });
});

describe("PlaceFieldsPage toolbar, move and delete (#84)", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", { ...URL, revokeObjectURL: vi.fn() });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("the add-field toolbar is sticky and its selects truncate", async () => {
    await renderLoaded();

    const toolbar = screen.getByTestId("field-toolbar");
    expect(toolbar.style.position).toBe("sticky");
    expect(toolbar.style.top).toBe("0px");
    const signerSelect = screen.getByLabelText(
      "Assigned signer"
    ) as HTMLSelectElement;
    expect(signerSelect.style.width).toBe("100%");
    expect(signerSelect.style.textOverflow).toBe("ellipsis");
    // The full label stays available as a tooltip.
    expect(signerSelect.title).toContain("Alice");
    expect(signerSelect.title).toContain("alice@example.com");
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
  });

  it("dragging a drawn box moves it and persists the new position", async () => {
    // Echo the moved field back, so the rendered box is the new one.
    vi.mocked(updateDocumentField).mockImplementation(
      async (_docId: string, _fieldId: string, pos) =>
        ({ ...DRAWN_FIELD, x: pos.x, y: pos.y }) as never
    );
    const img = await renderLoaded([DRAWN_FIELD]);
    await screen.findByTestId("field-box");

    // Grab inside the box (x 0.1–0.4 -> 70–280px, y 0.2–0.35 ->
    // 180–315px) and drag it 100px right and down.
    fireEvent.pointerDown(img, { clientX: 150, clientY: 250, pointerId: 1 });
    fireEvent.pointerMove(img, { clientX: 250, clientY: 350, pointerId: 1 });
    fireEvent.pointerUp(img, { clientX: 250, clientY: 350, pointerId: 1 });

    await waitFor(() =>
      expect(vi.mocked(updateDocumentField)).toHaveBeenCalled()
    );
    expect(vi.mocked(updateDocumentField).mock.calls[0]).toEqual([
      "doc-1",
      "f1",
      { x: 0.2429, y: 0.3111 },
      null,
    ]);
    expect(vi.mocked(createDocumentField)).not.toHaveBeenCalled();

    const box = screen.getByTestId("field-box");
    await waitFor(() => expect(box.style.left).toContain("24.29"));
    expect(box.style.top).toContain("31.11");
  });

  it("a move clamps the box inside the page", async () => {
    vi.mocked(updateDocumentField).mockImplementation(
      async (_docId: string, _fieldId: string, pos) =>
        ({ ...DRAWN_FIELD, x: pos.x, y: pos.y }) as never
    );
    const img = await renderLoaded([DRAWN_FIELD]);
    await screen.findByTestId("field-box");

    // Drag far past the bottom-right corner.
    fireEvent.pointerDown(img, { clientX: 150, clientY: 250, pointerId: 1 });
    fireEvent.pointerMove(img, { clientX: 700, clientY: 900, pointerId: 1 });
    fireEvent.pointerUp(img, { clientX: 700, clientY: 900, pointerId: 1 });

    await waitFor(() =>
      expect(vi.mocked(updateDocumentField)).toHaveBeenCalled()
    );
    // Box is 0.3 wide, 0.15 tall: x stops at 0.7, y at 0.85.
    expect(vi.mocked(updateDocumentField).mock.calls[0][2]).toEqual({
      x: 0.7,
      y: 0.85,
    });
  });

  it("dragging a click-placed marker moves it by its anchor", async () => {
    vi.mocked(updateDocumentField).mockImplementation(
      async (_docId: string, _fieldId: string, pos) =>
        ({ ...CLICK_FIELD, x: pos.x, y: pos.y }) as never
    );
    const img = await renderLoaded([CLICK_FIELD]);

    // Marker anchor at (0.1, 0.2) -> (70px, 180px).
    fireEvent.pointerDown(img, { clientX: 70, clientY: 180, pointerId: 1 });
    fireEvent.pointerMove(img, { clientX: 170, clientY: 280, pointerId: 1 });
    fireEvent.pointerUp(img, { clientX: 170, clientY: 280, pointerId: 1 });

    await waitFor(() =>
      expect(vi.mocked(updateDocumentField)).toHaveBeenCalled()
    );
    expect(vi.mocked(updateDocumentField).mock.calls[0][2]).toEqual({
      x: 0.2429,
      y: 0.3111,
    });
    expect(vi.mocked(createDocumentField)).not.toHaveBeenCalled();
  });

  it("dragging a completed field moves nothing and draws nothing", async () => {
    const completed = {
      ...DRAWN_FIELD,
      completed: true,
      completed_at: "2026-11-11T01:00:00Z",
    };
    const img = await renderLoaded([completed]);
    await screen.findByTestId("field-box");

    fireEvent.pointerDown(img, { clientX: 150, clientY: 250, pointerId: 1 });
    fireEvent.pointerMove(img, { clientX: 250, clientY: 350, pointerId: 1 });
    fireEvent.pointerUp(img, { clientX: 250, clientY: 350, pointerId: 1 });

    expect(vi.mocked(updateDocumentField)).not.toHaveBeenCalled();
    expect(vi.mocked(createDocumentField)).not.toHaveBeenCalled();
    // No delete control on a completed field either.
    expect(screen.queryByTestId("delete-field-button")).toBeNull();
  });

  it("the × on a selected box deletes the field", async () => {
    vi.mocked(deleteDocumentField).mockResolvedValue(undefined as never);
    const img = await renderLoaded([DRAWN_FIELD]);
    await screen.findByTestId("field-box");

    // No × until a box is selected.
    expect(screen.queryByTestId("delete-field-button")).toBeNull();
    fireEvent.pointerDown(img, { clientX: 150, clientY: 250, pointerId: 1 });
    fireEvent.pointerUp(img, { clientX: 150, clientY: 250, pointerId: 1 });

    const del = await screen.findByTestId("delete-field-button");
    fireEvent.click(del);
    await waitFor(() =>
      expect(vi.mocked(deleteDocumentField)).toHaveBeenCalledWith(
        "doc-1",
        "f1",
        null
      )
    );
  });
});

describe("PlaceFieldsPage draft mode (#89)", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", { ...URL, revokeObjectURL: vi.fn() });
    window.sessionStorage.setItem("signseen_draft_token:doc-1", "tok-1");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  const DRAFT_DOC = {
    id: "doc-1",
    title: "Contract",
    status: "draft",
    sender_email: "owner@example.com",
    signed_file: null,
    signing_mode: "parallel" as const,
    photo_required: false,
    signer_list: [
      { name: "Alice", email: "alice@example.com" },
      { name: "Bob", email: "bob@example.com" },
    ],
    sessions: [],
    created_at: "2026-11-11T00:00:00Z",
    updated_at: "2026-11-11T00:00:00Z",
  };

  async function renderDraft(
    fields: typeof DRAWN_FIELD[] = [],
    doc: typeof DRAFT_DOC = DRAFT_DOC
  ) {
    vi.mocked(getDocument).mockResolvedValue(doc as never);
    vi.mocked(getDocumentFields).mockResolvedValue({
      page_count: 1,
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

  it("offers the draft signer slots and places by signer_index", async () => {
    vi.mocked(createDocumentField).mockImplementation(
      async (_docId: string, body) =>
        ({
          ...DRAWN_FIELD,
          id: "f9",
          session: null,
          signer_index: (body as { signer_index: number }).signer_index,
          x: body.x,
          y: body.y,
          width: body.width ?? null,
          height: body.height ?? null,
        }) as never
    );
    const img = await renderDraft();

    const select = screen.getByLabelText("Assigned signer") as HTMLSelectElement;
    expect(select.options).toHaveLength(2);
    expect(select.options[0].textContent).toContain("Alice");
    expect(select.options[0].textContent).toContain("alice@example.com");
    expect(select.options[1].textContent).toContain("Bob");

    fireEvent.pointerDown(img, { clientX: 200, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(img, { clientX: 200, clientY: 200, pointerId: 1 });

    await waitFor(() =>
      expect(vi.mocked(createDocumentField)).toHaveBeenCalled()
    );
    const [, body, token] = vi.mocked(createDocumentField).mock.calls[0];
    expect(body).toMatchObject({ signer_index: 0, type: "signature" });
    expect(body).not.toHaveProperty("session_id");
    expect(token).toBe("tok-1");

    await screen.findByText(/Placed fields \(1\)/);
  });

  it("a field assigned to the second slot renders as S2 for Bob", async () => {
    const bobField = {
      ...DRAWN_FIELD,
      id: "f2",
      session: null,
      signer_index: 1,
    };
    await renderDraft([bobField as never]);
    const box = await screen.findByTestId("field-box");
    expect(box.textContent).toContain("S2");
    expect(box.title).toContain("Bob");
    // The placed-fields list names the same signer (expand it first:
    // it is collapsed by default, #97).
    fireEvent.click(screen.getByRole("button", { name: /Placed fields/ }));
    expect(screen.getAllByText(/Signer 2 - Bob/).length).toBeGreaterThan(0);
  });

  it("a field assigned to a nameless slot shows the slot email in the list (#114)", async () => {
    const namelessDoc = {
      ...DRAFT_DOC,
      signer_list: [
        { name: "Alice", email: "alice@example.com" },
        { name: "", email: "bob@example.com" },
      ],
    };
    const bobField = {
      ...DRAWN_FIELD,
      id: "f2",
      session: null,
      signer_index: 1,
    };
    await renderDraft([bobField as never], namelessDoc as never);
    await screen.findByTestId("field-box");
    // Expand the placed-fields list: it is collapsed by default (#97).
    fireEvent.click(screen.getByRole("button", { name: /Placed fields/ }));
    expect(
      screen.getAllByText(/Signer 2 - bob@example\.com/).length
    ).toBeGreaterThan(0);
  });

  it("exits lead back to the wizard, never to a blank form", async () => {
    await renderDraft();
    const back = screen.getByRole("link", { name: "← Back to details" });
    expect(back.getAttribute("href")).toBe("/send?draft=doc-1&step=1");
    const next = screen.getByRole("link", { name: "Continue to review →" });
    expect(next.getAttribute("href")).toBe("/send?draft=doc-1&step=3");
    expect(screen.queryByText("← Back to send")).toBeNull();
  });
});

describe("PlaceFieldsPage placed-fields list (#97)", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", { ...URL, revokeObjectURL: vi.fn() });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("is collapsed by default: the toggle shows the count and the rows are hidden", async () => {
    await renderLoaded([DRAWN_FIELD]);

    const toggle = screen.getByRole("button", {
      name: /Placed fields \(1\)/,
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Delete")).toBeNull();
    // The row is list-only text (the signer label also appears in the
    // toolbar select, so the "page N · " prefix disambiguates the row).
    expect(screen.queryByText(/page 1 · Signer 1 - Alice/)).toBeNull();
  });

  it("rows show the page reference without coordinates (#113)", async () => {
    await renderLoaded([DRAWN_FIELD]);

    const toggle = screen.getByRole("button", {
      name: /Placed fields \(1\)/,
    });
    fireEvent.click(toggle);

    expect(screen.getByText(/page 1 · Signer 1 - Alice/)).toBeTruthy();
    // No required/optional marker is rendered on the row (#211).
    expect(screen.queryByText(/· required/)).toBeNull();
    expect(screen.queryByText(/· optional/)).toBeNull();
    expect(screen.queryByText(/\(0\.10, 0\.20\)/)).toBeNull();
    expect(screen.queryByText(/0\.30 × 0\.15/)).toBeNull();
  });

  it("expanding reveals the rows with working per-row Delete buttons", async () => {
    await renderLoaded([DRAWN_FIELD]);

    const toggle = screen.getByRole("button", {
      name: /Placed fields \(1\)/,
    });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    const del = await screen.findByText("Delete");
    fireEvent.click(del);
    await waitFor(() =>
      expect(vi.mocked(deleteDocumentField)).toHaveBeenCalledWith(
        "doc-1",
        "f1",
        null
      )
    );
  });

  it("collapsing again hides the rows", async () => {
    await renderLoaded([DRAWN_FIELD]);

    const toggle = screen.getByRole("button", {
      name: /Placed fields \(1\)/,
    });
    fireEvent.click(toggle);
    await screen.findByText("Delete");
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.queryByText("Delete")).toBeNull());
  });

  it("an empty list still shows the count and expands to the hint", async () => {
    await renderLoaded();

    const toggle = screen.getByRole("button", {
      name: /Placed fields \(0\)/,
    });
    expect(screen.queryByText(/No fields yet/)).toBeNull();
    fireEvent.click(toggle);
    await screen.findByText(/No fields yet/);
  });

  it("a field whose session has no name shows the session email in the list (#114)", async () => {
    const namelessDoc = {
      ...DOC,
      sessions: [
        {
          id: "sess-1",
          signer_name: "",
          signer_email: "carol@example.com",
          status: "pending",
          order: 0,
        },
      ],
    };
    await renderLoaded([DRAWN_FIELD], namelessDoc as never);

    const toggle = screen.getByRole("button", {
      name: /Placed fields \(1\)/,
    });
    fireEvent.click(toggle);
    expect(
      screen.getAllByText(/Signer 1 - carol@example\.com/).length
    ).toBeGreaterThan(0);
  });
});

describe("PlaceFieldsPage field types (#106)", () => {
  beforeEach(() => {
    // jsdom has no URL.revokeObjectURL; the page calls it on unmount.
    vi.stubGlobal("URL", { ...URL, revokeObjectURL: vi.fn() });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("the field-type select offers signed date", async () => {
    await renderLoaded();
    const select = screen.getByLabelText("Field type") as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toContain("signed date");
    expect(labels).toHaveLength(6);
  });
});

describe("PlaceFieldsPage navigation (#152)", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", { ...URL, revokeObjectURL: vi.fn() });
    window.sessionStorage.setItem("signseen_draft_token:doc-1", "tok-1");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("shows Back and Continue as buttons below the preview and above Placed fields, with the wizard destinations", async () => {
    const draftDoc = {
      ...DOC,
      status: "draft",
      signer_list: [
        { name: "Alice", email: "alice@example.com" },
        { name: "Bob", email: "bob@example.com" },
      ],
      sessions: [],
    };
    vi.mocked(getDocument).mockResolvedValue(draftDoc as never);
    vi.mocked(getDocumentFields).mockResolvedValue({
      page_count: 1,
      fields: [],
    });
    vi.mocked(fetchDocumentPageImageUrl).mockResolvedValue("blob:page-1.png");
    render(<PlaceFieldsPage />);
    await screen.findByAltText("Document page 1");

    const back = screen.getByRole("link", { name: "← Back to details" });
    const next = screen.getByRole("link", { name: "Continue to review →" });
    expect(back.getAttribute("href")).toBe("/send?draft=doc-1&step=1");
    expect(next.getAttribute("href")).toBe("/send?draft=doc-1&step=3");
    // Styled as buttons, not plain text links: the primary action is
    // dark with white text, the back action is a bordered ghost.
    expect(window.getComputedStyle(next).backgroundColor).toBe(
      "rgb(17, 24, 39)"
    );
    expect(window.getComputedStyle(next).color).toBe("rgb(255, 255, 255)");
    expect(window.getComputedStyle(back).backgroundColor).toBe(
      "rgb(255, 255, 255)"
    );
    // Placement order in the document: preview image, then the
    // navigation, then the Placed fields section.
    const html = document.body.innerHTML;
    expect(html.indexOf("Document page 1")).toBeGreaterThan(-1);
    expect(html.indexOf("Document page 1")).toBeLessThan(
      html.indexOf("Continue to review")
    );
    expect(html.indexOf("Continue to review")).toBeLessThan(
      html.indexOf("Placed fields")
    );
    // The nav row pushes Continue to the right end.
    const row = next.parentElement as HTMLElement;
    expect(row.style.justifyContent).toBe("space-between");
  });
});
