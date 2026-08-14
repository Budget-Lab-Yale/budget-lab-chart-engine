// What a marker is PAINTED with — shared by the marks that draw a chart and the icons that key it.
//
// Geometry cannot be shared between the two. A dumbbell dot is r=5 beside a 14px key box, a net dot
// shrinks in a small-multiples pane, and a marker on a key's 14px rule has to leave the rule visible
// in a way nothing on the chart does. Those are three different sizes of the same idea, and each is
// bound to its own context.
//
// The INK can be shared, and it is the half that kept drifting. Two marker styles are both "a coloured
// ring around a middle", and ONLY the middle tells them apart:
//
//   hollow — the middle is a HOLE. A dumbbell's hollow end shows the connector stem through it, and
//            takes the card, the tooltip's blur or a tinted page as its ground.
//   net    — the middle is an opaque WHITE DISC, by design: the stacked net marker sits ON its stack
//            and has to occlude it, so white is the mark's own ink and not an assumption about what
//            is behind it.
//
// Spelled out separately in `marks/dumbbell.ts`, `marks/stacked.ts` and `icon.ts`, they drifted the
// moment any one of them changed: making the dumbbell's hole a real hole silently turned the stacked
// Total's key into a hole too, so the key showed a ring where the chart drew a white disc.
import { tokens } from "../theme/tokens";

/** How a marker's middle relates to its series colour. */
export type MarkerStyle =
  /** The series colour fills it. */
  | "filled"
  /** The series colour outlines it and the middle is a hole. */
  | "hollow"
  /** Filled with the neutral ink token, whatever the series colour is. */
  | "ink"
  /** A white disc under a black ring — the stacked net marker, which must occlude its stack. */
  | "net";

/** A hole. Not "unset" and not "white": the middle is genuinely absent and shows what is behind it. */
export const HOLE = "none";

/** The thin separator between a filled marker and whatever it overlaps — a line it sits on, a stem
 *  running behind it, a neighbouring dot. */
export const MARKER_KEYLINE_COLOR = tokens.structural.background;

export interface MarkerInk {
  /** What fills the middle: a colour, or `HOLE`. */
  fill: string;
  /** What outlines it. */
  stroke: string;
}

/** The ink for one marker style. The ONE description of it — a caller supplies only the geometry. */
export function markerInk(style: MarkerStyle, color: string): MarkerInk {
  switch (style) {
    case "hollow":
      return { fill: HOLE, stroke: color };
    case "ink":
      return { fill: tokens.structural.text_heading, stroke: MARKER_KEYLINE_COLOR };
    case "net":
      return { fill: tokens.structural.background, stroke: tokens.structural.mark_black };
    case "filled":
      return { fill: color, stroke: MARKER_KEYLINE_COLOR };
  }
}
