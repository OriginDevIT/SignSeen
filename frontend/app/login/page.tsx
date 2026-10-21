"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "../../lib/api";
import GoogleSignIn from "../../components/GoogleSignIn";

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

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(email.trim(), password);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setBusy(false);
    }
  };

  return (
    <main style={card}>
      <h1 style={{ margin: 0 }}>Log in</h1>
      <p style={{ opacity: 0.6, margin: 0 }}>
        Accounts are for senders who keep a document library. Signers never
        need one.
      </p>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={input}
        />
        <input
          type="password"
          required
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={input}
        />
        {error && <p style={{ color: "#b91c1c", margin: 0 }}>{error}</p>}
        <button type="submit" disabled={busy} style={button}>
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
      <GoogleSignIn onError={setError} />
      <p style={{ fontSize: "0.9rem", opacity: 0.7, margin: 0 }}>
        <a href="/reset-password">Forgot your password?</a>
        {" · "}
        <a href="/signup">Create an account</a>
      </p>
    </main>
  );
}
