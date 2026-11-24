"use client";

import { useEffect, useState } from "react";
import { getAuthToken } from "../lib/api";

/** Landing-page header (#89): Log in / Create account for visitors,
 * Dashboard for a signed-in sender. The token is read after mount
 * only: reading it during render makes the server render the logged-out
 * links while the client renders Dashboard, which fails hydration
 * (#91). The first render always shows the logged-out links; a
 * signed-in sender sees Dashboard appear after mount.
 *
 * Shared site navigation (#163): the Home and Send a document links
 * render on every page that uses this header, so the verify page and
 * any later page get the same navigation from this one component. */
export default function HomeHeader() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    setSignedIn(getAuthToken() !== null);
  }, []);

  return (
    <header
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "1rem",
        padding: "1rem 0 0",
      }}
    >
      <a
        href="/"
        style={{
          fontWeight: 800,
          fontSize: "1.25rem",
          color: "#111827",
          textDecoration: "none",
        }}
      >
        SignSeen
      </a>
      <nav style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
        <a href="/" style={{ color: "#111827" }}>
          Home
        </a>
        <a href="/send" style={{ color: "#111827" }}>
          Send a document
        </a>
        {signedIn ? (
          <a href="/dashboard" style={{ color: "#111827", fontWeight: 600 }}>
            Dashboard
          </a>
        ) : (
          <>
            <a href="/login" style={{ color: "#111827" }}>
              Log in
            </a>
            <a href="/signup" style={{ color: "#111827", fontWeight: 600 }}>
              Create account
            </a>
          </>
        )}
      </nav>
    </header>
  );
}
