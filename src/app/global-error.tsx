"use client";

import { useEffect } from "react";

// Catches errors thrown in the root layout itself. It must render its own
// <html>/<body> because it replaces the whole document when it fires.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0a0a0f",
          color: "#fafafa",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: "1.5rem",
        }}
      >
        <div style={{ maxWidth: "28rem" }}>
          <h1 style={{ fontSize: "1.875rem", fontWeight: 700 }}>
            Something went wrong
          </h1>
          <p style={{ marginTop: "1rem", color: "#a1a1aa" }}>
            An unexpected error occurred. Please try again.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: "2rem",
              borderRadius: "9999px",
              border: "none",
              backgroundColor: "#22d3ee",
              color: "#0a0a0f",
              padding: "0.75rem 2rem",
              fontSize: "1rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
