"use client";

import { useState } from "react";
import { getAuthToken } from "../lib/api";

/** Landing-page header (#89): Log in / Create account for visitors,
 * Dashboard for a signed-in sender. The stored token decides the
 * first render (no flash of the wrong links); a stale token just
 * lands on the login redirect from the dashboard. */
export default function HomeHeader() {
  const [signedIn] = useState(
    () => typeof window !== "undefined" && getAuthToken() !== null
  );

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
