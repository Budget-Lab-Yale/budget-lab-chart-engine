// Pure SVG renderer for the table BODY (header tiers + group/data rows). The title/source/logo
// chrome is composed separately by the PNG export (Task 12); this produces only the gridded
// table content so the same geometry (from `layoutTable`) backs both the HTML and PNG paths.
//
// All wrapping (leaf-header lines, group notes) and all heights come from `layoutTable`; this
// module only draws what the layout measured, so the two cannot disagree.
//
// Fully deterministic: no Date/random, attributes set in a fixed order. Takes the target
// `document` via opts so it works under jsdom (tests) and in the browser (export).
import type { TableModel } from "./model";
import type { TableLayout, CellRect } from "./layout";
import {
  INDENT_STEP,
  FOOTNOTE_TOP_GAP,
  FOOTNOTE_LINE_HEIGHT,
  HEADER_LINE_HEIGHT,
  SUBLABEL_LINE,
  GROUP_NOTE_GAP,
  GROUP_NOTE_LINE_HEIGHT,
  STUB_LINE_HEIGHT,
} from "./layout";
import type { TableSpec } from "../spec/table-types";
import { TBL } from "../engine/theme";
import { tokens } from "../theme/tokens";

const SVG_NS = "http://www.w3.org/2000/svg";

// Type sizes mirror layout.ts so text fits the rects it computed.
const HEADER_FONT = TBL.size.legend; // 12
const BODY_FONT = 13; // matches layout bodyFontPx + HTML td/th
const SUBLABEL_FONT = TBL.size.annotation; // 11
const NOTE_FONT = TBL.size.annotation; // 11
const PAD_X = 8; // half of layout.padX — inset from a cell edge
const FOOTNOTE_DY = -4; // superscript rise
const LEAF_BOTTOM_PAD = 7; // gap from the leaf label's last line down to the sublabel / header rule
const SUBLABEL_BOTTOM_PAD = 6; // gap from the sublabel baseline to the header→body rule

// Sign coloring (no dedicated structural token; use brand green/red categorical bases).
const SIGN_POS = tokens.categorical[3]!.base; // green
const SIGN_NEG = tokens.categorical[4]!.base; // red

