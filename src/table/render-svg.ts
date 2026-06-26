// Pure SVG renderer for the table BODY (header tiers + group/data rows). The title/source/logo
// chrome is composed separately by the PNG export (Task 12); this produces only the gridded
// table content so the same geometry (from `layoutTable`) backs both the HTML and PNG paths.
//
// Fully deterministic: no Date/random, attributes set in a fixed order. Takes the target
// `document` via opts so it works under jsdom (tests) and in the browser (export).
import type { TableModel } from "./model";
import type { TableLayout, CellRect } from "./layout";
import { INDENT_STEP, FOOTNOTE_TOP_GAP, FOOTNOTE_LINE_HEIGHT } from "./layout";
import { TBL } from "../engine/theme";
import { tokens } from "../theme/tokens";

const SVG_NS = "http://www.w3.org/2000/svg";

// Type sizes mirror layout.ts so text fits the rects it computed.
const HEADER_FONT = TBL.size.legend; // 12
const BODY_FONT = TBL.size.legend; // 12
const SUBLABEL_FONT = TBL.size.annotation; // 11
const NOTE_FONT = TBL.size.annotation; // 11
const TIER_HEIGHT = 24; // matches layout.tierHeight
const PAD_X = 8; // half of layout.padX — inset from a cell edge
const FOOTNOTE_DY = -4; // superscript rise

// Sign coloring (no dedicated structural token; use brand green/red categorical bases).
const SIGN_POS = tokens.categorical[3]!.base; // green
const SIGN_NEG = tokens.categorical[4]!.base; // red

