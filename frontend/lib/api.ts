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

export interface SessionSummary {
  id: string;
  signer_name: string;
  signer_email: string;
  status: string;
  order: number;
  /** When the signer submitted their signature; null until signed. */
  signed_at: string | null;
}

export interface DocumentInfo {
  id: string;
  title: string;
  status: string;
  sender_email: string;
  /** Original uploaded file, for downloading an unsigned document. */
  original_file: string | null;
  signed_file: string | null;
  signing_mode: "sequential" | "parallel";
  /** Sender option (#73): every signer must attach a witness photo. */
  photo_required: boolean;
  /** Step-1 signer list (#89): name/email dicts in signing order.
   * Present on draft payloads (creation, detail, PATCH); the input
   * key for create/PATCH is "signers", the response field is
   * "signer_list". */
  signer_list?: { name: string; email: string }[];
  /** Anonymous sender's draft credential (#89): exposed only on
   * draft creation and to the owner / token holder; omitted
   * otherwise. */
  draft_token?: string;
  /** Original uploaded filename, for the review step. */
  original_filename?: string;
  sessions?: SessionSummary[];
  /** The active signing session's URL. Returned to the document's
   * owner only: present (URL or null) in dashboard payloads and in
   * the single-document view for an authenticated owner; omitted
   * entirely from the public document view for everyone else. */
  signing_url?: string | null;
  created_at: string;
  updated_at: string;
}

export type FieldType =
  | "signature"
  | "initials"
  | "checkbox"
  | "text"
  | "date"
  | "signed_date";

/** Display form of a field type ("signed date" for the signed-date
 * type; the bare type name otherwise). The wire name carries an
 * underscore, which reads badly in the UI. */
export function fieldTypeLabel(type: FieldType): string {
  return type === "signed_date" ? "signed date" : type;
}

/** A sender-placed field (#13), assigned to one signer session. */
export interface DocumentFieldInfo {
  id: string;
  document: string;
  /** The session this field belongs to once the document is sent;
   * null on a draft, where the field is assigned to a signer slot
   * (signer_index) until send links it (#89). */
  session: string | null;
  /** Position in the draft's signer list (#89); the session order
   * once sent. */
  signer_index: number;
  type: FieldType;
  page: number;
  /** Normalized coordinates (0-1 fractions of the page size). */
  x: number;
  y: number;
  /** Normalized size of a drawn box (0-1 fractions of the page
   * size). Null for click-placed fields, which render at the fixed
   * per-type sizes. */
  width: number | null;
  height: number | null;
  required: boolean;
  /** Text value (text/date submitted values; "true"/"false" for a
   * checkbox). Signature/initials values are stored server-side. */
  value: string;
  completed: boolean;
  completed_at: string | null;
  created_at: string;
}

/** One field value in a ceremony submit. */
export interface FieldValue {
  field_id: string;
  value: string | boolean;
}

export interface SessionBranding {
  name: string;
  color: string;
  logo: string | null;
}

export interface SessionInfo {
  id: string;
  document: string;
  document_title: string;
  document_status: string;
  /** Sender option (#73): every signer must attach a witness photo. */
  photo_required: boolean;
  /** The sender's email, so the ceremony can name who required it. */
  sender_email: string;
  token: string;
  signer_name: string;
  signer_email: string;
  status: string;
  order: number;
  usable: boolean;
  /** True while an earlier signer in the sequence has not signed. */
  waiting: boolean;
  branding: SessionBranding;
  expires_at: string;
  created_at: string;
  signing_url: string;
  /** This signer's assigned fields (#13); empty for simple documents. */
  fields: DocumentFieldInfo[];
  /** Fields other signers already completed on this document (#105),
   * completed only — other signers' empty fields stay hidden. Shown
   * read-only in the ceremony; never the signer's own fields. */
  completed_fields: DocumentFieldInfo[];
}

