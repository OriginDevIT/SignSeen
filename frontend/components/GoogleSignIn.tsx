"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loginWithGoogle } from "../lib/api";

/** Google Identity Services, loaded from Google's CDN at runtime.
 * Minimal surface: just what initialize/renderButton need. */
interface GoogleIdentity {
  accounts: {
    id: {
      initialize: (config: {
        client_id: string;
        callback: (response: { credential?: string }) => void;
      }) => void;
      renderButton: (parent: HTMLElement, options: Record<string, string>) => void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const SCRIPT_SRC = "https://accounts.google.com/gsi/client";

/**
 * "Sign in with Google" button for the login/signup pages.
 *
 * Renders nothing when NEXT_PUBLIC_GOOGLE_CLIENT_ID is unset (password
 * flow untouched) or when the Google script fails to load — the
 * integration must never break the password form.
 */
export default function GoogleSignIn({
  onError,
}: {
  onError?: (message: string) => void;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!CLIENT_ID || startedRef.current) return;
    startedRef.current = true;

    const init = () => {
      const google = window.google;
      const container = containerRef.current;
      if (!google || !container) {
        setFailed(true);
        return;
      }
      google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: (response) => {
          if (!response.credential) {
            onError?.("Google sign-in was cancelled.");
            return;
          }
          loginWithGoogle(response.credential)
            .then(() => router.push("/dashboard"))
            .catch((err) =>
              onError?.(
                err instanceof Error ? err.message : "Google sign-in failed"
              )
            );
        },
      });
      google.accounts.id.renderButton(container, {
        theme: "outline",
        size: "large",
        width: "320",
        text: "continue_with",
      });
    };

    if (window.google) {
      init();
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = init;
    script.onerror = () => setFailed(true);
    document.head.appendChild(script);
    // The script element stays in <head> for the page's lifetime; pages
    // are short-lived auth screens and duplicate loads are idempotent
    // for the GIS client.
  }, [router, onError]);

  if (!CLIENT_ID || failed) return null;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          margin: "0.25rem 0 0.75rem",
          opacity: 0.55,
          fontSize: "0.85rem",
        }}
      >
        <span style={{ flex: 1, borderTop: "1px solid #ddd" }} />
        or
        <span style={{ flex: 1, borderTop: "1px solid #ddd" }} />
      </div>
      <div
        ref={containerRef}
        style={{ display: "flex", justifyContent: "center", minHeight: 44 }}
      />
    </div>
  );
}
