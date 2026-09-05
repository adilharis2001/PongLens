/**
 * A capture-only branded cut while a shipping media surface signs/decodes.
 * The product is left untouched; this cover only prevents its transient
 * Loading preview/clip placeholders from becoming tutorial footage.
 */
export const CAPTURE_TRANSITION_DELAY_MS = 300;

/** Leave a small encoded-frame margin after the preceding narration ends. */
export async function waitBeforeCaptureTransition(clock) {
  await clock.sleep(CAPTURE_TRANSITION_DELAY_MS);
}

export async function showCaptureTransition(page) {
  await page.evaluate(() => {
    document.getElementById("tutorial-capture-transition")?.remove();
    const cover = document.createElement("div");
    cover.id = "tutorial-capture-transition";
    Object.assign(cover.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "18px",
      background:
        "radial-gradient(circle at 35% 30%, rgba(34,211,238,.13), transparent 38%), radial-gradient(circle at 75% 70%, rgba(217,70,239,.10), transparent 36%), #07090f",
      color: "#f4f4f5",
      fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
    });
    const ring = document.createElement("div");
    Object.assign(ring.style, {
      width: "54px",
      height: "54px",
      border: "4px solid #22d3ee",
      borderRightColor: "transparent",
      borderRadius: "9999px",
      transform: "rotate(-28deg)",
      boxShadow: "0 0 28px rgba(34,211,238,.18)",
    });
    const brand = document.createElement("div");
    brand.textContent = "PongLens";
    Object.assign(brand.style, {
      fontSize: "28px",
      fontWeight: "750",
      letterSpacing: "-.02em",
    });
    cover.append(ring, brand);
    document.body.append(cover);
  });
}

export async function hideCaptureTransition(page) {
  await page.evaluate(() => {
    document.getElementById("tutorial-capture-transition")?.remove();
  });
}
