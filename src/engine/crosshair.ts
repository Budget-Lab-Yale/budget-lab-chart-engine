// Cursor-following crosshair tooltip (a live-layer DOM primitive). A vertical guide
// stays inside the SVG and snaps to the nearest x in the data; the tooltip is appended
// to document.body and positioned with position:fixed at the cursor's viewport coords.
import { d3 } from "./vendor";
import { TBL } from "./theme";
import { escapeHtml } from "./util";

type Row = Record<string, unknown>;

export interface CrosshairOptions {
  rows: Row[];
  xField?: string;
  yField?: string;
  seriesField?: string;
  xParse?: (v: unknown) => number;
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  colors?: Map<string, string>;
  /** Series rendered dashed (mirrors the legend swatch in the tooltip). */
  dashedSeries?: Set<string>;
  /** Short data key → display label. */
  seriesLabels?: Record<string, string>;
  /** Fixed tooltip row order (matches the legend); else data-encounter order. */
  seriesOrder?: string[];
}

let activeTooltip: HTMLElement | null = null; // single shared tooltip element

function getSharedTooltip(doc: Document): HTMLElement {
  if (activeTooltip && doc.body.contains(activeTooltip)) return activeTooltip;
  const tip = doc.createElement("div");
  tip.className = "tbl-tooltip";
  doc.body.appendChild(tip);
  activeTooltip = tip;
  return tip;
}

