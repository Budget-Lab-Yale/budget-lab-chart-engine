// Browser IIFE entry point. esbuild builds this with `format: "iife"` +
// `globalName: "BudgetLabChart"`, so the module's exports become the global
// `BudgetLabChart` object — letting the standalone HTML call
// `BudgetLabChart.mountChart(el, { spec, rows })`.
//
// NOTE: export here rather than assigning to globalThis. The globalName wrapper
// assigns the module's exports to `var BudgetLabChart`, which would clobber any
// manual globalThis assignment with the (then-empty) exports object.
export { mountChart } from "../engine/render-live";
