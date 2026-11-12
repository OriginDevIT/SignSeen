import { describe, expect, it } from "vitest";
import {
  boxTooSmall,
  fieldBox,
  isClick,
  normalizeBox,
  signaturePadHeight,
} from "./fieldBox";

describe("normalizeBox", () => {
  // toBeCloseTo: normalized coordinates are floats, so exact equality
  // trips on representation dust (e.g. 0.1 - 0.4 is 0.30000000000000004).
  const expectBox = (
    actual: ReturnType<typeof normalizeBox>,
    expected: ReturnType<typeof normalizeBox>
  ) => {
    expect(actual.x).toBeCloseTo(expected.x, 10);
    expect(actual.y).toBeCloseTo(expected.y, 10);
    expect(actual.width).toBeCloseTo(expected.width, 10);
    expect(actual.height).toBeCloseTo(expected.height, 10);
  };

  it("orders corners regardless of drag direction", () => {
    expectBox(normalizeBox(0.5, 0.4, 0.2, 0.1), {
      x: 0.2,
      y: 0.1,
      width: 0.3,
      height: 0.3,
    });
  });

  it("clamps a drag that leaves the page", () => {
    expectBox(normalizeBox(0.9, 0.9, 1.4, 1.2), {
      x: 0.9,
      y: 0.9,
      width: 0.1,
      height: 0.1,
    });
  });

  it("clamps a drag that starts outside the page", () => {
    expectBox(normalizeBox(-0.2, -0.1, 0.3, 0.2), {
      x: 0,
      y: 0,
      width: 0.3,
      height: 0.2,
    });
  });
});

describe("isClick", () => {
  it("treats tiny movement as a click", () => {
    expect(isClick(100, 100, 102, 101)).toBe(true);
  });

  it("treats a real drag as a drag", () => {
    expect(isClick(100, 100, 200, 150)).toBe(false);
  });
});

describe("boxTooSmall", () => {
  it("rejects a box below the server floor", () => {
    expect(boxTooSmall({ x: 0.1, y: 0.1, width: 0.01, height: 0.15 })).toBe(true);
    expect(boxTooSmall({ x: 0.1, y: 0.1, width: 0.3, height: 0.005 })).toBe(true);
  });

  it("accepts a box at the floor", () => {
    expect(boxTooSmall({ x: 0.1, y: 0.1, width: 0.02, height: 0.01 })).toBe(false);
  });
});

describe("fieldBox", () => {
  it("returns the stored size", () => {
    expect(fieldBox({ x: 0.1, y: 0.2, width: 0.3, height: 0.15 })).toEqual({
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.15,
    });
  });

  it("returns null without a stored size", () => {
    expect(fieldBox({ x: 0.1, y: 0.2, width: null, height: null })).toBeNull();
    expect(fieldBox({ x: 0.1, y: 0.2, width: 0.3, height: null })).toBeNull();
  });
});

describe("signaturePadHeight", () => {
  it("returns 200 without a stored size", () => {
    expect(signaturePadHeight(null, null, 612 / 792)).toBe(200);
    expect(signaturePadHeight(0.3, null, 612 / 792)).toBe(200);
  });

  it("matches the long-standing height for a default-size signature box", () => {
    // 180x60pt on a letter page: normalized 0.294 x 0.076.
    const h = signaturePadHeight(180 / 612, 60 / 792, 612 / 792);
    expect(h).toBeGreaterThanOrEqual(190);
    expect(h).toBeLessThanOrEqual(210);
  });

  it("clamps tall boxes and wide boxes", () => {
    expect(signaturePadHeight(0.1, 0.4, 612 / 792)).toBe(260);
    expect(signaturePadHeight(0.6, 0.05, 612 / 792)).toBe(80);
  });
});
