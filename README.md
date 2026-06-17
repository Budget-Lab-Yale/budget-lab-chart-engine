# tbl-chart-engine

The Budget Lab chart engine: a config-driven, Style-Guide-themed engine for building
interactive charts that are tested and locked before release, then embedded in publications.

Extracted and generalized from the AI Labor Market Tracker's renderer (Observable Plot + D3).
This repo is **the tool**; chart content lives in a separate archive repo (`tbl-charts`) that
pins a version of this engine.

> Status: scaffolding. See the implementation plan for the full design.

## What's here

| Path | Purpose |
|---|---|
| `src/engine/` | Pure, framework-free chart engine: `spec + data + theme → SVG`. Headless-safe. |
| `src/data/` | Data loading + normalization to one tidy long format (local CSV, remote URL/JSON). |
| `src/spec/` | `ChartSpec` type + ajv schema + validation (one chart = one spec). |
| `src/theme/` | `tokens.ts`, **generated** from the Style-Guide `palette/colors.json` (single source of truth). |
| `src/embed/` | Web component + iframe page (shared versioned engine bundle) + standalone/PNG/SVG export. |
| `src/cli/` | `tbl-chart` CLI: `new`, `validate`, `render`, `snapshot`, `build`, `catalog`, `serve`. |
| `scripts/` | `sync-theme.mjs` (colors.json → tokens.ts), `build.mjs` (esbuild). |
| `style-guide/` | Git submodule → `Budget-Lab-Yale/Style-Guide` at a pinned SHA (added during setup). |

## Toolchain

Node + TypeScript, esbuild (build), vitest (tests), ajv (schema), Playwright (snapshots — added
with the snapshot harness). Observable Plot + D3 are vendored under `src/engine/vendor/` and
shipped as part of the engine bundle (zero runtime npm deps in the browser output).

## Develop

```sh
npm install
npm run sync-theme   # regenerate src/theme/tokens.ts from the Style-Guide submodule
npm run typecheck
npm test
npm run build
```