export function renderTableSvg(
  model: TableModel,
  layout: TableLayout,
  opts: { document: Document },
): SVGSVGElement {
  const doc = opts.document;

  const el = (name: string, attrs: Record<string, string | number> = {}): SVGElement => {
    const node = doc.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
  };
  const text = (
    x: number,
    y: number,
    str: string,
    o: { anchor: string; weight: number; fill: string; size: number; cls?: string; italic?: boolean },
  ): SVGElement => {
    const attrs: Record<string, string | number> = {
      x,
      y,
      "text-anchor": o.anchor,
      "font-family": TBL.font,
      "font-size": o.size,
      "font-weight": o.weight,
      fill: o.fill,
    };
    if (o.italic) attrs["font-style"] = "italic";
    if (o.cls) attrs.class = o.cls;
    const t = el("text", attrs);
    t.textContent = str;
    return t;
  };
  const line = (x1: number, y1: number, x2: number, y2: number): SVGElement =>
    el("line", { x1, y1, x2, y2, stroke: TBL.color.axisStroke, "stroke-width": 1 });
  // Hairline rule in the lighter border tone, used for the inline flanking rules on banner cells.
  const spannerLine = (x1: number, y1: number, x2: number, y2: number): SVGElement =>
    el("line", { x1, y1, x2, y2, stroke: TBL.color.border, "stroke-width": 1 });

  const svg = el("svg", {
    xmlns: SVG_NS,
    width: layout.totalWidth,
    height: layout.totalHeight,
    viewBox: `0 0 ${layout.totalWidth} ${layout.totalHeight}`,
  }) as SVGSVGElement;

  // ---- Header ----
  const headerG = el("g", { class: "tbl-table-header" });
  for (const tier of layout.header) {
    for (const { cell, rect } of tier) {
      // Subtle bg rect behind each header cell (also the rowspan-detection hook for tests).
      headerG.appendChild(
        el("rect", {
          class: "tbl-table-header-bg",
          x: rect.x,
          y: rect.y,
          width: rect.w,
          height: rect.h,
          fill: "none",
        }),
      );
      const cx = rect.x + rect.w / 2;
      const isLeaf = cell.leafKey != null;
      const leaf = isLeaf ? model.leaves.find((l) => l.key === cell.leafKey) : undefined;
      // A leaf cell with a sublabel reserves a line below the label for it.
      const labelY = rect.y + rect.h / 2 + HEADER_FONT / 3 - (leaf?.sublabel != null ? 7 : 0);
      headerG.appendChild(
        text(cx, labelY, cell.text, {
          anchor: "middle",
          weight: 700,
          fill: TBL.color.heading,
          size: HEADER_FONT,
        }),
      );
      // Banner cells (colSpan > 1) get horizontal rules flanking the centered label, extending
      // to the cell's edges, to show the columns they govern.
      if (cell.colSpan > 1) {
        const ruleY = rect.y + rect.h / 2;
        const halfText = (measureish(cell.text) / 2) + PAD_X;
        headerG.appendChild(spannerLine(rect.x + PAD_X, ruleY, cx - halfText, ruleY));
        headerG.appendChild(spannerLine(cx + halfText, ruleY, rect.x + rect.w - PAD_X, ruleY));
      }
      if (leaf?.sublabel != null) {
        headerG.appendChild(
          text(cx, labelY + SUBLABEL_FONT + 1, leaf.sublabel, {
            anchor: "middle",
            weight: 400,
            fill: TBL.color.muted,
            size: SUBLABEL_FONT,
            cls: "tbl-table-sublabel",
          }),
        );
      }
    }
  }
  // Tier separators: a thin line at the bottom of each banner tier (T-1 of them) and one
  // heavier line under the whole header.
  const tiers = model.headerRows.length;
  for (let t = 1; t < tiers; t++) {
    headerG.appendChild(line(0, t * TIER_HEIGHT, layout.totalWidth, t * TIER_HEIGHT));
  }
  headerG.appendChild(line(0, layout.headerHeight, layout.totalWidth, layout.headerHeight));
  svg.appendChild(headerG);

  // ---- Body ----
  const bodyG = el("g", { class: "tbl-table-body" });
  for (const entry of layout.rows) {
    if ("group" in entry) {
      const { group, rect } = entry;
      const g = el("g", { class: "tbl-table-group" });
      const baseY = rect.y + BODY_FONT + 4;
      const x = PAD_X + group.level * INDENT_STEP;
      g.appendChild(
        text(x, baseY, group.label, {
          anchor: "start",
          weight: 700,
          fill: TBL.color.heading,
          size: BODY_FONT,
        }),
      );
      if (group.note != null) {
        g.appendChild(
          text(x + measureish(group.label) + 8, baseY, group.note, {
            anchor: "start",
            weight: 400,
            fill: TBL.color.muted,
            size: NOTE_FONT,
            italic: true,
          }),
        );
      }
      // Separator under the group heading.
      g.appendChild(line(0, rect.y + rect.h, layout.totalWidth, rect.y + rect.h));
      bodyG.appendChild(g);
      continue;
    }

    const { row, rect, cellRects } = entry;
    const rg = el("g", { class: "tbl-table-row" });
    const baseY = rect.y + rect.h / 2 + BODY_FONT / 3;

    // Stub label, left-aligned, indented by level.
    rg.appendChild(
      text(PAD_X + row.level * INDENT_STEP, baseY, row.label, {
        anchor: "start",
        weight: row.cells.some((c) => c.emphasis) ? 700 : 400,
        fill: TBL.color.text,
        size: BODY_FONT,
      }),
    );

    // One cell <text> per leaf, centered in the cell rect.
    row.cells.forEach((cell, i) => {
      const cr = cellRects[i] as CellRect;
      const cg = el("g", { class: "tbl-table-cell" });
      if (cell.emphasis) {
        cg.appendChild(
          el("rect", {
            class: "tbl-table-cell-emph",
            x: cr.x,
            y: cr.y,
            width: cr.w,
            height: cr.h,
            fill: TBL.color.bgSubtle,
          }),
        );
      }
      const fill =
        cell.signClass === "pos" ? SIGN_POS : cell.signClass === "neg" ? SIGN_NEG : TBL.color.text;
      const t = text(cr.x + cr.w / 2, baseY, cell.text, {
        anchor: "middle",
        weight: cell.emphasis ? 700 : 400,
        fill,
        size: BODY_FONT,
      });
      if (cell.footnote != null) {
        const sup = el("tspan", { "baseline-shift": "super", "font-size": SUBLABEL_FONT, dy: FOOTNOTE_DY });
        sup.textContent = cell.footnote;
        t.appendChild(sup);
      }
      cg.appendChild(t);
      rg.appendChild(cg);
    });

    // Thin row separator.
    rg.appendChild(line(0, rect.y + rect.h, layout.totalWidth, rect.y + rect.h));
    bodyG.appendChild(rg);
  }
  svg.appendChild(bodyG);

  // ---- Footnotes (listed below the table body, per spec §8) ----
  if (model.footnotes.length > 0) {
    const bodyBottom = layout.headerHeight + layout.rows.length * layout.rowHeight;
    const fg = el("g", { class: "tbl-table-footnotes" });
    model.footnotes.forEach((fn, i) => {
      const y = bodyBottom + FOOTNOTE_TOP_GAP + i * FOOTNOTE_LINE_HEIGHT + NOTE_FONT;
      const t = text(PAD_X, y, `${fn.marker} ${fn.text}`, {
        anchor: "start",
        weight: 400,
        fill: TBL.color.muted,
        size: NOTE_FONT,
      });
      fg.appendChild(t);
    });
    svg.appendChild(fg);
  }

  return svg;
}

// Deterministic rough text width for placing a group note after its label (no canvas needed;
// matches the test's measureText heuristic of ~7px/char).
function measureish(s: string): number {
  return s.length * 7;
}
