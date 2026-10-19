import { ceremonyTagline } from "../lib/ceremony";

export default function Home() {
  return (
    <main
      style={{
        alignItems: "center",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        minHeight: "100vh",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: "3rem", marginBottom: "0.5rem" }}>SignSeen</h1>
      <p style={{ fontSize: "1.25rem", opacity: 0.75 }}>{ceremonyTagline()}</p>
      <p style={{ maxWidth: "36rem", opacity: 0.6 }}>
        Open-source electronic signature with a photographic witness. Scan a
        QR code, sign on your phone, snap a photo.
      </p>
      <p style={{ fontSize: "0.875rem", opacity: 0.5 }}>
        Early prototype — Phase 0 scaffold. Expect rough edges.
      </p>
    </main>
  );
}