export function renderTableSvg(
  model: TableModel,
  layout: TableLayout,
  opts: { document: Document; spec?: TableSpec },
): SVGSVGElement {
  const doc = opts.document;
  const spec = opts.spec;
  const headerTierRules = spec?.header_tier_rules === true; // default: no inter-tier rules
  const spannerRules = spec?.spanner_rules !== false; // default: draw flanking rules

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
  // Rule helpers — three weights mirroring the HTML (border-collapse) hierarchy:
  //   strong (#999) header→body separator; group (#E5E5E5) divider above a row group;
  //   row    (#F0F0F0) the light gridline between data rows.
  const rule = (x1: number, y1: number, x2: number, y2: number, stroke: string): SVGElement =>
    el("line", { x1, y1, x2, y2, stroke, "stroke-width": 1 });
  const ruleStrong = (x1: number, y1: number, x2: number, y2: number) =>
    rule(x1, y1, x2, y2, TBL.color.axisStroke);
  const ruleGroup = (x1: number, y1: number, x2: number, y2: number) =>
    rule(x1, y1, x2, y2, TBL.color.border);
  const ruleRow = (x1: number, y1: number, x2: number, y2: number) =>
    rule(x1, y1, x2, y2, TBL.color.gridline);
  // Hairline rule in the lighter border tone, used for the inline flanking rules on banner cells.
  const spannerLine = (x1: number, y1: number, x2: number, y2: number): SVGElement =>
    rule(x1, y1, x2, y2, TBL.color.border);

  const svg = el("svg", {
    xmlns: SVG_NS,
    width: layout.totalWidth,
    height: layout.totalHeight,
    viewBox: `0 0 ${layout.totalWidth} ${layout.totalHeight}`,
  }) as SVGSVGElement;

  // Stub wrapping / clipping. A non-wrapping stub is normally sized to fit its longest label, so it
  // only needs clipping when a fixed stub_width is set narrower than a label — clip to the column.
  const stubWrap = spec?.stub_wrap === true && spec?.stub_nowrap !== true;
  const clipStub = !stubWrap && spec?.stub_width != null;
  if (clipStub) {
    const defs = el("defs");
    const cp = el("clipPath", { id: "tbl-stub-clip" });
    cp.appendChild(el("rect", { x: 0, y: 0, width: layout.stubWidth, height: layout.totalHeight }));
    defs.appendChild(cp);
    svg.appendChild(defs);
  }

  // ---- Header ----
  const headerG = el("g", { class: "tbl-table-header" });
  const hasSublabel = model.leaves.some((l) => l.sublabel != null);
  // All leaf labels share one bottom baseline (HTML vertical-align:bottom), so multi-line labels
  // grow upward into the taller leaf tier without disturbing the row of column labels.
  const leafLabelBottom = layout.headerHeight - (hasSublabel ? SUBLABEL_LINE : 0) - LEAF_BOTTOM_PAD;
  const sublabelBaseline = layout.headerHeight - SUBLABEL_BOTTOM_PAD;

  for (const tier of layout.header) {
    for (const entry of tier) {
      const { cell, rect } = entry;
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

      if (isLeaf) {
        // Leaf label, bottom-aligned. Over a text column it left-aligns to match the cells;
        // otherwise it is centered.
        const leaf = model.leaves.find((l) => l.key === cell.leafKey);
        const isTextCol = leaf?.isText === true;
        const hx = isTextCol ? rect.x + PAD_X : cx;
        const anchor = isTextCol ? "start" : "middle";
        const lines = entry.lines ?? [cell.text];
        if (lines.length > 1) {
          const t = el("text", {
            x: hx,
            y: leafLabelBottom - (lines.length - 1) * HEADER_LINE_HEIGHT,
            "text-anchor": anchor,
            "font-family": TBL.font,
            "font-size": HEADER_FONT,
            "font-weight": 700,
            fill: TBL.color.heading,
          });
          lines.forEach((ln, li) => {
            const ts = el("tspan", { x: hx, dy: li === 0 ? 0 : HEADER_LINE_HEIGHT });
            ts.textContent = ln;
            t.appendChild(ts);
          });
          headerG.appendChild(t);
        } else {
          headerG.appendChild(
            text(hx, leafLabelBottom, lines[0] ?? "", {
              anchor,
              weight: 700,
              fill: TBL.color.heading,
              size: HEADER_FONT,
            }),
          );
        }
        if (leaf?.sublabel != null) {
          headerG.appendChild(
            text(hx, sublabelBaseline, leaf.sublabel, {
              anchor,
              weight: 400,
              fill: TBL.color.muted,
              size: SUBLABEL_FONT,
              cls: "tbl-table-sublabel",
            }),
          );
        }
      } else {
        // Banner / upper-tier cell: vertically centered in its rect.
        const by = rect.y + rect.h / 2 + HEADER_FONT / 3;
        headerG.appendChild(
          text(cx, by, cell.text, {
            anchor: "middle",
            weight: 700,
            fill: TBL.color.heading,
            size: HEADER_FONT,
          }),
        );
        // Banner cells (colSpan > 1) get horizontal rules flanking the centered label, extending
        // to the cell's edges, to show the columns they govern. Disabled when spanner_rules:false.
        if (cell.colSpan > 1 && spannerRules) {
          const ruleY = rect.y + rect.h / 2;
          const halfText = measureish(cell.text) / 2 + PAD_X;
          headerG.appendChild(spannerLine(rect.x + PAD_X, ruleY, cx - halfText, ruleY));
          headerG.appendChild(spannerLine(cx + halfText, ruleY, rect.x + rect.w - PAD_X, ruleY));
        }
      }
    }
  }
  // Stub corner label (stub_header), left-aligned and bottom-aligned with the leaf headers.
  if (model.stubHeader) {
    headerG.appendChild(
      text(PAD_X, leafLabelBottom, model.stubHeader, {
        anchor: "start",
        weight: 700,
        fill: TBL.color.heading,
        size: HEADER_FONT,
      }),
    );
  }
  // Inter-tier rules are OFF by default; drawn (in the medium border tone) only when
  // header_tier_rules is enabled, at the actual tier boundaries.
  const tiers = model.headerRows.length;
  if (headerTierRules) {
    for (let t = 1; t < tiers; t++) {
      headerG.appendChild(ruleGroup(0, layout.tierY[t]!, layout.totalWidth, layout.tierY[t]!));
    }
  }
  // The header→body rule always stays and spans the FULL width (x=0 → totalWidth), so it crosses
  // the stub corner continuously (bug #4).
  headerG.appendChild(ruleStrong(0, layout.headerHeight, layout.totalWidth, layout.headerHeight));
  svg.appendChild(headerG);

  // ---- Body ----
  const bodyG = el("g", { class: "tbl-table-body" });
  layout.rows.forEach((entry, idx) => {
    if ("group" in entry) {
      const { group, rect, noteLines, topGap, isFirst } = entry;
      const g = el("g", { class: "tbl-table-group" });
      // Divider above the group (medium border tone); the first group has no rule (HTML).
      if (!isFirst) g.appendChild(ruleGroup(0, rect.y, layout.totalWidth, rect.y));
      const x = PAD_X + group.level * INDENT_STEP;
      const labelBaseline = rect.y + topGap + BODY_FONT;
      g.appendChild(
        text(x, labelBaseline, group.label, {
          anchor: "start",
          weight: 700,
          fill: TBL.color.heading,
          size: BODY_FONT,
        }),
      );
      // Group note: italic + muted, wrapped onto its own line(s) below the label.
      noteLines.forEach((ln, li) => {
        g.appendChild(
          text(x, labelBaseline + GROUP_NOTE_GAP + NOTE_FONT + li * GROUP_NOTE_LINE_HEIGHT, ln, {
            anchor: "start",
            weight: 400,
            fill: TBL.color.muted,
            size: NOTE_FONT,
            italic: true,
          }),
        );
      });
      bodyG.appendChild(g);
      return;
    }

    const { row, rect, cellRects } = entry;
    const rg = el("g", { class: "tbl-table-row" });
    const baseY = rect.y + rect.h / 2 + BODY_FONT / 3;
    const stubWeight = row.cells.some((c) => c.emphasis) ? 700 : 400;
    const stubX = PAD_X + row.level * INDENT_STEP;

    // Stub label, left-aligned, indented by level. Wrapped onto multiple lines when the layout
    // wrapped it (stub_wrap); otherwise a single line, clipped to the column when capped.
    const stubLines = entry.stubLines;
    if (stubLines && stubLines.length > 1) {
      const blockH = (stubLines.length - 1) * STUB_LINE_HEIGHT;
      const t = el("text", {
        x: stubX,
        y: rect.y + rect.h / 2 - blockH / 2 + BODY_FONT / 3,
        "text-anchor": "start",
        "font-family": TBL.font,
        "font-size": BODY_FONT,
        "font-weight": stubWeight,
        fill: TBL.color.text,
      });
      stubLines.forEach((ln, li) => {
        const ts = el("tspan", { x: stubX, dy: li === 0 ? 0 : STUB_LINE_HEIGHT });
        ts.textContent = ln;
        t.appendChild(ts);
      });
      rg.appendChild(t);
    } else {
      const st = text(stubX, baseY, row.label, {
        anchor: "start",
        weight: stubWeight,
        fill: TBL.color.text,
        size: BODY_FONT,
      });
      if (clipStub) st.setAttribute("clip-path", "url(#tbl-stub-clip)");
      rg.appendChild(st);
    }

    // One cell per leaf: numeric cells centered; text cells left-aligned (and wrapped when the
    // layout wrapped them to the column width).
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
      const weight = cell.emphasis ? 700 : 400;
      const cellLines = entry.cellLines?.[i];
      if (cell.isText) {
        const tx = cr.x + PAD_X;
        if (cellLines && cellLines.length > 1) {
          const blockH = (cellLines.length - 1) * STUB_LINE_HEIGHT;
          const t = el("text", {
            x: tx,
            y: cr.y + cr.h / 2 - blockH / 2 + BODY_FONT / 3,
            "text-anchor": "start",
            "font-family": TBL.font,
            "font-size": BODY_FONT,
            "font-weight": weight,
            fill: TBL.color.text,
          });
          cellLines.forEach((ln, li) => {
            const ts = el("tspan", { x: tx, dy: li === 0 ? 0 : STUB_LINE_HEIGHT });
            ts.textContent = ln;
            t.appendChild(ts);
          });
          cg.appendChild(t);
        } else {
          cg.appendChild(text(tx, baseY, cell.text, { anchor: "start", weight, fill: TBL.color.text, size: BODY_FONT }));
        }
        rg.appendChild(cg);
        return;
      }
      const t = text(cr.x + cr.w / 2, baseY, cell.text, {
        anchor: "middle",
        weight,
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

    // Row separator: the light gridline between data rows. Suppressed when the next entry is a
    // group — that group draws its own (medium) divider, so the boundary shows a single rule.
    const next = layout.rows[idx + 1];
    const nextIsGroup = next != null && "group" in next;
    if (!nextIsGroup) {
      rg.appendChild(ruleRow(0, rect.y + rect.h, layout.totalWidth, rect.y + rect.h));
    }
    bodyG.appendChild(rg);
  });
  svg.appendChild(bodyG);

  // ---- Footnotes (listed below the table body, per spec §8) ----
  if (model.footnotes.length > 0) {
    const bodyBottom = layout.totalHeight - layout.footnotesHeight;
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

// Deterministic rough text width for placing the flanking rules on a banner cell (no canvas
// needed; matches the test's measureText heuristic of ~7px/char).
function measureish(s: string): number {
  return s.length * 7;
}
