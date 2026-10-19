import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSession,
  mediaUrl,
  sessionDocumentUrl,
  submitSignature,
  uploadDocument,
} from "./api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("uploadDocument", () => {
  it("posts a multipart form to /api/documents/", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: "doc-1" }, 201));
    const file = new File(["%PDF-"], "contract.pdf", {
      type: "application/pdf",
    });
    const result = await uploadDocument(file, "Contract", "s@example.com");
    expect(result.id).toBe("doc-1");

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("/api/documents/");
    expect(init?.method).toBe("POST");
    const form = init?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("title")).toBe("Contract");
    expect(form.get("sender_email")).toBe("s@example.com");
  });

  it("throws an ApiError carrying the server message and status", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ error: "file must be a PDF" }, 400)
    );
    const file = new File(["nope"], "x.txt", { type: "text/plain" });
    await expect(uploadDocument(file, "X", "s@example.com")).rejects.toMatchObject(
      { message: "file must be a PDF", status: 400 }
    );
  });
});

describe("createSession", () => {
  it("posts JSON to the document sessions endpoint", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ token: "tok" }, 201));
    const result = await createSession("doc-1", "Jane", "j@example.com");
    expect(result.token).toBe("tok");
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("/api/documents/doc-1/sessions/");
    expect(JSON.parse(init?.body as string)).toMatchObject({
      signer_name: "Jane",
      signer_email: "j@example.com",
    });
  });
});

describe("submitSignature", () => {
  it("posts the ceremony payload to the session sign endpoint", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ status: "signed", chain_valid: true })
    );
    const deviceInfo = {
      userAgent: "ua",
      platform: "p",
      language: "en",
      screenWidth: 1,
      screenHeight: 2,
    };
    const result = await submitSignature("tok123", {
      signature: "data:image/png;base64,AAA",
      photo: "data:image/png;base64,BBB",
      deviceInfo,
    });
    expect(result.status).toBe("signed");
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("/api/sessions/tok123/sign/");
    const body = JSON.parse(init?.body as string);
    expect(body.signature).toBe("data:image/png;base64,AAA");
    expect(body.photo).toBe("data:image/png;base64,BBB");
    expect(body.device_info).toEqual(deviceInfo);
  });
});

describe("sessionDocumentUrl", () => {
  it("builds the token-addressed document URL", () => {
    expect(sessionDocumentUrl("tok123")).toContain(
      "/api/sessions/tok123/document/"
    );
  });
});

describe("mediaUrl", () => {
  it("returns null for null and absolutizes relative paths", () => {
    expect(mediaUrl(null)).toBeNull();
    expect(mediaUrl("/media/signed/x.pdf")).toContain("/media/signed/x.pdf");
  });
});
