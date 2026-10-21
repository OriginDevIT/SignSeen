import { type Page } from "@playwright/test";
import path from "node:path";

// Small deterministic fixtures shared by the specs. The PDF is a one-page
// agreement; the JPEG stands in for the signer's witness photo (the fake
// media device covers the live-camera path separately).
const SAMPLE_PDF_B64 =
  "JVBERi0xLjcKJcK1wrYKJSBXcml0dGVuIGJ5IE11UERGIDEuMjguNQoKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFIvSW5mbzw8L1Byb2R1Y2VyKE11UERGIDEuMjguNSk+Pj4+CmVuZG9iagoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0NvdW50IDEvS2lkc1s0IDAgUl0+PgplbmRvYmoKCjMgMCBvYmoKPDwvRm9udDw8L2hlbHYgNSAwIFI+Pj4+CmVuZG9iagoKNCAwIG9iago8PC9UeXBlL1BhZ2UvTWVkaWFCb3hbMCAwIDU5NSA4NDJdL1JvdGF0ZSAwL1Jlc291cmNlcyAzIDAgUi9QYXJlbnQgMiAwIFIvQ29udGVudHNbNiAwIFIgNyAwIFJdPj4KZW5kb2JqCgo1IDAgb2JqCjw8L1R5cGUvRm9udC9TdWJ0eXBlL1R5cGUxL0Jhc2VGb250L0hlbHZldGljYS9FbmNvZGluZy9XaW5BbnNpRW5jb2Rpbmc+PgplbmRvYmoKCjYgMCBvYmoKPDwvTGVuZ3RoIDg4Pj4Kc3RyZWFtCgpxCkJUCjEgMCAwIDEgNzIgNzcwIFRtCi9oZWx2IDExIFRmIFs8NDUzMjQ1MjA1MzYxNmQ3MDZjNjUyMDQxNjc3MjY1NjU2ZDY1NmU3ND5dVEoKRVQKUQoKZW5kc3RyZWFtCmVuZG9iagoKNyAwIG9iago8PC9MZW5ndGggMTI2L0ZpbHRlci9GbGF0ZURlY29kZT4+CnN0cmVhbQp42i2LMQ4CMQwEe7/CPyBx4vVFQhRINHQnpTtRkUQUUNDwfnwBufLsDL3pXCly8ItswpaF64sOj/78cIxcB29HzVhQLElAxkAyRYOiuxx+3BIKDN3pZOjO9kolaMAd0YqZybSW2XnvbnNrSPt/e6OWfO+nW73SpdJKX7iZJOQKZW5kc3RyZWFtCmVuZG9iagoKeHJlZgowIDgKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDQyIDAwMDAwIG4gCjAwMDAwMDAxMjAgMDAwMDAgbiAKMDAwMDAwMDE3MiAwMDAwMCBuIAowMDAwMDAwMjEzIDAwMDAwIG4gCjAwMDAwMDAzMjYgMDAwMDAgbiAKMDAwMDAwMDQxNSAwMDAwMCBuIAowMDAwMDAwNTUyIDAwMDAwIG4gCgp0cmFpbGVyCjw8L1NpemUgOC9Sb290IDEgMCBSL0lEWzwyMjcwQzI5QzMyNjc2M0MyOEQyMkMzQjJDM0FGQzM4Qj48ODc4REU1RUFGNzgwRTU0MTJCRDZBQjM3NjdENTc2NTc+XT4+CnN0YXJ0eHJlZgo3NDcKJSVFT0YK";

const SAMPLE_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCADwAUADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDmaKKK+zPmQooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/9k=";

export function samplePdf() {
  return {
    name: "sample-agreement.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(SAMPLE_PDF_B64, "base64"),
  };
}

export function samplePhoto() {
  return {
    name: "witness.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(SAMPLE_JPEG_B64, "base64"),
  };
}

export function runId(): string {
  return Date.now().toString(36);
}

// Deterministic shots for the visual review queue land in e2e/screenshots/
// (git-ignored, uploaded as a CI artifact). Names are numbered in flow
// order; each captures a state a human may want to eyeball.
export async function shot(page: Page, name: string) {
  await page.screenshot({
    path: path.join(__dirname, "..", "screenshots", name),
    fullPage: true,
  });
}

// Draw a simple continuous stroke on the signature canvas with the mouse —
// enough ink for the pad to accept it and enable its continue button.
export async function drawSignature(page: Page) {
  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("signature canvas not visible");
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.15, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(
      box.x + box.width * (0.15 + 0.06 * i),
      y + Math.sin(i) * box.height * 0.18,
    );
  }
  await page.mouse.up();
}
