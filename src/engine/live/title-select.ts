// The live card header (eyebrow, title + logo, subtitle) and its inline title-selector widget.
// Shared by mountChart, mountFigure and mountTable. Moved verbatim from render-live.ts.
import type { TitleSelector } from "../../spec/types.js";
import { ownValue } from "../../spec/own-key.js";
import { parseTitleTokens } from "../../spec/title.js";
import { resolveColor } from "../palette.js";
import { LOGO_SVG } from "../../embed/assets.js";
import { notify } from "./lifecycle.js";

/** Live wiring for the inline title selector(s): the spec's `title_selectors`, the mount's
 *  SHARED mutable selections object (updated in place on change, so later reads — e.g. the PNG
 *  download button — always see the live state), and the host's optional change callback. The
 *  card root itself (buildFigureHeader's first argument) is the CustomEvent dispatch target. */
export interface TitleSelectorWiring {
  selectors: Record<string, TitleSelector>;
  selections: Record<string, string>;
  onSelect?: (change: { id: string; value: string }) => void;
  /** `spec.series_colors` — the fallback source for an option's trigger-label tint when the
   *  option itself has no explicit `color` (see TitleSelectorOption.color and
   *  spec/title.ts#resolveActiveOptionColor, which this mirrors at build time). */
  seriesColors?: Record<string, string>;
  /** Called after a selection's shared-state update + host callback + CustomEvent have all
   *  fired — mountChart's hook to re-render the chart body so a single-series chart's line
   *  adopts the newly-active option's color (see engine/index.ts
   *  RenderOptions.accentColor). mountFigure (small multiples) omits this: the label still
   *  tints, but the per-pane grid isn't re-rendered — each pane is one facet's chart body, not a
   *  single accent target, and this port does not touch figure.ts. */
  afterChange?: () => void;
  /** The owning mount's disposal state. Read on every change, because teardown can re-enter the
   *  widget before it closes the header (its own `onHover(null)` may pick an option). */
  isDisposed?: () => boolean;
}

/** One option's DATA for the inline-select widget below: display label + the RAW (unresolved)
 *  color, if any, that tints the trigger label while this option is active. */
interface InlineSelectItem {
  id: string;
  label: string;
  color?: string;
}

/**
 * The AI Labor Market Tracker's inline title-selector widget (charts.js `buildInlineSelect`,
 * ported near-verbatim — see also styles.css L392-479 for the paired CSS): a button styled like
 * a boxed piece of title text (`.inline-select`) with a caret, opening a popover `<ul>`
 * (`.inline-select-popover`) of options on click. Behavior: click toggles the popover; a
 * click anywhere outside the button/popover closes it; Escape closes it and refocuses the
 * button; Enter/Space on a focused option selects it; ArrowUp/ArrowDown move focus with
 * wraparound; typing buffers into a 600ms type-ahead match against option labels. The button's
 * label is tinted to the ACTIVE option's resolved color (`palette.resolveColor`) — the caret
 * stays muted; the popover itself carries no per-option tint (the active row is marked navy +
 * semibold only, via `.is-active`).
 *
 * One structural difference from the tracker: the tracker tears down and rebuilds this widget on
 * every selection (as part of a full figure re-render driven by its own state store). The
 * engine's title is built ONCE per mount and never rebuilt (see buildFigureHeader) so the resize
 * draw() loop can't clobber the user's open popover / focus — so this instance updates its own
 * label/aria state in place on selection, rather than relying on a future rebuild.
 */
