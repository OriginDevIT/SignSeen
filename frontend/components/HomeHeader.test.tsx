// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import HomeHeader from "./HomeHeader";

const TOKEN_KEY = "signseen_token";

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(TOKEN_KEY);
});

describe("HomeHeader", () => {
  it("shows Log in / Create account once the account check settles for a signed-out visitor", async () => {
    render(<HomeHeader />);
    // No auth links render before the account check settles (#201), so
    // the signed-out links only appear after mount.
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Log in" })).toBeTruthy()
    );
    expect(screen.getByRole("link", { name: "Create account" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Dashboard" })).toBeNull();
  });

  it("shows Dashboard after mount when a token is stored", async () => {
    window.localStorage.setItem(TOKEN_KEY, "test-token");
    render(<HomeHeader />);
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Dashboard" })).toBeTruthy()
    );
    expect(screen.queryByRole("link", { name: "Log in" })).toBeNull();
  });

  it("shows the shared navigation link: Send a document, and no separate Home link", () => {
    render(<HomeHeader />);
    // The wordmark itself is the Home link (#164), so there is no
    // standalone "Home" link in the navigation.
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "SignSeen" }).getAttribute("href")
    ).toBe("/");
    expect(screen.getByRole("link", { name: "Send a document" })).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Send a document" })
        .getAttribute("href"),
    ).toBe("/send");
  });

  it("renders no auth links before the account check settles", () => {
    // renderToString runs no effects, like the server: it is the
    // pre-settle render, and it must show no auth links at all (#201)
    // so a signed-in sender never briefly sees the signed-out links.
    const html = renderToString(<HomeHeader />);
    expect(html).not.toContain('href="/login"');
    expect(html).not.toContain('href="/signup"');
    expect(html).not.toContain('href="/dashboard"');
    // The non-auth navigation still renders on the first render.
    expect(html).toContain('href="/"');
    expect(html).toContain(">SignSeen</a>");
    expect(html).toContain('href="/send"');
  });

  it("server render is identical with a token stored (no hydration mismatch)", () => {
    // renderToString runs no effects, like the server: the first render
    // must never read the token, so a signed-in sender's server HTML
    // matches the client's first render (#91) — and neither shows any
    // auth links before the account check settles (#201).
    window.localStorage.setItem(TOKEN_KEY, "test-token");
    const html = renderToString(<HomeHeader />);
    expect(html).not.toContain('href="/login"');
    expect(html).not.toContain('href="/signup"');
    expect(html).not.toContain('href="/dashboard"');
  });
});
