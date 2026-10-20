"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signup } from "../../lib/api";

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

export default function SignupPage() {
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
      await signup(email.trim(), password);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
      setBusy(false);
    }
  };

  return (
    <main style={card}>
      <h1 style={{ margin: 0 }}>Create an account</h1>
      <p style={{ opacity: 0.6, margin: 0 }}>
        Keep a library of your documents with their status. Same free limits
        (one document pending at a time, 100 MB storage); premium removes the
        watermark and raises the limits.
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
          minLength={10}
          placeholder="Password (10+ characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={input}
        />
        {error && <p style={{ color: "#b91c1c", margin: 0 }}>{error}</p>}
        <button type="submit" disabled={busy} style={button}>
          {busy ? "Creating…" : "Create account"}
        </button>
      </form>
      <p style={{ fontSize: "0.9rem", opacity: 0.7, margin: 0 }}>
        Already have one? <a href="/login">Log in</a>
      </p>
    </main>
  );
}
