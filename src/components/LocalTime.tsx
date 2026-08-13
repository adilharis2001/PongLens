"use client";

import { useEffect, useState } from "react";

/**
 * A timestamp in the reader's own timezone.
 *
 * `toLocaleString()` called during render is a hydration mismatch waiting to
 * happen: the server formats in its timezone, which on Vercel is UTC and on
 * a laptop is not, and the client formats in the reader's. Rendering nothing
 * until after mount makes both first passes agree, and the reader still ends
 * up with their own clock rather than the server's.
 */
export function LocalTime({
  iso,
  mode = "datetime",
}: {
  iso: string;
  mode?: "date" | "datetime";
}) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    const date = new Date(iso);
    setText(mode === "date" ? date.toLocaleDateString() : date.toLocaleString());
  }, [iso, mode]);

  return <>{text ?? ""}</>;
}
