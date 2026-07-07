import type { TableSpec } from "../spec/table-types";
import type { TidyRow } from "../data/index";
import { resolveFormat, formatCell } from "./format";

export interface LeafColumn { key: string; path: string[]; lastValue: string; label: string; sublabel?: string; isText?: boolean; }
export interface HeaderCell { text: string; colSpan: number; rowSpan: number; leafKey?: string; }
export interface Cell { value: number | null; text: string; isText?: boolean; emphasis?: boolean; footnote?: string; signClass?: "pos" | "neg" }
export interface BodyRow { stubPath: string[]; label: string; level: number; groupKeys: string[]; cells: Cell[]; emphasis?: boolean; }   // cells aligned to leaves
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

// Collision-safe separator: use NUL byte so real labels (which may contain spaces) cannot collide.
const SEP = "\x00";

export function buildTableModel(spec: TableSpec, rows: TidyRow[]): TableModel {
  const stubCols = spec.stub.map(colOf);
  const headerCols = spec.header;

  // ---- Leaves: distinct header-paths in first-seen order. ----
  // Leaves are deduped by their FULL path (not just the last-tier value), so a leaf value that
  // repeats under different banner groups (e.g. presub/postsub under both "Levels" and "Change vs.
  // default") produces distinct columns instead of colliding and being dropped. `key` is the
  // unique, attribute-safe identity used downstream (data-col, HeaderCell.leafKey, layout/mount
  // index lookups): it is the leaf's last value, suffixed with `~1`, `~2`, ... (first-seen order)
  // only when that value is already taken by an earlier leaf. `lastValue` is always the raw
  // last-tier value and is what header_labels/column_labels/sublabels/column_order/format resolve
  // against, so authoring stays simple. Tables whose leaf values are already globally unique never
  // hit the suffix branch, so key === lastValue and output is byte-identical to before this change.
  const leafMap = new Map<string, LeafColumn>();
  const usedKeys = new Set<string>();
  for (const r of rows) {
    const path = headerCols.map((c) => r[c] ?? "");
    const pathKey = path.join(SEP);
    if (leafMap.has(pathKey)) continue;
    const lastValue = path[path.length - 1] ?? "";
    let key = lastValue;
    if (usedKeys.has(key)) {
      let n = 1;
      while (usedKeys.has(`${lastValue}~${n}`)) n++;
      key = `${lastValue}~${n}`;
    }
    usedKeys.add(key);
    leafMap.set(pathKey, {
      key,
      path,
      lastValue,
      label: spec.header_labels?.[lastValue] ?? spec.column_labels?.[lastValue] ?? lastValue,
      ...(spec.sublabels?.[lastValue] != null ? { sublabel: spec.sublabels[lastValue] } : {}),
    });
  }
  let leaves = [...leafMap.values()];
  if (spec.column_order && spec.column_order.length) {
    const order = spec.column_order;
    const rank = new Map(order.map((k, i) => [k, i]));
    leaves = leaves
      .map((l, i) => ({ l, i }))
      .sort((a, b) => {
        const ra = rank.has(a.l.lastValue) ? rank.get(a.l.lastValue)! : order.length + a.i;
        const rb = rank.has(b.l.lastValue) ? rank.get(b.l.lastValue)! : order.length + b.i;
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

  // group_order normalization: a flat string[] orders level 0 only; string[][] orders each group
  // level independently. Levels beyond the given lists (or when group_order is absent) fall back
  // to first-seen order for that level.
  const groupOrderLevels: (string[] | undefined)[] = !spec.group_order || spec.group_order.length === 0
    ? []
    : Array.isArray(spec.group_order[0])
      ? (spec.group_order as string[][])
      : [spec.group_order as string[]];
  const groupRankMaps: (Map<string, number> | undefined)[] = groupOrderLevels.map((list) =>
    list ? new Map(list.map((v, i) => [v, i])) : undefined,
  );

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

  // Order-independent grouping + group_order + row_order-within-groups: a single hierarchical
  // comparator over stub-paths. For each group tier (levels 0..groupDepth-1) it ranks by
  // group_order if the value is listed, else by that group's first-seen ordinal (the existing
  // column_order idiom: `list.length + firstSeenOrdinal`, so unlisted values sort after all
  // listed ones and preserve their relative first-seen order). This also fixes the underlying
  // grouping bug: sorting by group tier makes every group's rows contiguous regardless of how
  // the source data was ordered (e.g. scenario-major CSVs), so the group-emission loop below
  // (unchanged) emits each header exactly once with all of that group's rows following. At the
  // leaf level it falls back to the same idiom using row_order, scoped within the group since the
  // group tiers already sorted first.
  //
  // Gated on groupDepth > 0 || row_order so a flat, unordered table skips sorting entirely and
  // stays byte-identical; a stable sort + first-seen fallbacks make already-contiguous grouped
  // data produce unchanged output too.
  const groupDepth = stubCols.length - 1;
  if (groupDepth > 0 || rowRank) {
    const firstSeen = new Map(stubPaths.map((p, i) => [p.join(SEP), i]));
    const firstSeenPrefix: Map<string, number>[] = Array.from({ length: groupDepth }, () => new Map());
    for (const path of stubPaths) {
      for (let l = 0; l < groupDepth; l++) {
        const key = path.slice(0, l + 1).join(SEP);
        const m = firstSeenPrefix[l]!;
        if (!m.has(key)) m.set(key, m.size);
      }
    }
    stubPaths.sort((a, b) => {
      for (let l = 0; l < groupDepth; l++) {
        const la = a[l] ?? "";
        const lb = b[l] ?? "";
        const rankMap = groupRankMaps[l];
        const listLen = groupOrderLevels[l]?.length ?? 0;
        const ka = rankMap?.has(la) ? rankMap.get(la)! : listLen + firstSeenPrefix[l]!.get(a.slice(0, l + 1).join(SEP))!;
        const kb = rankMap?.has(lb) ? rankMap.get(lb)! : listLen + firstSeenPrefix[l]!.get(b.slice(0, l + 1).join(SEP))!;
        if (ka !== kb) return ka - kb;
      }
      const la = a[a.length - 1] ?? "";
      const lb = b[b.length - 1] ?? "";
      const ra = rowRank?.has(la) ? rowRank.get(la)! : (rowOrder?.length ?? 0) + (firstSeen.get(a.join(SEP)) ?? 0);
      const rb = rowRank?.has(lb) ? rowRank.get(lb)! : (rowOrder?.length ?? 0) + (firstSeen.get(b.join(SEP)) ?? 0);
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
      // format.columns is author-facing (authors write the leaf VALUE, e.g. "% of GDP"), so it must
      // resolve against lastValue, not the possibly-suffixed `key` — matching header_labels/
      // column_labels/sublabels/column_order, all of which resolve against lastValue too. A format
      // rule keyed by a repeated leaf value applies to every leaf sharing that value.
      const rule = resolveFormat({ leafKey: leaf.lastValue, groupKeys: groupPath, rowLabel: label, spec });
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
        // Whole-row emphasis (stub included): set ONLY from emphasis_rows on the raw leaf label,
        // never from emphasis_column — that mechanism stays strictly per-cell (see cell.emphasis
        // above), so a column flag never forces the stub bold/highlighted.
        ...(emphasisRows.has(label) ? { emphasis: true } : {}),
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
