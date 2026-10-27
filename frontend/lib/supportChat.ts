/**
 * GoHighLevel support chat widget (issue #38).
 *
 * Support for the hosted service runs on a GHL account with its AI
 * chatbot. The widget is loaded from
 * LeadConnector's CDN and is configured entirely by the widget id:
 * with NEXT_PUBLIC_GHL_CHAT_WIDGET_ID unset the widget is inert and
 * nothing is loaded — same env-gated pattern as Google sign-in.
 */

export const GHL_LOADER_SRC = "https://widgets.leadconnectorhq.com/loader.js";
export const GHL_RESOURCES_URL =
  "https://widgets.leadconnectorhq.com/chat-widget/loader.js";

/** The configured GHL chat widget id, or "" when support chat is off. */
export function ghlChatWidgetId(): string {
  return (process.env.NEXT_PUBLIC_GHL_CHAT_WIDGET_ID || "").trim();
}

export function supportChatEnabled(): boolean {
  return ghlChatWidgetId().length > 0;
}
