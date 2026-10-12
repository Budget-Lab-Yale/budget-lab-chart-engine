// Browser IIFE entry point. esbuild builds this with `format: "iife"` +
// `globalName: "BudgetLabChart"`, so the module's exports become the global
// `BudgetLabChart` object — letting the standalone HTML call
// `BudgetLabChart.mountChart(el, { spec, rows })`.
//
// NOTE: export here rather than assigning to globalThis. The globalName wrapper
// assigns the module's exports to `var BudgetLabChart`, which would clobber any
// manual globalThis assignment with the (then-empty) exports object.
//
// buildExportSvg is exposed so a page can render the same export SVG the download button produces
// (e.g. slide frames) from the released bundle, without a second build of the engine.
export { mountChart } from "../engine/render-live";
export { mountTable } from "../table/mount";
export { buildExportSvg } from "./export-png";