export function attachCrosshair(svgEl: SVGSVGElement, opts: CrosshairOptions): void {
  const {
    rows,
    xField = "time",
    yField = "value",
    seriesField = "series",
    colors,
    dashedSeries,
    seriesLabels,
    seriesOrder,
  } = opts;
  let { xParse, xFormat } = opts;
  const yFormat =
    opts.yFormat ??
    ((v: number) => `${(+v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
  if (!svgEl || !rows?.length) return;

  const vb = svgEl.viewBox?.baseVal;
  const W = vb?.width || +(svgEl.getAttribute("width") ?? "") || svgEl.clientWidth;
  const H = vb?.height || +(svgEl.getAttribute("height") ?? "") || svgEl.clientHeight;

  const ml = +(svgEl.dataset.marginLeft ?? "") || 0;
  const mr = +(svgEl.dataset.marginRight ?? "") || 8;
  const mt = +(svgEl.dataset.marginTop ?? "") || 18;
  const mb = +(svgEl.dataset.marginBottom ?? "") || 28;

  const plotW = W - ml - mr;
  const plotH = H - mt - mb;

  if (!xParse) {
    const sample = rows[0]?.[xField];
    if (/^\d{4}-\d{2}-\d{2}/.test(String(sample))) {
      xParse = (v) => +new Date(String(v));
      if (!xFormat) xFormat = (v) => d3.timeFormat("%b %Y")(new Date(v));
    } else if (/Q\d/.test(String(sample))) {
      xParse = (v) => {
        const m = /(\d{4})Q(\d)/.exec(String(v));
        return +new Date(+(m as RegExpExecArray)[1]!, (+(m as RegExpExecArray)[2]! - 1) * 3, 1);
      };
      if (!xFormat)
        xFormat = (v) => {
          const d = new Date(v);
          const q = Math.floor(d.getMonth() / 3) + 1;
          return `${d.getFullYear()}Q${q}`;
        };
    } else {
      xParse = (v) => +(v as number);
      if (!xFormat) xFormat = (v) => String(v);
    }
  }

  const xs = Array.from(new Set(rows.map((r) => xParse!(r[xField])))).sort((a, b) => a - b);
  const bySeries = new Map<string, Map<number, number>>();
  for (const r of rows) {
    const v = r[yField];
    if (v === "" || v == null) continue; // skip blank rows
    const k = r[seriesField] as string;
    if (!bySeries.has(k)) bySeries.set(k, new Map());
    bySeries.get(k)!.set(xParse!(r[xField]), +(v as number));
  }
  const xMin = xs[0]!;
  const xMax = xs[xs.length - 1]!;
  const xToPx = (x: number): number => ml + ((x - xMin) / (xMax - xMin)) * plotW;
  const pxToX = (px: number): number => xMin + ((px - ml) / plotW) * (xMax - xMin);
  const bisect = d3.bisector((d: number) => d).left;

  const NS = "http://www.w3.org/2000/svg";
  svgEl.querySelectorAll(".tbl-crosshair, .tbl-crosshair-hit").forEach((el) => el.remove());

  const guide = svgEl.ownerDocument.createElementNS(NS, "line");
  guide.classList.add("tbl-crosshair");
  guide.setAttribute("stroke", TBL.color.annotationDim);
  guide.setAttribute("stroke-dasharray", "3 3");
  guide.setAttribute("y1", String(mt));
  guide.setAttribute("y2", String(mt + plotH));
  guide.setAttribute("opacity", "0");
  guide.style.pointerEvents = "none";
  svgEl.appendChild(guide);

  // Transparent hit-area covering the full SVG so events fire over any region.
  const hit = svgEl.ownerDocument.createElementNS(NS, "rect");
  hit.classList.add("tbl-crosshair-hit");
  hit.setAttribute("x", "0");
  hit.setAttribute("y", "0");
  hit.setAttribute("width", String(W));
  hit.setAttribute("height", String(H));
  hit.setAttribute("fill", "transparent");
  hit.style.cursor = "crosshair";
  svgEl.appendChild(hit);

  const tip = getSharedTooltip(svgEl.ownerDocument);

  function snapX(svgX: number): number | null {
    if (svgX < ml || svgX > ml + plotW) return null;
    const xVal = pxToX(svgX);
    const i = bisect(xs, xVal);
    const cand = [xs[i - 1], xs[i]].filter((v) => v != null) as number[];
    if (!cand.length) return null;
    return cand.length === 1
      ? cand[0]!
      : Math.abs(cand[0]! - xVal) < Math.abs(cand[1]! - xVal)
        ? cand[0]!
        : cand[1]!;
  }

  function update(evt: PointerEvent): void {
    const rect = svgEl.getBoundingClientRect();
    if (!rect.width) return;
    const scaleX = W / rect.width;
    const svgX = (evt.clientX - rect.left) * scaleX;

    const snap = snapX(svgX);
    if (snap == null) {
      hide();
      return;
    }
    const gx = xToPx(snap);
    guide.setAttribute("x1", String(gx));
    guide.setAttribute("x2", String(gx));
    guide.setAttribute("opacity", "1");

    let html = `<div class="tbl-tooltip-head">${escapeHtml(xFormat!(snap))}</div>`;
    const tipSeries =
      seriesOrder && seriesOrder.length
        ? seriesOrder.filter((s) => bySeries.has(s))
        : [...bySeries.keys()];
    for (const series of tipSeries) {
      const m = bySeries.get(series)!;
      const v = m.get(snap);
      if (v == null || Number.isNaN(v)) continue;
      const dot = colors?.get(series) || "currentColor";
      const isDashed = dashedSeries?.has(series);
      const display = (seriesLabels && seriesLabels[series]) || series;
      const swatchClass = isDashed ? "tbl-tooltip-swatch is-dashed" : "tbl-tooltip-swatch";
      const swatchStyle = isDashed ? `--swatch-color: ${dot}` : `background: ${dot}`;
      html += `<div class="tbl-tooltip-row"><span class="${swatchClass}" style="${swatchStyle}"></span><span><span class="tbl-tooltip-label">${escapeHtml(display)}:</span> <span class="tbl-tooltip-value">${escapeHtml(yFormat(v))}</span></span></div>`;
    }
    tip.innerHTML = html;

    const offset = 14;
    const win = svgEl.ownerDocument.defaultView!;
    const vw = win.innerWidth;
    const vh = win.innerHeight;
    tip.style.opacity = "1";
    let left = evt.clientX + offset;
    let top = evt.clientY + offset;
    if (left + tip.offsetWidth + 4 > vw) left = evt.clientX - tip.offsetWidth - offset;
    if (top + tip.offsetHeight + 4 > vh) top = evt.clientY - tip.offsetHeight - offset;
    if (left < 4) left = 4;
    if (top < 4) top = 4;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  function hide(): void {
    guide.setAttribute("opacity", "0");
    tip.style.opacity = "0";
  }

  hit.style.pointerEvents = "all";
  hit.addEventListener("pointermove", update as EventListener);
  hit.addEventListener("pointerleave", hide);
  hit.addEventListener("pointerdown", update as EventListener);
}
