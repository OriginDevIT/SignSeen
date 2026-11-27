// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import FieldModal from "./FieldModal";
import type { DocumentFieldInfo } from "../lib/api";

afterEach(() => {
  cleanup();
});

function makeField(required: boolean): DocumentFieldInfo {
  return {
    id: "field-1",
    document: "doc-1",
    session: null,
    signer_index: 0,
    type: "text",
    page: 1,
    x: 0.1,
    y: 0.2,
    width: null,
    height: null,
    required,
    value: "",
    completed: false,
    completed_at: null,
    created_at: "2026-11-25T00:00:00Z",
  };
}

describe("FieldModal", () => {
  it("renders the instruction without a required/optional marker (#211)", () => {
    render(
      <FieldModal
        field={makeField(true)}
        pageAspect={1.3}
        savedSignature={null}
        savedInitials={null}
        initialValue={undefined}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(
      screen.getByText(/Complete it here - it will be stamped/)
    ).toBeTruthy();
    expect(screen.queryByText(/Required field\./)).toBeNull();
    expect(screen.queryByText(/Optional field\./)).toBeNull();
  });

  it("renders the same instruction for an API-created optional field (#211)", () => {
    render(
      <FieldModal
        field={makeField(false)}
        pageAspect={1.3}
        savedSignature={null}
        savedInitials={null}
        initialValue={undefined}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(
      screen.getByText(/Complete it here - it will be stamped/)
    ).toBeTruthy();
    expect(screen.queryByText(/Required field\./)).toBeNull();
    expect(screen.queryByText(/Optional field\./)).toBeNull();
  });
});
