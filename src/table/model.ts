import type { TableSpec } from "../spec/table-types";
import type { TidyRow } from "../data/index";
import { resolveFormat, formatCell } from "./format";

export interface LeafColumn { key: string; path: string[]; label: string; sublabel?: string; isText?: boolean; }
export interface HeaderCell { text: string; colSpan: number; rowSpan: number; leafKey?: string; }
export interface Cell { value: number | null; text: string; isText?: boolean; emphasis?: boolean; footnote?: string; signClass?: "pos" | "neg" }
export interface BodyRow { stubPath: string[]; label: string; level: number; groupKeys: string[]; cells: Cell[]; }   // cells aligned to leaves
export interface RowGroup { label: string; level: number; note?: string; }
export interface TableModel {
  leaves: LeafColumn[];
  headerRows: HeaderCell[][];      // top tier first
  body: Array<{ kind: "group"; group: RowGroup } | { kind: "row"; row: BodyRow }>;
  stubHeader: string;              // top-left corner label (usually "")
  footnotes: Array<{ marker: string; text: string }>;
}

/** Resolve a stub/header entry to its underlying column name. */
function colOf(entry: string | { label: string }): string {
  return typeof entry === "string" ? entry : entry.label;
}

/** Truthy test for boolean-like CSV flags. */
function isTruthy(v: string | undefined): boolean {
  if (v == null) return false;
  const s = v.trim().toLowerCase();
  return s === "yes" || s === "1" || s === "true" || s === "y";
}