export interface SignResult {
  status: string;
  /** False when this signer's part is done but the document still
   * awaits the remaining signer(s) (multi-signer); the document has
   * no signed file until the final signature seals it. */
  document_final: boolean;
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

interface ReqOptions {
  /** Attach the stored sender token. Public / signer endpoints pass
   * false: the signing token in the URL is their credential, and a
   * stale sender token must never break a signing link. */
  auth?: boolean;
  /** Anonymous draft credential (#89): sent as X-Draft-Token. */
  draftToken?: string;
}

const DRAFT_TOKEN_KEY_PREFIX = "signseen_draft_token:";

/** Anonymous sender's draft credential (#89), kept in sessionStorage
 * keyed by draft id: it authorizes field edits, PATCH, discard and
 * send on that draft only, and it dies with the tab. */
export function getDraftToken(docId: string): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(`${DRAFT_TOKEN_KEY_PREFIX}${docId}`);
}

export function setDraftToken(docId: string, token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) {
    window.sessionStorage.setItem(`${DRAFT_TOKEN_KEY_PREFIX}${docId}`, token);
  } else {
    window.sessionStorage.removeItem(`${DRAFT_TOKEN_KEY_PREFIX}${docId}`);
  }
}

export function clearDraftToken(docId: string): void {
  setDraftToken(docId, null);
}

/** Post-send confirmation (#89), kept in sessionStorage keyed by
 * document id so a refresh still shows the signing links. */
export function getSendResult(docId: string): SessionInfo[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(`signseen_send_result:${docId}`);
    return raw ? (JSON.parse(raw) as SessionInfo[]) : null;
  } catch {
    return null;
  }
}

export function setSendResult(docId: string, sessions: SessionInfo[]): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(
    `signseen_send_result:${docId}`,
    JSON.stringify(sessions)
  );
}

export function clearSendResult(docId: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(`signseen_send_result:${docId}`);
}

async function req<T>(
  path: string,
  init?: RequestInit,
  options?: ReqOptions
): Promise<T> {
  const useAuth = options?.auth !== false;
  const token = useAuth ? getAuthToken() : null;
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set("Authorization", `Token ${token}`);
  }
  if (options?.draftToken) {
    headers.set("X-Draft-Token", options.draftToken);
  }
  // A string body without an explicit Content-Type makes fetch send
  // text/plain, which the API rejects with 415 (#51) — JSON is the
  // wire format for every string body this client sends.
  if (typeof init?.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const { error, detail } = body as { error?: string; detail?: string };
    const message = error || detail || `Request failed (${res.status})`;
    // The server no longer knows this token (logout elsewhere,
    // password reset, database reset): drop it so later requests
    // don't keep failing the same way.
    if (res.status === 401 && /invalid token/i.test(message)) {
      setAuthToken(null);
    }
    throw new ApiError(message, res.status);
  }
  return body as T;
}

/** Step-1 signer list (#89): one entry per signer, in order. */
export interface SignerInput {
  name: string;
  email: string;
}

/** Sender: upload a PDF to start a signing request. Step 1 (#89)
 * creates a DRAFT — no sessions, no emails — and returns the draft
 * (with its draft token for anonymous senders). */
export function uploadDocument(
  file: File,
  title: string,
  senderEmail: string,
  signingMode: "sequential" | "parallel" = "sequential",
  photoRequired: boolean = false,
  signers?: SignerInput[]
): Promise<DocumentInfo> {
  const form = new FormData();
  form.append("file", file);
  form.append("title", title);
  form.append("sender_email", senderEmail);
  form.append("signing_mode", signingMode);
  form.append("photo_required", String(photoRequired));
  if (signers !== undefined) {
    form.append("signers", JSON.stringify(signers));
  }
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

/** Sender: render a web page URL to PDF, then it flows like any upload.
 * Step 1 (#89): creates a DRAFT, no sessions, no emails. */
export function createDocumentFromUrl(
  url: string,
  title: string,
  senderEmail: string,
  signingMode: "sequential" | "parallel" = "sequential",
  photoRequired: boolean = false,
  signers?: SignerInput[]
): Promise<DocumentInfo> {
  return req<DocumentInfo>("/api/documents/from-url/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      title,
      sender_email: senderEmail,
      signing_mode: signingMode,
      photo_required: photoRequired,
      ...(signers !== undefined ? { signers } : {}),
    }),
  });
}

/** Step 3 Send (#89): turn a draft into a pending document — one
 * session per signer in list order, signer emails sent. The free
 * 1-pending-document limit is enforced here, at send time. */
