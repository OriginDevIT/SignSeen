"use client";

import { useEffect, useState } from "react";
import { myAccount, updateAccountName } from "../../lib/api";
import HomeHeader from "../../components/HomeHeader";

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

const label: React.CSSProperties = {
  fontSize: "0.9rem",
  fontWeight: 600,
  marginBottom: "-0.4rem",
};

export default function ProfilePage() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    myAccount()
      .then((account) => {
        setEmail(account.email);
        setName(account.name ?? "");
      })
      .catch(() => {
        setError("Log in to view your account.");
      })
      .finally(() => setLoading(false));
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaved(false);
    setBusy(true);
    try {
      const account = await updateAccountName(name.trim());
      setName(account.name ?? "");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your name");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={card}>
      <HomeHeader />
      <h1 style={{ margin: 0 }}>Account</h1>
      {loading ? (
        <p style={{ opacity: 0.6, margin: 0 }}>Loading…</p>
      ) : error && !email ? (
        <p style={{ margin: 0 }}>
          {error} <a href="/login">Log in</a>
        </p>
      ) : (
        <form
          onSubmit={save}
          style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}
        >
          <p style={{ opacity: 0.6, margin: 0 }}>{email}</p>
          <label htmlFor="profile-name" style={label}>
            Name
          </label>
          <input
            id="profile-name"
            type="text"
            placeholder="Your name"
            autoComplete="name"
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={input}
          />
          <p style={{ opacity: 0.6, margin: 0, fontSize: "0.9rem" }}>
            Your name is shown as the sender where you sign a document
            yourself.
          </p>
          {error && <p style={{ color: "#b91c1c", margin: 0 }}>{error}</p>}
          {saved && (
            <p style={{ color: "#15803d", margin: 0 }}>Name saved.</p>
          )}
          <button type="submit" disabled={busy} style={button}>
            {busy ? "Saving…" : "Save name"}
          </button>
        </form>
      )}
      <p style={{ fontSize: "0.9rem", opacity: 0.7, margin: 0 }}>
        <a href="/dashboard">Back to dashboard</a>
      </p>
    </main>
  );
}
