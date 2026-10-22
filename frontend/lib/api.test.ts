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
    // Default plan is annual (#52).
    expect(JSON.parse(String(init?.body))).toEqual({ plan: "annual" });
    expect(url).toBe("https://checkout.stripe/x");
  });

  it("startCheckout sends a JSON Content-Type on the wire (#51)", async () => {
    const { startCheckout } = await import("./api");
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ url: "https://checkout.stripe/z" })
    );
    await startCheckout("monthly");
    const [, init] = vi.mocked(fetch).mock.calls[0];
    // Regression: a string body without this header makes fetch send
    // text/plain, and the API answers 415 Unsupported Media Type.
    const headers = new Headers(init?.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({ plan: "monthly" });
  });

  it("startCheckout sends the annual plan on the wire", async () => {
    const { startCheckout } = await import("./api");
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ url: "https://checkout.stripe/y" })
    );
    await startCheckout("annual");
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({ plan: "annual" });
  });

  it("pauseBilling posts to the pause endpoint", async () => {
    const { pauseBilling } = await import("./api");
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ billing_status: "paused" })
    );
    const result = await pauseBilling();
    const [reqUrl, init] = vi.mocked(fetch).mock.calls[0];
    expect(reqUrl).toContain("/api/billing/pause/");
    expect(init?.method).toBe("POST");
    expect(result).toBe("paused");
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


describe("setAlertsEnabled", () => {
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

  it("PATCHes /api/auth/me/ with the exact alerts_enabled body", async () => {
    const { setAlertsEnabled, setAuthToken } = await import("./api");
    setAuthToken("tok-abc");
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        id: "1",
        email: "a@example.com",
        tier: "premium",
        is_premium: true,
        alerts_enabled: false,
      })
    );
    const account = await setAlertsEnabled(false);
    expect(account.alerts_enabled).toBe(false);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("/api/auth/me/");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({
      alerts_enabled: false,
    });
    expect(init?.headers.get("Authorization")).toBe("Token tok-abc");
    setAuthToken(null);
  });
});
describe("signing_url (owner-only, issue #15)", () => {
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

  it("getDocument sends the stored token and returns signing_url verbatim", async () => {
    const { getDocument, setAuthToken } = await import("./api");
    setAuthToken("owner-token");
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        id: "d1",
        title: "T",
        status: "pending",
        signing_url: "https://staging.getsignseen.com/s/tok-xyz",
      })
    );
    const doc = await getDocument("d1");
    expect(doc.signing_url).toBe("https://staging.getsignseen.com/s/tok-xyz");
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.headers.get("Authorization")).toBe("Token owner-token");
    setAuthToken(null);
  });

  it("getDocument leaves signing_url undefined for an anonymous payload", async () => {
    const { getDocument } = await import("./api");
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ id: "d1", title: "T", status: "pending" })
    );
    const doc = await getDocument("d1");
    expect(doc.signing_url).toBeUndefined();
  });

  it("myDashboard returns each document's signing_url (URL or null)", async () => {
    const { myDashboard, setAuthToken } = await import("./api");
    setAuthToken("owner-token");
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        tier: "free",
        is_premium: false,
        storage_used_bytes: 0,
        storage_limit_bytes: 100,
        documents: [
          { id: "d1", signing_url: "https://staging.getsignseen.com/s/abc" },
          { id: "d2", signing_url: null },
        ],
        signed_documents: [],
      })
    );
    const dash = await myDashboard();
    expect(dash.documents[0].signing_url).toBe(
      "https://staging.getsignseen.com/s/abc"
    );
    expect(dash.documents[1].signing_url).toBeNull();
    setAuthToken(null);
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

describe("loginWithGoogle", () => {
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

  it("posts the exact id_token body, sends no Authorization, and stores the token", async () => {
    const { loginWithGoogle, getAuthToken, setAuthToken } = await import("./api");
    setAuthToken("stale-token");
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        token: "tok-google",
        account: { id: "1", email: "g@example.com", tier: "free", is_premium: false },
      })
    );
    const result = await loginWithGoogle("google-id-token-123");
    expect(result.account.email).toBe("g@example.com");
    expect(getAuthToken()).toBe("tok-google");
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("/api/auth/google/");
    expect(JSON.parse(init?.body as string)).toEqual({
      id_token: "google-id-token-123",
    });
    expect(init?.headers.get("Authorization")).toBeNull();
  });
});

describe("multi-signer shapes", () => {
  it("createSession surfaces the session order and waiting flag", async () => {
    const { createSession } = await import("./api");
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ token: "tok-2", order: 1, waiting: true, usable: false }, 201)
    );
    const sess = await createSession("doc-1", "Second Signer", "");
    expect(sess.order).toBe(1);
    expect(sess.waiting).toBe(true);
    expect(sess.usable).toBe(false);
  });

  it("submitSignature surfaces document_final=false for intermediate signers", async () => {
    const { submitSignature } = await import("./api");
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ status: "signed", document_final: false })
    );
    const result = await submitSignature("tok123", {
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
    expect(result.status).toBe("signed");
    expect(result.document_final).toBe(false);
  });
});

describe("document fields (#13)", () => {
  it("getDocumentFields fetches the placement list", async () => {
    const { getDocumentFields } = await import("./api");
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ page_count: 2, fields: [{ id: "f1", type: "text" }] })
    );
    const data = await getDocumentFields("doc-1");
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("/api/documents/doc-1/fields/");
    expect(data.page_count).toBe(2);
    expect(data.fields[0].type).toBe("text");
  });

  it("createDocumentField posts the exact placement body", async () => {
    const { createDocumentField } = await import("./api");
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ id: "f1", type: "signature", page: 1, x: 0.1, y: 0.2 }, 201)
    );
    const field = await createDocumentField("doc-1", {
      session_id: "sess-1",
      type: "signature",
      page: 1,
      x: 0.1,
      y: 0.2,
    });
    expect(field.id).toBe("f1");
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("/api/documents/doc-1/fields/");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      session_id: "sess-1",
      type: "signature",
      page: 1,
      x: 0.1,
      y: 0.2,
    });
  });

  it("deleteDocumentField sends DELETE to the field URL", async () => {
    const { deleteDocumentField } = await import("./api");
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
    await deleteDocumentField("doc-1", "f1");
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("/api/documents/doc-1/fields/f1/");
    expect(init?.method).toBe("DELETE");
  });

  it("sessionPageUrl builds the token-addressed page image URL", async () => {
    const { sessionPageUrl } = await import("./api");
    expect(sessionPageUrl("tok123", 2)).toContain("/api/sessions/tok123/page/2.png");
  });

  it("uploadDocument sends the signing_mode in the form", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: "doc-1" }, 201));
    const file = new File(["%PDF-"], "contract.pdf", { type: "application/pdf" });
    await uploadDocument(file, "Contract", "s@example.com", "parallel");
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const form = init?.body as FormData;
    expect(form.get("signing_mode")).toBe("parallel");
  });

  it("submitSignature sends field_values with the exact wire keys", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ status: "signed", document_final: true })
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
      fieldValues: [
        { field_id: "f1", value: "data:image/png;base64,BBB" },
        { field_id: "f2", value: true },
        { field_id: "f3", value: "hello" },
      ],
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("/api/sessions/tok123/sign/");
    const body = JSON.parse(init?.body as string);
    expect(body.field_values).toEqual([
      { field_id: "f1", value: "data:image/png;base64,BBB" },
      { field_id: "f2", value: true },
      { field_id: "f3", value: "hello" },
    ]);
    expect(init?.headers.get("Authorization")).toBeNull();
  });
});