export function sendDocument(
  docId: string,
  draftToken?: string | null
): Promise<{ document: DocumentInfo; sessions: SessionInfo[] }> {
  return req<{ document: DocumentInfo; sessions: SessionInfo[] }>(
    `/api/documents/${docId}/send/`,
    { method: "POST", body: "{}" },
    { draftToken: draftToken ?? undefined }
  );
}

export interface DraftPatch {
  title?: string;
  signing_mode?: "sequential" | "parallel";
  photo_required?: boolean;
  signers?: SignerInput[];
}

/** Draft-only (#89): edit a draft's title, signing mode, photo flag
 * or signer list. Removing a signer who has placed fields is
 * rejected until those fields are deleted first. */
export function patchDocument(
  docId: string,
  patch: DraftPatch,
  draftToken?: string | null
): Promise<DocumentInfo> {
  return req<DocumentInfo>(
    `/api/documents/${docId}/`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
    { draftToken: draftToken ?? undefined }
  );
}

/** Discard a draft (#89): deletes the document and its files. */
export function discardDraft(
  docId: string,
  draftToken?: string | null
): Promise<void> {
  return req<void>(
    `/api/documents/${docId}/`,
    { method: "DELETE" },
    { draftToken: draftToken ?? undefined }
  );
}

/** Delete an owned document at any status: removes the document,
 * its sessions, and its files. */
export function deleteDocument(docId: string): Promise<void> {
  return req<void>(`/api/documents/${docId}/`, { method: "DELETE" });
}

/** Signer: fetch session info (no account; the token is the auth). */
export function getSession(token: string): Promise<SessionInfo> {
  return req<SessionInfo>(`/api/sessions/${token}/`, undefined, { auth: false });
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
    fieldValues?: FieldValue[];
  }
): Promise<SignResult> {
  return req<SignResult>(
    `/api/sessions/${token}/sign/`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signature: payload.signature,
        photo: payload.photo,
        photo_consent: payload.photoConsent === true,
        device_info: payload.deviceInfo,
        signer_email: payload.signerEmail || "",
        field_values: payload.fieldValues ?? [],
      }),
    },
    { auth: false }
  );
}

/** Signer, at completion: leave an email to receive a copy of the sealed
 * document. This email is also what links the document to a later
 * account's "Documents you've signed" archive. */
export function setSignerEmail(
  token: string,
  email: string
): Promise<{ status: string; signer_email: string }> {
  return req(
    `/api/sessions/${token}/signer-email/`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    },
    { auth: false }
  );
}

/** Anyone with the token: the tamper-evident audit trail. */
export function getSessionEvents(
  token: string
): Promise<{ chain_valid: boolean; events: AuditEventInfo[] }> {
  return req(`/api/sessions/${token}/events/`, undefined, { auth: false });
}

/* ------------------------------------------------------------------ */
/* Complex-document fields (#13). Placement is owner-only.             */
/* ------------------------------------------------------------------ */

export interface DocumentFieldsData {
  page_count: number;
  fields: DocumentFieldInfo[];
}

export function getDocumentFields(
  docId: string,
  draftToken?: string | null
): Promise<DocumentFieldsData> {
  return req<DocumentFieldsData>(`/api/documents/${docId}/fields/`, undefined, {
    draftToken: draftToken ?? undefined,
  });
}

export function createDocumentField(
  docId: string,
  field: {
    /** Sent documents (#13): the session the field belongs to. */
    session_id?: string;
    /** Drafts (#89): the signer slot in the draft's signer list. */
    signer_index?: number;
    type: FieldType;
    page: number;
    x: number;
    y: number;
    /** Normalized size of a drawn box; omit for a click-placed field,
     * which the server renders at the fixed per-type size. */
    width?: number;
    height?: number;
    required?: boolean;
  },
  draftToken?: string | null
): Promise<DocumentFieldInfo> {
  return req<DocumentFieldInfo>(
    `/api/documents/${docId}/fields/`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(field),
    },
    { draftToken: draftToken ?? undefined }
  );
}

export function deleteDocumentField(
  docId: string,
  fieldId: string,
  draftToken?: string | null
): Promise<void> {
  return req(
    `/api/documents/${docId}/fields/${fieldId}/`,
    { method: "DELETE" },
    { draftToken: draftToken ?? undefined }
  );
}

