/** Shared brand header for the auth pages (#89): the SignSeen
 * wordmark linking home, the same on login, signup, and
 * reset-password. No tagline in the header. */
export default function AuthBrandHeader() {
  return (
    <header style={{ textAlign: "center", marginBottom: "0.5rem" }}>
      <a
        href="/"
        style={{
          fontWeight: 800,
          fontSize: "1.5rem",
          color: "#111827",
          textDecoration: "none",
        }}
      >
        SignSeen
      </a>
    </header>
  );
}