function buildInlineSelect(
  doc: Document,
  items: InlineSelectItem[],
  initialActiveId: string,
  onSelect: (id: string) => void,
): { el: HTMLElement; destroy: () => void } {
  const btn = doc.createElement("button");
  btn.type = "button";
  btn.className = "inline-select";
  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");

  const labelEl = doc.createElement("span");
  labelEl.className = "inline-select-label";
  const caret = doc.createElement("span");
  caret.className = "inline-select-caret";
  caret.textContent = "▾";
  caret.setAttribute("aria-hidden", "true");
  btn.appendChild(labelEl);
  btn.appendChild(caret);

  const popover = doc.createElement("ul");
  popover.className = "inline-select-popover";
  popover.setAttribute("role", "listbox");
  popover.hidden = true;

  let activeId = initialActiveId;
  const itemById = new Map<string, HTMLLIElement>();

  function refresh(): void {
    const active = items.find((i) => i.id === activeId) ?? items[0];
    labelEl.textContent = active?.label ?? "";
    // Tint the label with the option's resolved color (matches the chart's series color when the
    // accent feeds back to a single-series chart — see engine/index.ts RenderOptions.accentColor);
    // the caret stays grey (CSS-only, var(--tbl-text-muted)).
    labelEl.style.color = (active && resolveColor(active.color)) || "";
    for (const [id, li] of itemById) {
      li.setAttribute("aria-selected", String(id === active?.id));
      li.classList.toggle("is-active", id === active?.id);
    }
  }

  function selectItem(id: string): void {
    activeId = id;
    refresh();
    onSelect(id);
  }

  for (const item of items) {
    const li = doc.createElement("li");
    li.setAttribute("role", "option");
    li.dataset.id = item.id;
    li.textContent = item.label;
    li.tabIndex = 0;
    li.addEventListener("click", () => {
      selectItem(item.id);
      closePopover();
    });
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectItem(item.id);
        closePopover();
      }
    });
    popover.appendChild(li);
    itemById.set(item.id, li);
  }
  refresh();

  let typeAheadBuffer = "";
  let typeAheadTimer: ReturnType<typeof setTimeout> | undefined;

  function focusItem(li: HTMLElement | null | undefined): void {
    li?.focus();
  }

  // Guards the deferred `addEventListener` below: if closePopover runs in the SAME synchronous
  // tick as openPopover (e.g. click-then-Escape with no await), the pending setTimeout hasn't
  // fired yet, so removeEventListener would no-op and the listener would attach anyway a tick
  // later — permanently, since nothing is listening for it at that point. Capturing the timer id
  // lets closePopover cancel it before it ever registers.
  let clickAwayTimer: ReturnType<typeof setTimeout> | undefined;
  function openPopover(): void {
    popover.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    clickAwayTimer = setTimeout(() => {
      clickAwayTimer = undefined;
      doc.addEventListener("click", clickAway);
    }, 0);
    setTimeout(() => {
      const activeLi = itemById.get(activeId) ?? (popover.firstElementChild as HTMLElement | null);
      focusItem(activeLi);
    }, 0);
  }
  function closePopover(): void {
    popover.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    if (clickAwayTimer !== undefined) {
      clearTimeout(clickAwayTimer);
      clickAwayTimer = undefined;
    }
    doc.removeEventListener("click", clickAway);
    typeAheadBuffer = "";
    clearTimeout(typeAheadTimer);
    btn.focus();
  }
  function clickAway(e: Event): void {
    const target = e.target as Node;
    if (!btn.contains(target) && !popover.contains(target)) closePopover();
  }
  // Unmount-time teardown: same listener/timer cleanup as closePopover, but without the
  // onSelect-adjacent focus side effect (the button may be about to leave the DOM).
  function destroy(): void {
    if (clickAwayTimer !== undefined) {
      clearTimeout(clickAwayTimer);
      clickAwayTimer = undefined;
    }
    doc.removeEventListener("click", clickAway);
    clearTimeout(typeAheadTimer);
    popover.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  }

  function keyHandler(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      closePopover();
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      const focused = doc.activeElement;
      if (focused && focused.parentElement === popover) {
        e.preventDefault();
        (focused as HTMLElement).click();
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const lis = Array.from(popover.children) as HTMLElement[];
      const idx = lis.indexOf(doc.activeElement as HTMLElement);
      const next = e.key === "ArrowDown"
        ? lis[(idx + 1) % lis.length]
        : lis[(idx - 1 + lis.length) % lis.length];
      focusItem(next);
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      typeAheadBuffer += e.key.toLowerCase();
      clearTimeout(typeAheadTimer);
      typeAheadTimer = setTimeout(() => {
        typeAheadBuffer = "";
      }, 600);
      const match = items.find((i) => i.label.toLowerCase().startsWith(typeAheadBuffer));
      if (match) {
        e.preventDefault();
        focusItem(itemById.get(match.id));
      }
    }
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    popover.hidden ? openPopover() : closePopover();
  });

  const wrap = doc.createElement("span");
  wrap.className = "inline-select-wrap";
  wrap.appendChild(btn);
  wrap.appendChild(popover);
  wrap.addEventListener("keydown", keyHandler);
  return { el: wrap, destroy };
}

/** Render a title with inline-selector tokens into `h`: text segments become text nodes; each
 *  `{key}` token becomes an engine-owned button+popover widget (see buildInlineSelect — options
 *  from its TitleSelector, active = the current selection). On change: the shared selections
 *  object is updated in place, the host callback fires, a bubbling `tbl-title-select` CustomEvent
 *  dispatches from the card root (for standalone bundles with no host callback), and — when
 *  wired (mountChart only) — `afterChange` re-renders the chart body for the color accent. */