/** Move a field to a new position on the same page. Only x/y change;
 * type, assignment and size stay as placed. */
export function updateDocumentField(
  docId: string,
  fieldId: string,
  position: { x: number; y: number },
  draftToken?: string | null
): Promise<DocumentFieldInfo> {
  return req<DocumentFieldInfo>(
    `/api/documents/${docId}/fields/${fieldId}/`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(position),
    },
    { draftToken: draftToken ?? undefined }
  );
}

/** Owner-only page render for placement. The endpoint needs the
 * Authorization header, so it is fetched as a blob (an <img> tag
 * cannot send headers). Caller owns revoking the object URL. */
export async function fetchDocumentPageImageUrl(
  docId: string,
  page: number,
  draftToken?: string | null
): Promise<string> {
  const token = getAuthToken();
  const headers = new Headers();
  if (token) {
    headers.set("Authorization", `Token ${token}`);
  }
  if (draftToken) {
    headers.set("X-Draft-Token", draftToken);
  }
  const res = await fetch(`${API_BASE}/api/documents/${docId}/page/${page}.png`, {
    headers,
  });
  if (!res.ok) {
    throw new ApiError(`Could not load page ${page} (${res.status})`, res.status);
  }
  return URL.createObjectURL(await res.blob());
}

/** Signer page render URL (token-addressed; plain <img> works). */
export function sessionPageUrl(token: string, page: number): string {
  return `${API_BASE}/api/sessions/${token}/page/${page}.png`;
}

/** Stored image for a completed signature/initials field (#105),
 * token-addressed like the page renders. */
export function sessionFieldImageUrl(token: string, fieldId: string): string {
  return `${API_BASE}/api/sessions/${token}/fields/${fieldId}/image/`;
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
  name: string;
  tier: "free" | "premium";
  is_premium: boolean;
  alerts_enabled: boolean;
  billing_status: "active" | "suspended" | "paused" | "expired";
}

interface AuthResult {
  token: string;
  account: AccountInfo;
}

export async function signup(
  email: string,
  password: string,
  name?: string
): Promise<AuthResult> {
  const body: Record<string, string> = { email, password };
  // Name is optional: omitted when blank so older flows are untouched.
  if (name && name.trim()) body.name = name.trim();
  const result = await req<AuthResult>(
    "/api/auth/signup/",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { auth: false }
  );
  setAuthToken(result.token);
  return result;
}

export async function login(
  email: string,
  password: string
): Promise<AuthResult> {
  const result = await req<AuthResult>(
    "/api/auth/login/",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
    { auth: false }
  );
  setAuthToken(result.token);
  return result;
}

/** Sign up / log in with a Google ID token (verified server-side).
 * The account is keyed by the verified Google email, so this links to
 * an existing password account with the same email. */
export async function loginWithGoogle(idToken: string): Promise<AuthResult> {
  const result = await req<AuthResult>(
    "/api/auth/google/",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_token: idToken }),
    },
    { auth: false }
  );
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

/* ------------------------------------------------------------------ */
/* Custom branding (premium accounts).                                 */
/* ------------------------------------------------------------------ */

export interface BrandingInfo {
  brand_name: string;
  brand_color: string;
  brand_logo: string | null;
}

export function getBranding(): Promise<BrandingInfo> {
  return req<BrandingInfo>("/api/auth/branding/");
}

/** Update branding. Sends multipart when a logo file is included
 * (files can't ride JSON), plain JSON otherwise. Only the fields
 * provided are sent — the API leaves the rest untouched. */
export function updateBranding(input: {
  brandName?: string;
  brandColor?: string;
  logoFile?: File | null;
}): Promise<BrandingInfo> {
  if (input.logoFile) {
    const form = new FormData();
    if (input.brandName !== undefined) form.append("brand_name", input.brandName);
    if (input.brandColor !== undefined) form.append("brand_color", input.brandColor);
    form.append("brand_logo", input.logoFile);
    return req<BrandingInfo>("/api/auth/branding/", {
      method: "PATCH",
      body: form,
    });
  }
  const body: Record<string, string> = {};
  if (input.brandName !== undefined) body.brand_name = input.brandName;
  if (input.brandColor !== undefined) body.brand_color = input.brandColor;
  return req<BrandingInfo>("/api/auth/branding/", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Toggle signing alerts (viewed / expiring-soon emails) for this account. */
export function setAlertsEnabled(enabled: boolean): Promise<AccountInfo> {
  return req<AccountInfo>("/api/auth/me/", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ alerts_enabled: enabled }),
  });
}

