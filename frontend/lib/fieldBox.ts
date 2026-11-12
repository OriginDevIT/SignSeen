// Drawn-box helpers for field placement (#78). Pure functions over
// normalized (0-1) page coordinates, so they are unit-testable without
// a DOM.

/** Smallest box the server accepts (normalized fractions of the page
 * size). Mirrors MIN_FIELD_WIDTH / MIN_FIELD_HEIGHT in
 * backend/apps/signing/views.py, which is authoritative. */
export const MIN_BOX_WIDTH = 0.02;
export const MIN_BOX_HEIGHT = 0.01;

/** Pointer movement below this is a click, not a drag. */
export const CLICK_SLOP_PX = 4;

export interface DrawnBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Normalize two corner points into a box, clamped inside the page.
 * Clamping trims the box at the page edge rather than shifting it, so
 * the rendered box never extends past where the drag ended. */
export function normalizeBox(
  x0: number,
  y0: number,
  x1: number,
  y1: number
): DrawnBox {
  const x = Math.max(0, Math.min(x0, x1));
  const y = Math.max(0, Math.min(y0, y1));
  const right = Math.min(1, Math.max(x0, x1));
  const bottom = Math.min(1, Math.max(y0, y1));
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
}

/** True when the pointer barely moved — a click, not a drag. */
export function isClick(
  startX: number,
  startY: number,
  endX: number,
  endY: number
): boolean {
  return Math.hypot(endX - startX, endY - startY) < CLICK_SLOP_PX;
}

export function boxTooSmall(box: DrawnBox): boolean {
  return box.width < MIN_BOX_WIDTH || box.height < MIN_BOX_HEIGHT;
}

/** The box to render for a field: its drawn size when stored, else null
 * (the caller renders a click-placed field as a marker pill). */
export function fieldBox(f: {
  x: number;
  y: number;
  width: number | null | undefined;
  height: number | null | undefined;
}): DrawnBox | null {
  if (f.width == null || f.height == null) return null;
  return { x: f.x, y: f.y, width: f.width, height: f.height };
}

/** Height for a signature/initials pad sized to a drawn box. The pad is
 * full-width, so its height follows the box's aspect: a wide box gets a
 * short pad, a tall box a tall one. pageAspect is the page's
 * width/height (e.g. 612/792 for letter). No stored size → the
 * long-standing 200px pad. */
export function signaturePadHeight(
  width: number | null | undefined,
  height: number | null | undefined,
  pageAspect: number
): number {
  if (
    width == null ||
    height == null ||
    width <= 0 ||
    height <= 0 ||
    pageAspect <= 0
  ) {
    return 200;
  }
  const boxAspect = (width * pageAspect) / height;
  return Math.max(80, Math.min(260, Math.round(600 / boxAspect)));
}
