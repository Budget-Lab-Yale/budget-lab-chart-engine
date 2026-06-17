// Single import site for the vendored Observable Plot + D3 bundles. Everything in
// the engine imports Plot / d3 from here so the pinned versions live in exactly one
// place (and a future swap touches one file).
import * as Plot from "./vendor/plot-0.6.16.esm.min.js";
import * as d3 from "./vendor/d3-7.9.0.esm.min.js";

export { Plot, d3 };
