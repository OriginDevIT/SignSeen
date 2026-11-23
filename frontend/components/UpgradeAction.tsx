"use client";

import type { ReactNode } from "react";

// The upgrade call-to-action inside a premium notice: a logged-in user
// starts checkout (through the caller's handler); an anonymous visitor
// goes to account creation. Renders as an inline link in both cases.
export default function UpgradeAction({
  loggedIn,
  onUpgrade,
  children,
}: {
  loggedIn: boolean;
  onUpgrade: () => void;
  children: ReactNode;
}) {
  const style = {
    background: "none",
    border: "none",
    padding: 0,
    margin: 0,
    font: "inherit",
    color: "inherit",
    textDecoration: "underline",
    cursor: "pointer",
  } as const;
  if (!loggedIn) {
    return (
      <a href="/signup" style={style}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onUpgrade} style={style}>
      {children}
    </button>
  );
}