function buildSelectorTitle(
  h: HTMLElement,
  doc: Document,
  title: string,
  card: HTMLElement,
  wiring: TitleSelectorWiring,
): Array<() => void> {
  // Set by the header's close (every mount's teardown calls it, last): the widget stays on the
  // page, but a torn-down mount fires no onSelect, no tbl-title-select and no redraw. `off()` also
  // reads the mount's own disposal, which is set FIRST: teardown's onHover(null) can pick an option
  // before the header is closed. The close stays last so it still cleans up a popover opened then.
  let closed = false;
  const cleanups: Array<() => void> = [() => { closed = true; }];
  const { selectors, selections, onSelect, seriesColors, afterChange, isDisposed } = wiring;
  const off = (): boolean => closed || (isDisposed?.() ?? false);
  for (const seg of parseTitleTokens(title, selectors)) {
    if (seg.kind === "text") {
      h.appendChild(doc.createTextNode(seg.text));
      continue;
    }
    const key = seg.key;
    const selector = selectors[key]!;
    const items: InlineSelectItem[] = selector.options.map((opt) => ({
      id: opt.id,
      label: opt.label ?? opt.id,
      // Explicit option color wins; else the figure's series color for the option's label (the
      // shared per-series map) — mirrors spec/title.ts#resolveActiveOptionColor.
      color: opt.color ?? ownValue(seriesColors, opt.label ?? opt.id),
    }));
    // The mounts always pass a resolveSelections() map (every key populated), so the fallback is
    // defensive only — buildFigureHeader is exported, and an external caller could hand-roll an
    // incomplete wiring.selections.
    const initialActiveId = selections[key] ?? selector.options[0]?.id ?? "";
    const { el, destroy } = buildInlineSelect(doc, items, initialActiveId, (value) => {
      selections[key] = value;
      if (off()) return;
      notify(card, "tbl-title-select", { id: key, value }, onSelect, off);
      if (off()) return;
      afterChange?.();
    });
    h.appendChild(el);
    cleanups.push(destroy);
  }
  return cleanups;
}

/** Build the shared card header (eyebrow / title+logo / subtitle) — mirrors mountChart's
 *  header so single-chart and figure cards look identical. The eyebrow (figure number) is an
 *  embed-time value supplied by the caller, not read from the spec.
 *
 *  The spec parameter is typed as `{ title?: string; subtitle?: string }` (a structural subset)
 *  so both ChartSpec and TableSpec can be passed without casting. `titleWiring` (chart mounts
 *  only — tables have no title_selectors and omit it) turns each `{key}` token in the title
 *  into an engine-owned button+popover widget (see buildInlineSelect); absent, the title renders
 *  as plain textContent, DOM-identical to before the selector feature existed. The header is
 *  built ONCE per mount
 *  (the resize draw() loop never rebuilds it), so the control and its selection state survive
 *  the engine's own re-renders naturally.
 *
 *  Returns a cleanup callback: closes any open title-selector popover(s), clears their pending
 *  click-away timers, and removes the document click listener. A no-op when there's no
 *  titleWiring (tables, or a chart with no title_selectors). Callers (mountChart, mountFigure)
 *  MUST invoke this from their own unmount closures — otherwise unmounting with a popover open
 *  leaves its document-level click listener attached forever. */
export function buildFigureHeader(
  card: HTMLElement,
  doc: Document,
  spec: { title?: string; subtitle?: string },
  eyebrowText?: string,
  titleWiring?: TitleSelectorWiring,
): () => void {
  const header = doc.createElement("div");
  header.className = "figure-header";
  if (eyebrowText) {
    const eyebrow = doc.createElement("div");
    eyebrow.className = "figure-supertitle";
    eyebrow.textContent = eyebrowText;
    header.appendChild(eyebrow);
  }
  const titlebar = doc.createElement("div");
  titlebar.className = "figure-titlebar";
  let cleanups: Array<() => void> = [];
  if (spec.title) {
    const h = doc.createElement("h3");
    h.className = "figure-title";
    if (titleWiring && Object.keys(titleWiring.selectors).length) {
      cleanups = buildSelectorTitle(h, doc, spec.title, card, titleWiring);
    } else {
      h.textContent = spec.title;
    }
    titlebar.appendChild(h);
  }
  const logoWrapper = doc.createElement("div");
  logoWrapper.className = "figure-logo";
  logoWrapper.innerHTML = LOGO_SVG;
  titlebar.appendChild(logoWrapper);
  header.appendChild(titlebar);
  if (spec.subtitle) {
    const s = doc.createElement("p");
    s.className = "figure-subtitle";
    s.textContent = spec.subtitle;
    header.appendChild(s);
  }
  card.appendChild(header);
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