/** Update the account's personal name. An empty name clears it. */
export function updateAccountName(name: string): Promise<AccountInfo> {
  return req<AccountInfo>("/api/auth/me/", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export function requestPasswordReset(email: string): Promise<void> {
  return req(
    "/api/auth/password-reset/",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    },
    { auth: false }
  );
}

export function confirmPasswordReset(
  uid: string,
  token: string,
  password: string
): Promise<void> {
  return req(
    "/api/auth/password-reset/confirm/",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, token, password }),
    },
    { auth: false }
  );
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

/** Tracking page data for a document (status + signed download).
 * Sends the stored sender token when there is one: the server
 * returns the owner-only signing_url to the document's owner and
 * the public fields to everyone else (anonymous or stale-token
 * requests included). A draft token opens the draft detail (and its
 * draft_token) to the anonymous sender who holds it. */
export function getDocument(
  docId: string,
  draftToken?: string | null
): Promise<DocumentInfo> {
  return req<DocumentInfo>(`/api/documents/${docId}/`, undefined, {
    draftToken: draftToken ?? undefined,
  });
}

/* ------------------------------------------------------------------ */
/* Billing (Stripe; disabled server-side when unconfigured).            */
/* ------------------------------------------------------------------ */

export async function startCheckout(
  plan: "monthly" | "annual" = "annual",
): Promise<string> {
  const { url } = await req<{ url: string }>("/api/billing/checkout/", {
    method: "POST",
    body: JSON.stringify({ plan }),
  });
  return url;
}

export async function pauseBilling(): Promise<string> {
  const { billing_status } = await req<{ billing_status: string }>(
    "/api/billing/pause/",
    { method: "POST" },
  );
  return billing_status;
}

export async function resumeBilling(): Promise<string> {
  const { billing_status } = await req<{ billing_status: string }>(
    "/api/billing/resume/",
    { method: "POST" },
  );
  return billing_status;
}

export async function openBillingPortal(): Promise<string> {
  const { url } = await req<{ url: string }>("/api/billing/portal/", {
    method: "POST",
  });
  return url;
}

/* ------------------------------------------------------------------ */
/* Public document verification (#74). No account, no login.           */
/* ------------------------------------------------------------------ */

export type VerifyReason =
  | "not_a_signseen_document"
  | "seal_mismatch"
  | "chain_broken"
  | "file_altered";

/** Client-side upload cap, matching the server's 15 MB limit. */
export const MAX_VERIFY_FILE_BYTES = 15 * 1024 * 1024;

/** Plain-words explanation for each invalid verdict. The server
 * returns only the reason category; the wording lives here. */
export const VERIFY_REASON_TEXT: Record<VerifyReason, string> = {
  not_a_signseen_document: "This file is not a document sealed by SignSeen.",
  seal_mismatch:
    "The audit seal in this file does not match the seal in the document's audit trail.",
  chain_broken:
    "The document's audit trail does not check out — it may have been tampered with.",
  file_altered: "This file was changed after it was sealed.",
};

export interface VerifyVerdict {
  valid: boolean;
  /** Present when valid: the sealed document's title. */
  document_title?: string;
  /** Present when valid: the sealing instant, explicit UTC (…Z). */
  signed_at?: string;
  /** Present when valid: how many signers the certificate names. */
  signer_count?: number;
  /** Present when valid: the signer email(s), comma-separated. */
  signer_email?: string;
  /** Present when invalid: the reason category, nothing more. */
  reason?: VerifyReason;
}

/** Upload a PDF and ask the server whether this system sealed it.

Public endpoint: no sender token is attached (a stale one must never
break a public check), and the server keeps nothing from the upload.
*/
export function verifyDocument(file: File): Promise<VerifyVerdict> {
  const form = new FormData();
  form.append("file", file);
  return req<VerifyVerdict>(
    "/api/verify/",
    { method: "POST", body: form },
    { auth: false },
  );
}
