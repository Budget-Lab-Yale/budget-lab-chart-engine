// Shared text-measurement helper for the table layout pipeline. Used by the live mount
// (mount.ts) and the PNG export (export-table-png.ts) so both measure identically.

/**
 * Build a canvas `measureText` function that uses a cached 2D context when available
 * (real browsers) and falls back to a character-count estimate when canvas/context is
 * absent (jsdom, SSR). The fallback is `s.length * fontPx * 0.6`.
 */
export function makeMeasureText(): (s: string, fontPx: number, weight: number) => number {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    const canvas = document.createElement("canvas");
    ctx = canvas.getContext("2d");
  } catch {
    // Ignore — canvas unavailable (jsdom default config).
  }
  return (s: string, fontPx: number, weight: number): number => {
    if (ctx) {
      try {
        ctx.font = `${weight} ${fontPx}px Figtree, sans-serif`;
        return ctx.measureText(s).width;
      } catch {
        // Fall through to estimate if measureText somehow fails.
      }
    }
    return s.length * fontPx * 0.6;
  };
}
