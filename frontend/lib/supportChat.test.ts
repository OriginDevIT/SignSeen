import { afterEach, describe, expect, it, vi } from "vitest";
import { ghlChatWidgetId, supportChatEnabled } from "./supportChat";

describe("GHL support chat config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled when the widget id is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_GHL_CHAT_WIDGET_ID", "");
    expect(ghlChatWidgetId()).toBe("");
    expect(supportChatEnabled()).toBe(false);
  });

  it("returns the trimmed widget id when configured", () => {
    vi.stubEnv("NEXT_PUBLIC_GHL_CHAT_WIDGET_ID", "  widget-123  ");
    expect(ghlChatWidgetId()).toBe("widget-123");
    expect(supportChatEnabled()).toBe(true);
  });
});
