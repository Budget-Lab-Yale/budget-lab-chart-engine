// The live chart card's legend DOM: the top legend slot, and the right-legend column the canvas
// moves into beside a right legend. Moved from mountChart's draw() in render-live.ts. Live DOM only:
// the PNG export lays its legend out itself (legendInRightColumn, legend-layout.ts).
import type { LegendHandle } from "../legend.js";
import type { LegendItem, ShapeLegendItem } from "../legend-items.js";
import { orderForRightLegend } from "../legend-layout.js";

export interface LegendSlots {
  /** Take down the right-legend column (its legend with it) and put the canvas back in the card. */
  dropRightColumn(): void;
  /** Lay out one draw's legend at `legendPos` and build it with `render` (renderLegend with that
   *  draw's options). Returns the legend handle, or null when the draw has no legend. Returns at
   *  once when `isDisposed()` turns true after `render` (a legendKey hook tore the mount down); the
   *  caller checks the same flag on return. */
  place(args: {
    legendPos: "top" | "right";
    /** The legend position of the last successful draw, null before the first. */
    currentLegendPos: "top" | "right" | null;
    legendItems: LegendItem[] | null | undefined;
    shapeLegendItems: ShapeLegendItem[] | null | undefined;
    legendVisualOrder: string[] | undefined;
    isTimeline: boolean;
    render: (slot: HTMLElement, items: LegendItem[]) => LegendHandle | null;
    isDisposed: () => boolean;
  }): LegendHandle | null;
}

export function createLegendSlots(
  doc: Document,
  card: HTMLElement,
  canvasScroll: HTMLElement,
  legendSlot: HTMLElement,
): LegendSlots {
  // Right-legend slot — created lazily when the right-legend layout is activated.
  let rightLegendSlot: HTMLElement | null = null;

  /** Take down the right-legend column (its legend with it) and put the canvas back in the card. */
  const dropRightColumn = (): void => {
    if (!rightLegendSlot) return;
    const bodyWrapper = rightLegendSlot.parentElement as HTMLElement;
    card.insertBefore(canvasScroll, bodyWrapper);
    bodyWrapper.remove();
    rightLegendSlot = null;
  };

  const place: LegendSlots["place"] = ({
    legendPos, currentLegendPos, legendItems, shapeLegendItems, legendVisualOrder, isTimeline,
    render, isDisposed,
  }) => {
    let legendHandle: LegendHandle | null = null;
    // A resize below LEGEND_RIGHT_MIN_CARD_WIDTH moves the legend to the top (and a timeline's can
    // vanish), so take down a right column this draw does not use; a later right-legend draw
    // rebuilds it (the guard below). Left standing, the narrow draw kept the chart squeezed beside a
    // stale column under a second, top legend, and the next wide draw threw NotFoundError: its
    // rebuild inserts relative to canvasScroll, which was still inside the old wrapper.
    if (rightLegendSlot) {
      const hasLegend = !!legendItems || !!(shapeLegendItems && shapeLegendItems.length);
      if (legendPos !== "right" || !hasLegend) dropRightColumn();
    }
    if (legendItems || (shapeLegendItems && shapeLegendItems.length)) {
      if (legendPos === "right") {
        // Activate the right-legend layout on first use (or if switching from top).
        // `!rightLegendSlot` is defensive: a right draw with no legend rows to show takes the top
        // position instead (specPos in render-live.ts), so none records "right" without building
        // the column.
        if (currentLegendPos !== "right" || !rightLegendSlot) {
          // Move canvasScroll into the body wrapper.
          const bodyWrapper = doc.createElement("div");
          bodyWrapper.className = "figure-body--legend-right";
          card.insertBefore(bodyWrapper, canvasScroll);
          card.removeChild(canvasScroll);
          bodyWrapper.appendChild(canvasScroll);
          // Create the right legend slot inside the body wrapper.
          rightLegendSlot = doc.createElement("div");
          rightLegendSlot.className = "figure-legend-slot--right";
          bodyWrapper.appendChild(rightLegendSlot);
          // Top legend slot stays in the DOM but is now empty (no content added).
        }
        // Render the right-side vertical legend with reversed series order.
        const orderedItems = orderForRightLegend(legendItems ?? [], legendVisualOrder);
        rightLegendSlot!.replaceChildren();
        legendHandle = render(rightLegendSlot!, orderedItems);
        if (isDisposed()) return legendHandle; // legendKey tore the mount down
        // Add the vertical-layout class to the rendered legend element (use the handle's
        // element directly rather than re-querying the slot).
        legendHandle?.element.classList.add("tbl-legend--vertical");
        // Ensure top legend slot stays empty.
        legendSlot.replaceChildren();
      } else {
        // Top legend (default behavior — unchanged for non-point charts).
        legendSlot.replaceChildren();
        legendHandle = render(legendSlot, legendItems ?? []);
        if (isDisposed()) return legendHandle; // legendKey tore the mount down
      }
    } else if (isTimeline) {
      // Drawn lanes name the categories and a vertical render may draw one track instead, so a
      // timeline's legend comes and goes on a resize: drop the last draw's.
      legendSlot.replaceChildren();
    }
    return legendHandle;
  };

  return { dropRightColumn, place };
}
