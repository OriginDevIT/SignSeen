import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDocumentFromUrl,
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
      timezoneOffsetMinutes: 300,
    };
    const result = await submitSignature("tok123", {
      signature: "data:image/png;base64,AAA",
      photo: "data:image/png;base64,BBB",
      photoConsent: true,
      deviceInfo,
    });
    expect(result.status).toBe("signed");
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("/api/sessions/tok123/sign/");
    const body = JSON.parse(init?.body as string);
    expect(body.signature).toBe("data:image/png;base64,AAA");
    expect(body.photo).toBe("data:image/png;base64,BBB");
    expect(body.photo_consent).toBe(true);
    expect(body.device_info).toEqual(deviceInfo);
  });

  it("sends photo_consent=false when consent is not given", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ status: "signed", chain_valid: true })
    );
    await submitSignature("tok123", {
      signature: "data:image/png;base64,AAA",
      deviceInfo: {
        userAgent: "ua",
        platform: "p",
        language: "en",
        screenWidth: 1,
        screenHeight: 2,
        timezoneOffsetMinutes: 0,
      },
    });
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.photo_consent).toBe(false);
  });
});

describe("createDocumentFromUrl", () => {
  it("posts the URL payload to /api/documents/from-url/", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: "doc-9" }, 201));
    const result = await createDocumentFromUrl(
      "https://example.com/terms",
      "ToS",
      "s@example.com"
    );
    expect(result.id).toBe("doc-9");
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("/api/documents/from-url/");
    expect(JSON.parse(init?.body as string)).toMatchObject({
      url: "https://example.com/terms",
      title: "ToS",
      sender_email: "s@example.com",
    });
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

describe("auth", () => {
  const store: Record<string, string> = {};
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
          store[k] = v;
        },
        removeItem: (k: string) => {
          delete store[k];
        },
      },
    });
  });

  it("login posts credentials and stores the token", async () => {
    const { login, getAuthToken, setAuthToken } = await import("./api");
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        token: "tok-abc",
        account: { id: "1", email: "a@example.com", tier: "free", is_premium: false },
      })
    );
    setAuthToken(null);
    const result = await login("a@example.com", "longpassword1");
    expect(result.account.email).toBe("a@example.com");
    expect(getAuthToken()).toBe("tok-abc");
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(init?.body as string).email).toBe("a@example.com");
  });

  it("attaches the stored token to later requests", async () => {
    const { setAuthToken, myDashboard } = await import("./api");
    setAuthToken("tok-abc");
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ tier: "free", is_premium: false, documents: [] })
    );
    await myDashboard();
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.headers.get("Authorization")).toBe("Token tok-abc");
    setAuthToken(null);
  });

  it("logout clears the stored token", async () => {
    const { setAuthToken, getAuthToken, logout } = await import("./api");
    setAuthToken("tok-abc");
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ status: "logged out" }));
    await logout();
    expect(getAuthToken()).toBeNull();
  });

  it("getDocument fetches the public document detail", async () => {
    const { getDocument } = await import("./api");
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ id: "d1", title: "T", status: "pending" })
    );
    const doc = await getDocument("d1");
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("/api/documents/d1/");
    expect(doc.title).toBe("T");
  });

  it("startCheckout returns the Stripe URL", async () => {
    const { startCheckout } = await import("./api");
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ url: "https://checkout.stripe/x" })
    );
    const url = await startCheckout();
    const [reqUrl, init] = vi.mocked(fetch).mock.calls[0];
    expect(reqUrl).toContain("/api/billing/checkout/");
    expect(init?.method).toBe("POST");
    expect(url).toBe("https://checkout.stripe/x");
  });
});

describe("stale sender token handling", () => {
  const store: Record<string, string> = {};
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
          store[k] = v;
        },
        removeItem: (k: string) => {
          delete store[k];
        },
      },
    });
  });

  it("getSession sends no Authorization header even with a stored token", async () => {
    const { getSession, setAuthToken } = await import("./api");
    setAuthToken("stale-token");
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ token: "sess-1", usable: true })
    );
    await getSession("sess-1");
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.headers.get("Authorization")).toBeNull();
  });

  it("submitSignature sends no Authorization header", async () => {
    const { submitSignature, setAuthToken } = await import("./api");
    setAuthToken("stale-token");
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ status: "signed" }));
    await submitSignature("sess-1", {
      signature: "data:image/png;base64,AAA",
      deviceInfo: {
        userAgent: "ua",
        platform: "p",
        language: "en",
        screenWidth: 1,
        screenHeight: 2,
        timezoneOffsetMinutes: 0,
      },
    });
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.headers.get("Authorization")).toBeNull();
  });

  it("a 401 Invalid token clears the stored token and surfaces detail", async () => {
    const { myDashboard, getAuthToken, setAuthToken } = await import("./api");
    setAuthToken("stale-token");
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ detail: "Invalid token." }, 401)
    );
    await expect(myDashboard()).rejects.toMatchObject({
      message: "Invalid token.",
      status: 401,
    });
    expect(getAuthToken()).toBeNull();
  });
});

describe("setSignerEmail", () => {
  const store: Record<string, string> = {};
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
          store[k] = v;
        },
        removeItem: (k: string) => {
          delete store[k];
        },
      },
    });
  });

  it("posts the exact email body to the signer-email endpoint, with no Authorization header", async () => {
    const { setSignerEmail, setAuthToken } = await import("./api");
    setAuthToken("stale-token");
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ status: "ok", signer_email: "jane@example.com" })
    );
    const result = await setSignerEmail("sess-1", "jane@example.com");
    expect(result.signer_email).toBe("jane@example.com");
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("/api/sessions/sess-1/signer-email/");
    expect(JSON.parse(init?.body as string)).toEqual({
      email: "jane@example.com",
    });
    expect(init?.headers.get("Authorization")).toBeNull();
  });
});

describe("updateBranding", () => {
  const store: Record<string, string> = {};
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
          store[k] = v;
        },
        removeItem: (k: string) => {
          delete store[k];
        },
      },
    });
  });

  it("PATCHes JSON brand_name/brand_color to /api/auth/branding/ with the auth token", async () => {
    const { updateBranding, setAuthToken } = await import("./api");
    setAuthToken("tok-abc");
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ brand_name: "Acme Legal", brand_color: "#123abc", brand_logo: null })
    );
    const result = await updateBranding({
      brandName: "Acme Legal",
      brandColor: "#123abc",
    });
    expect(result.brand_name).toBe("Acme Legal");
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("/api/auth/branding/");
    expect(init?.method).toBe("PATCH");
    expect(init?.headers.get("Authorization")).toBe("Token tok-abc");
    expect(JSON.parse(init?.body as string)).toEqual({
      brand_name: "Acme Legal",
      brand_color: "#123abc",
    });
  });

  it("sends multipart form data (with the logo file) when a logo is chosen", async () => {
    const { updateBranding } = await import("./api");
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        brand_name: "Acme Legal",
        brand_color: "",
        brand_logo: "/media/branding/logo.png",
      })
    );
    const logo = new File(["png-bytes"], "logo.png", { type: "image/png" });
    await updateBranding({ brandName: "Acme Legal", logoFile: logo });
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.method).toBe("PATCH");
    const form = init?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("brand_name")).toBe("Acme Legal");
    expect((form.get("brand_logo") as File).name).toBe("logo.png");
    expect(form.get("brand_color")).toBeNull();
  });
});
