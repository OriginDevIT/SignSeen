"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signup, startCheckout } from "../../lib/api";
import HomeHeader from "../../components/HomeHeader";
import GoogleSignIn from "../../components/GoogleSignIn";
import PasswordInput from "../../components/PasswordInput";

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
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Free is the default; annual is the default premium plan.
  const [plan, setPlan] = useState<"free" | "monthly" | "annual">("free");

  // Arriving from a signing done screen ("Create a free account" after
  // leaving an email at completion): pre-fill that email so the new
  // account matches the signer's archive.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("email");
    if (param) setEmail(param);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await signup(email.trim(), password, name);
      if (plan === "free") {
        router.push("/dashboard");
        return;
      }
      // Premium: the account now exists, so the authenticated
      // checkout endpoint can start a Stripe session for it. If
      // checkout fails here the account stays free and the sender
      // can upgrade later from the dashboard.
      try {
        window.location.href = await startCheckout(plan);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Checkout failed");
        setBusy(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
      setBusy(false);
    }
  };

  return (
    <main style={card}>
      <HomeHeader />
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
          type="text"
          placeholder="Name (optional)"
          autoComplete="name"
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={input}
        />
        <PasswordInput
          required
          minLength={10}
          placeholder="Password (10+ characters)"
          value={password}
          onChange={setPassword}
          style={input}
        />
        {error && <p style={{ color: "#b91c1c", margin: 0 }}>{error}</p>}
        <fieldset
          style={{
            border: "1px solid #ccc",
            borderRadius: "0.375rem",
            padding: "0.7rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
          }}
        >
          <legend style={{ padding: "0 0.3rem", fontWeight: 600 }}>
            Choose a plan
          </legend>
          <label style={{ display: "flex", gap: "0.5rem", cursor: "pointer" }}>
            <input
              type="radio"
              name="plan"
              checked={plan === "free"}
              onChange={() => setPlan("free")}
            />
            Free - no monthly limit, one document pending at a time, 100 MB
            storage
          </label>
          <label style={{ display: "flex", gap: "0.5rem", cursor: "pointer" }}>
            <input
              type="radio"
              name="plan"
              checked={plan === "annual"}
              onChange={() => setPlan("annual")}
            />
            Premium - $50/yr - no watermark, higher limits, more signers
          </label>
          <label style={{ display: "flex", gap: "0.5rem", cursor: "pointer" }}>
            <input
              type="radio"
              name="plan"
              checked={plan === "monthly"}
              onChange={() => setPlan("monthly")}
            />
            Premium - $5/mo - no watermark, higher limits, more signers
          </label>
        </fieldset>
        <button type="submit" disabled={busy} style={button}>
          {busy
            ? "Creating…"
            : plan === "free"
              ? "Create account"
              : "Create account and continue to payment"}
        </button>
      </form>
      <p style={{ fontSize: "0.85rem", opacity: 0.65, marginTop: "1rem" }}>
        By creating an account you agree to the{" "}
        <a href="/terms">Terms of Service</a> and{" "}
        <a href="/privacy">Privacy Policy</a>.
      </p>
      <GoogleSignIn onError={setError} />
      <p style={{ fontSize: "0.9rem", opacity: 0.7, margin: 0 }}>
        Already have one? <a href="/login">Log in</a>
      </p>
    </main>
  );
}