/** Parse a numeric cell; blank or non-finite → null. */
function parseValue(v: string | undefined): number | null {
  if (v == null) return null;
  const s = v.trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function buildTableModel(spec: TableSpec, rows: TidyRow[]): TableModel {
  const stubCols = spec.stub.map(colOf);
  const headerCols = spec.header;

  // ---- Leaves: distinct header-paths in first-seen order, keyed by leaf value. ----
  const leafMap = new Map<string, LeafColumn>();
  for (const r of rows) {
    const path = headerCols.map((c) => r[c] ?? "");
    const key = path[path.length - 1] ?? "";
    if (!leafMap.has(key)) {
      leafMap.set(key, {
        key,
        path,
        label: spec.header_labels?.[key] ?? spec.column_labels?.[key] ?? key,
        ...(spec.sublabels?.[key] != null ? { sublabel: spec.sublabels[key] } : {}),
      });
    }
  }
  let leaves = [...leafMap.values()];
  if (spec.column_order && spec.column_order.length) {
    const order = spec.column_order;
    const rank = new Map(order.map((k, i) => [k, i]));
    leaves = leaves
      .map((l, i) => ({ l, i }))
      .sort((a, b) => {
        const ra = rank.has(a.l.key) ? rank.get(a.l.key)! : order.length + a.i;
        const rb = rank.has(b.l.key) ? rank.get(b.l.key)! : order.length + b.i;
        return ra - rb;
      })
      .map((x) => x.l);
  }

  // ---- Header lattice. ----
  // A blank value at tier t for a leaf is absorbed by the nearest non-blank tier BELOW it (the
  // descendant), which spans UP to fill the gap. (The model.test fixture has a blank interior
  // tier — tier2 blank between "Dyn" and the "GDP" leaf — and expects the leaf cell carrying
  // `leafKey` to rowSpan up through that blank tier. The test is authoritative on this.) So each
  // tier position for a leaf is "owned" by the nearest non-blank tier at or below it; the owning
  // cell sits at that lower tier and rowSpans up across the run of blank tiers above it.
  const T = headerCols.length;
  const headerRows: HeaderCell[][] = Array.from({ length: T }, () => []);

  // For each leaf, a blank tier is filled by the nearest non-blank tier below it spanning UP. We
  // assign each tier position to the tier whose value visually occupies it: walking top-down, a
  // blank tier is occupied by the next non-blank tier below (so its cell starts at the topmost
  // blank tier of the run and spans down to the non-blank tier). `startTier[t]` = the tier at
  // which the cell occupying position t begins (its emission row); `endTier[t]` = where it ends.
  const startTier: number[][] = leaves.map((leaf) => {
    const starts: number[] = new Array(T).fill(0);
    let runStart = -1;
    for (let t = 0; t < T; t++) {
      const blank = (leaf.path[t] ?? "") === "";
      if (blank) {
        if (runStart === -1) runStart = t; // begin a run of blank tiers
        starts[t] = runStart;
      } else {
        starts[t] = runStart === -1 ? t : runStart; // non-blank closes a run begun above
        runStart = -1;
      }
    }
    return starts;
  });

  for (let t = 0; t < T; t++) {
    let i = 0;
    while (i < leaves.length) {
      const leaf = leaves[i]!;
      const starts = startTier[i]!;
      // Only emit a cell at the tier where the occupying value's span begins. A position whose
      // owning cell began at a higher tier (blank run absorbed from below) is skipped here.
      if (starts[t] !== t) { i++; continue; }

      // The value sits at the nearest non-blank tier at or below t (end of the blank run).
      let valueTier = t;
      while (valueTier < T && (leaf.path[valueTier] ?? "") === "") valueTier++;
      if (valueTier >= T) valueTier = t; // all-blank fallback
      const rawValue = leaf.path[valueTier] ?? "";
      const rowSpan = valueTier - t + 1;

      // Merge adjacent leaves whose path[0..valueTier] are equal into one cell with colSpan.
      let colSpan = 1;
      let j = i + 1;
      const samePrefix = (a: LeafColumn, b: LeafColumn): boolean => {
        for (let k = 0; k <= valueTier; k++) if ((a.path[k] ?? "") !== (b.path[k] ?? "")) return false;
        return true;
      };
      while (j < leaves.length && samePrefix(leaf, leaves[j]!)) { colSpan++; j++; }

      // The leaf-bottom cell occupies the bottom tier and covers exactly one leaf.
      const isLeafBottom = colSpan === 1 && valueTier === T - 1;
      // Resolve display label: leaf-bottom cells use the leaf's pre-computed label (which already
      // applies header_labels → column_labels → raw); banner/upper cells apply header_labels only.
      const text = isLeafBottom
        ? leaf.label
        : (spec.header_labels?.[rawValue] ?? rawValue);
      const cell: HeaderCell = { text, colSpan, rowSpan };
      if (isLeafBottom) cell.leafKey = leaf.key;
      headerRows[t]!.push(cell);

      i = j;
    }
  }

  // ---- Body. ----
  // Group rows by full stub-path; emit group entries on first appearance of each group level,
  // honoring row_order (applied to the label column / row label).
  const rowOrder = spec.row_order;
  const rowRank = rowOrder ? new Map(rowOrder.map((k, i) => [k, i])) : null;

  // Collision-safe separator: use NUL byte so real labels (which may contain spaces) cannot collide.
  const SEP = "\x00";

  // Index cell values by stubPathKey -> leafPathKey -> row (last wins) for lookup + extras.
  const cellIndex = new Map<string, Map<string, TidyRow>>();
  for (const r of rows) {
    const stubKey = stubCols.map((c) => r[c] ?? "").join(SEP);
    const leafKey = headerCols.map((c) => r[c] ?? "").join(SEP);
    let inner = cellIndex.get(stubKey);
    if (!inner) { inner = new Map(); cellIndex.set(stubKey, inner); }
    inner.set(leafKey, r);
  }

  // Distinct full stub-paths in first-seen order.
  const stubPaths: string[][] = [];
  const seenStub = new Set<string>();
  for (const r of rows) {
    const path = stubCols.map((c) => r[c] ?? "");
    const key = path.join(SEP);
    if (!seenStub.has(key)) { seenStub.add(key); stubPaths.push(path); }
  }

  // Sort stub-paths by row_order on the leaf (row label), then first-seen. Keep group locality:
  // sort primarily so that earlier-ranked labels come first while preserving first-seen for ties.
  if (rowRank) {
    const firstSeen = new Map(stubPaths.map((p, i) => [p.join(SEP), i]));
    stubPaths.sort((a, b) => {
      const la = a[a.length - 1] ?? "";
      const lb = b[b.length - 1] ?? "";
      const ra = rowRank.has(la) ? rowRank.get(la)! : rowOrder!.length + (firstSeen.get(a.join(SEP)) ?? 0);
      const rb = rowRank.has(lb) ? rowRank.get(lb)! : rowOrder!.length + (firstSeen.get(b.join(SEP)) ?? 0);
      return ra - rb;
    });
  }

  const body: TableModel["body"] = [];
  const emittedGroup = new Set<string>();
  const emphasisRows = new Set(spec.emphasis_rows ?? []);

  for (const path of stubPaths) {
    const groupPath = path.slice(0, -1);
    const label = path[path.length - 1] ?? "";

    // Emit group entries for any not-yet-emitted group level (nested -> one per level).
    for (let lvl = 0; lvl < groupPath.length; lvl++) {
      const gLabel = groupPath[lvl] ?? "";
      const gKey = groupPath.slice(0, lvl + 1).join(SEP);
      if (!emittedGroup.has(gKey)) {
        emittedGroup.add(gKey);
        // Display label may be overridden in the spec (so math/markup can live in YAML); the raw
        // CSV value `gLabel` stays the key for group_notes and format.groups.
        const group: RowGroup = { label: spec.group_labels?.[gLabel] ?? gLabel, level: lvl };
        const note = spec.group_notes?.[gLabel];
        if (note != null) group.note = note;
        body.push({ kind: "group", group });
      }
    }

    // Build the row's cells aligned to leaves.
    const inner = cellIndex.get(path.join(SEP));
    const cells: Cell[] = leaves.map((leaf) => {
      const r = inner?.get(leaf.path.join(SEP));
      const raw = r ? r[spec.value] : undefined;
      const value = parseValue(raw);
      const rawTrim = raw?.trim() ?? "";
      // A non-empty, non-numeric value is a text cell: kept verbatim, left-aligned, no number
      // formatting or sign coloring. Blank/missing stays a null numeric cell.
      const isText = value == null && rawTrim !== "";
      const rule = resolveFormat({ leafKey: leaf.key, groupKeys: groupPath, rowLabel: label, spec });
      const text = isText ? rawTrim : formatCell(value, rule);
      const cell: Cell = isText ? { value: null, text, isText: true } : { value, text };

      // Emphasis: row in emphasis_rows OR emphasis_column truthy on the source row.
      const colEmph = spec.emphasis_column && r ? isTruthy(r[spec.emphasis_column]) : false;
      if (emphasisRows.has(label) || colEmph) cell.emphasis = true;

      // Footnote from footnote_column.
      if (spec.footnote_column && r) {
        const fn = r[spec.footnote_column];
        if (fn != null && fn.trim() !== "") cell.footnote = fn.trim();
      }

      // Sign coloring. `rule.signColor` already folds in the global default (resolveFormat), so a
      // per-column `signColor:false` correctly wins over global `sign_color:true`. Test the resolved
      // rule ONLY — ORing the global flag back in here would defeat that per-column override.
      if (rule.signColor && value != null && value !== 0) {
        cell.signClass = value > 0 ? "pos" : "neg";
      }
      return cell;
    });

    body.push({
      kind: "row",
      row: {
        stubPath: path,
        // Display label may be overridden in the spec; raw `label` (above) stays the key for
        // emphasis_rows, format.rows, and row_order.
        label: spec.row_labels?.[label] ?? label,
        level: groupPath.length,
        groupKeys: groupPath,
        cells,
      },
    });
  }

  const footnotes = spec.footnotes
    ? Object.entries(spec.footnotes).map(([marker, text]) => ({ marker, text }))
    : [];

  // Mark a leaf as a text column when all its non-empty cells are text (no numbers) — drives
  // left alignment of both the cells and the column header.
  leaves.forEach((leaf, i) => {
    let hasText = false;
    let hasNum = false;
    for (const b of body) {
      if (b.kind !== "row") continue;
      const c = b.row.cells[i];
      if (c?.isText) hasText = true;
      else if (c && c.value != null) hasNum = true;
    }
    if (hasText && !hasNum) leaf.isText = true;
  });

  return {
    leaves,
    headerRows,
    body,
    // Corner (top-left) label. A string applies to every pane; a per-pane map is resolved by the
    // multi-pane layer, which overrides this afterward.
    stubHeader: typeof spec.stub_header === "string" ? spec.stub_header : "",
    footnotes,
  };
}
