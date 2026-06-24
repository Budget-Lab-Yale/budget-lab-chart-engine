# budget-lab-chart-engine

The Budget Lab chart engine: a config-driven, Style-Guide-themed engine for building
interactive charts that are tested and locked before release, then embedded in publications.

Extracted and generalized from the AI Labor Market Tracker's renderer (Observable Plot + D3).
This repo is **the tool**; chart content lives in a separate archive repo (`budget-lab-charts`)
that pins a version of this engine.

> Status: line, grouped/stacked bar, and small-multiples chart types, with interactive
> crosshair/legend, axis titles, PNG/SVG export, schema validation, and a
> `validate`/`render`/`serve`/`snapshot` CLI — implemented and tested. Distributed via git tag
> (see Install). The figure-number eyebrow is supplied at embed time, not in the chart spec.

## What's here

| Path | Purpose |
|---|---|
| `src/engine/` | Pure, framework-free chart engine: `spec + data + theme → SVG`. Headless-safe. |
| `src/data/` | Data loading + normalization to one tidy long format (local CSV, remote URL/JSON). |
| `src/spec/` | `ChartSpec` type + ajv schema + validation (one chart = one spec). |
| `src/theme/` | `tokens.ts`, **generated** from the Style-Guide `palette/colors.json` (single source of truth). |
| `src/embed/` | Web component + iframe page (shared versioned engine bundle) + standalone/PNG/SVG export. |
| `src/cli/` | `tbl-chart` CLI: `validate`, `render`, `serve`, `snapshot` (implemented); `new`, `catalog` (planned). |
| `src/snapshot/` | Headless-Chromium PNG render + pixel-diff harness (the visual locking gate). |
| `scripts/` | `sync-theme.mjs` (colors.json → tokens.ts), `gen-assets.mjs` (logo/font → assets.ts), `build.mjs` (esbuild). |
| `style-guide/` | Vendored Style-Guide build inputs only: `logos/` (logo SVG/PNG) + `palette/` (colors.json/css). The full Style-Guide (chart-type specs, conventions, etc.) lives in `Budget-Lab-Yale/Style-Guide`. |

## Toolchain

Node + TypeScript, esbuild (build), vitest (tests), ajv (schema), Playwright (snapshots — added
with the snapshot harness). Observable Plot + D3 are vendored under `src/engine/vendor/` and
shipped as part of the engine bundle (zero runtime npm deps in the browser output).

## Install (as a dependency)

Distributed by **git tag** — no registry / `write:packages` needed. The `prepare` script
builds `dist/` on install (the committed `tokens.ts` + vendored Plot/D3 mean no extra setup
is required):

```sh
npm install github:Budget-Lab-Yale/budget-lab-chart-engine#v0.1.0
```

The archive repo (`budget-lab-charts`) pins a specific tag this way.

```js
import { renderChart } from "budget-lab-chart-engine";          // pure engine (browser-safe)
import { validateChart } from "budget-lab-chart-engine/spec";    // ajv validation (Node)
import { loadData }     from "budget-lab-chart-engine/data";      // CSV/remote → tidy rows (Node)
```

## Use (CLI)

```sh
tbl-chart validate <chart.yaml>            # structural + cross-ref + CSV checks
tbl-chart render   <chart.yaml> -o out.html # self-contained interactive chart
tbl-chart serve    [dir] [--port 5173]      # local review gallery of every chart.yaml under dir
tbl-chart snapshot <chart.yaml> [--update]  # headless-Chromium PNG vs baseline (visual lock)
```

## Develop

```sh
npm install
npm run sync-theme       # regenerate src/theme/tokens.ts + TOKENS_CSS from style-guide/palette (or pass an upstream colors.json path)
npm run typecheck
npm test                 # vitest (browser-free)
npm run build
npm run snapshot:selftest # Chromium determinism check (requires `npx playwright install chromium`)
```

## Releasing

Bump `version` in `package.json`, commit, then tag and push:

```sh
git tag vX.Y.Z && git push origin vX.Y.Z
```

Consumers install that tag; the `prepare` script rebuilds `dist/` from the tagged sources.
