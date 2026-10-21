"use client";

import { useEffect } from "react";
import {
  GHL_LOADER_SRC,
  GHL_RESOURCES_URL,
  ghlChatWidgetId,
} from "../lib/supportChat";

/**
 * Loads the GoHighLevel chat widget (with its AI assistant) on every
 * page. Renders nothing and loads nothing until
 * NEXT_PUBLIC_GHL_CHAT_WIDGET_ID is configured.
 */
export default function SupportChat() {
  useEffect(() => {
    const widgetId = ghlChatWidgetId();
    if (!widgetId) return;
    if (document.querySelector("script[data-ghl-chat-widget]")) return;
    const script = document.createElement("script");
    script.src = GHL_LOADER_SRC;
    script.async = true;
    script.dataset.resourcesUrl = GHL_RESOURCES_URL;
    script.dataset.widgetId = widgetId;
    script.dataset.ghlChatWidget = "true";
    document.body.appendChild(script);
  }, []);
  return null;
}
