// Shared d3-symbol path generation for point markers, used by the chart marks (line.ts via
// Plot's symbol scale), the legend swatches (legend.ts), the coordinated-cursor hover dots
// (crosshair.ts), and the PNG export legend (export-png.ts). One place maps the symbol NAMES
// (see MARKER_SYMBOLS in theme.ts) to d3 symbol types.
import { d3 } from "./vendor";

const SYMBOL_TYPES: Record<string, unknown> = {
  circle: d3.symbolCircle,
  square: d3.symbolSquare,
  triangle: d3.symbolTriangle,
  diamond: d3.symbolDiamond,
  star: d3.symbolStar,
  wye: d3.symbolWye,
  cross: d3.symbolCross,
};

/** The SVG path `d` for a d3 symbol of the given name, centered at (0,0). `size` is the area
 *  in px² (d3 symbol convention). Unknown names fall back to a circle. */
export function symbolPathD(name: string, size: number): string {
  const type = SYMBOL_TYPES[name] ?? d3.symbolCircle;
  return d3.symbol().type(type as never).size(size)() ?? "";
}
