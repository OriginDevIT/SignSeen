/** Typed client for the SignSeen API. */

const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
).replace(/\/$/, "");

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface DocumentInfo {
  id: string;
  title: string;
  status: string;
  sender_email: string;
  signed_file: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionInfo {
  id: string;
  document: string;
  document_title: string;
  document_status: string;
  token: string;
  signer_name: string;
  signer_email: string;
  status: string;
  usable: boolean;
  expires_at: string;
  created_at: string;
  signing_url: string;
}

export interface SignResult {
  status: string;
  document: DocumentInfo;
  audit_seal: string;
  chain_valid: boolean;
}

export interface AuditEventInfo {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  prev_hash: string;
  hash: string;
  created_at: string;
}

const TOKEN_KEY = "signseen_token";

/** Sender account token, stored in localStorage (senders only — signers
 * never have accounts). Guarded for SSR/tests where window is unavailable. */
export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) {
    window.localStorage.setItem(TOKEN_KEY, token);
  } else {
    window.localStorage.removeItem(TOKEN_KEY);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set("Authorization", `Token ${token}`);
  }
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      (body as { error?: string }).error || `Request failed (${res.status})`,
      res.status
    );
  }
  return body as T;
}

/** Sender: upload a PDF to start a signing request. */
export function uploadDocument(
  file: File,
  title: string,
  senderEmail: string
): Promise<DocumentInfo> {
  const form = new FormData();
  form.append("file", file);
  form.append("title", title);
  form.append("sender_email", senderEmail);
  return req<DocumentInfo>("/api/documents/", { method: "POST", body: form });
}

/** Sender: create a signing session (the QR code / link target). */
export function createSession(
  docId: string,
  signerName = "",
  signerEmail = ""
): Promise<SessionInfo> {
  return req<SessionInfo>(`/api/documents/${docId}/sessions/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signer_name: signerName, signer_email: signerEmail }),
  });
}

/** Sender: render a web page URL to PDF, then it flows like any upload. */
export function createDocumentFromUrl(
  url: string,
  title: string,
  senderEmail: string
): Promise<DocumentInfo> {
  return req<DocumentInfo>("/api/documents/from-url/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, title, sender_email: senderEmail }),
  });
}

/** Signer: fetch session info (no account; the token is the auth). */
export function getSession(token: string): Promise<SessionInfo> {
  return req<SessionInfo>(`/api/sessions/${token}/`);
}

/** Signer: token-addressed URL of the PDF under review. */
export function sessionDocumentUrl(token: string): string {
  return `${API_BASE}/api/sessions/${token}/document/`;
}

export interface DeviceInfo {
  userAgent: string;
  platform: string;
  language: string;
  screenWidth: number;
  screenHeight: number;
  /** getTimezoneOffset(): minutes to add to local time to get UTC. */
  timezoneOffsetMinutes: number;
}

export function collectDeviceInfo(): DeviceInfo {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    screenWidth: window.screen?.width ?? 0,
    screenHeight: window.screen?.height ?? 0,
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
  };
}

/** Signer: submit the ceremony — signature image, optional photo, device info. */
export function submitSignature(
  token: string,
  payload: {
    signature: string;
    photo?: string;
    photoConsent?: boolean;
    deviceInfo: DeviceInfo;
    signerEmail?: string;
  }
): Promise<SignResult> {
  return req<SignResult>(`/api/sessions/${token}/sign/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      signature: payload.signature,
      photo: payload.photo,
      photo_consent: payload.photoConsent === true,
      device_info: payload.deviceInfo,
      signer_email: payload.signerEmail || "",
    }),
  });
}

/** Anyone with the token: the tamper-evident audit trail. */
export function getSessionEvents(
  token: string
): Promise<{ chain_valid: boolean; events: AuditEventInfo[] }> {
  return req(`/api/sessions/${token}/events/`);
}

/** Absolute URL for a media path returned by the API (e.g. signed_file). */
export function mediaUrl(path: string | null): string | null {
  if (!path) return null;
  return path.startsWith("http") ? path : `${API_BASE}${path}`;
}

/* ------------------------------------------------------------------ */
/* Sender accounts (storage tier). Email + password.                    */
/* ------------------------------------------------------------------ */

export interface AccountInfo {
  id: string;
  email: string;
  tier: "free" | "premium";
  is_premium: boolean;
}

interface AuthResult {
  token: string;
  account: AccountInfo;
}

export async function signup(
  email: string,
  password: string
): Promise<AuthResult> {
  const result = await req<AuthResult>("/api/auth/signup/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  setAuthToken(result.token);
  return result;
}

export async function login(
  email: string,
  password: string
): Promise<AuthResult> {
  const result = await req<AuthResult>("/api/auth/login/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  setAuthToken(result.token);
  return result;
}

export async function logout(): Promise<void> {
  try {
    await req("/api/auth/logout/", { method: "POST" });
  } finally {
    setAuthToken(null);
  }
}

export function myAccount(): Promise<AccountInfo> {
  return req<AccountInfo>("/api/auth/me/");
}

export function requestPasswordReset(email: string): Promise<void> {
  return req("/api/auth/password-reset/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

export function confirmPasswordReset(
  uid: string,
  token: string,
  password: string
): Promise<void> {
  return req("/api/auth/password-reset/confirm/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid, token, password }),
  });
}

/* ------------------------------------------------------------------ */
/* Sender dashboard (logged-in accounts only).                         */
/* ------------------------------------------------------------------ */

export interface DashboardData {
  tier: "free" | "premium";
  is_premium: boolean;
  storage_used_bytes: number;
  storage_limit_bytes: number;
  documents: DocumentInfo[];
  /** Documents this account signed as a signer (by email match). */
  signed_documents: DocumentInfo[];
}

export function myDashboard(): Promise<DashboardData> {
  return req<DashboardData>("/api/documents/mine/");
}

/** Public tracking page data for a document (status + signed download). */
export function getDocument(docId: string): Promise<DocumentInfo> {
  return req<DocumentInfo>(`/api/documents/${docId}/`);
}

/* ------------------------------------------------------------------ */
/* Billing (Stripe; disabled server-side when unconfigured).            */
/* ------------------------------------------------------------------ */

export async function startCheckout(): Promise<string> {
  const { url } = await req<{ url: string }>("/api/billing/checkout/", {
    method: "POST",
  });
  return url;
}

export async function openBillingPortal(): Promise<string> {
  const { url } = await req<{ url: string }>("/api/billing/portal/", {
    method: "POST",
  });
  return url;
}
