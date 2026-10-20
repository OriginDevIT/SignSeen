"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { confirmPasswordReset, requestPasswordReset } from "../../lib/api";

const card: React.CSSProperties = {
  maxWidth: "24rem",
  margin: "4rem auto",
  padding: "2rem",
  display: "flex",
  flexDirection: "column",
  gap: "0.9rem",
};

const input: React.CSSProperties = {
  padding: "0.7rem",
  fontSize: "1rem",
  border: "1px solid #ccc",
  borderRadius: "0.375rem",
  width: "100%",
  boxSizing: "border-box",
};

const button: React.CSSProperties = {
  padding: "0.8rem",
  fontSize: "1.05rem",
  border: "none",
  borderRadius: "0.375rem",
  background: "#2563eb",
  color: "#fff",
  cursor: "pointer",
};

export default function ResetPasswordPage() {
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setUid(q.get("uid"));
    setToken(q.get("token"));
  }, []);

  const request = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await confirmPasswordReset(uid ?? "", token ?? "", password);
      router.push("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
      setBusy(false);
    }
  };

  return (
    <main style={card}>
      <h1 style={{ margin: 0 }}>Reset password</h1>
      {uid && token ? (
        <form onSubmit={confirm} style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
          <input
            type="password"
            required
            minLength={10}
            placeholder="New password (10+ characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={input}
          />
          {error && <p style={{ color: "#b91c1c", margin: 0 }}>{error}</p>}
          <button type="submit" disabled={busy} style={button}>
            {busy ? "Saving…" : "Set new password"}
          </button>
        </form>
      ) : sent ? (
        <p style={{ opacity: 0.7 }}>
          If an account exists for that email, a reset link is on its way.
        </p>
      ) : (
        <form onSubmit={request} style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={input}
          />
          {error && <p style={{ color: "#b91c1c", margin: 0 }}>{error}</p>}
          <button type="submit" disabled={busy} style={button}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
    </main>
  );
}
