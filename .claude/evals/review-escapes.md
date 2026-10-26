# Review-escape eval set

Known defects in Budget Lab repos, each pinned to the commit that introduced it, for rescoring code
reviewers (the `engine-*` reviewer agents, Codex). Rescore whenever a reviewer's prompt, tools, or
model changes; there is no need to run it otherwise. Compiled 2026-10-26; every introducing commit
was confirmed by reading its diff, not its message.

## How to score

For each case, review `base..introducing` with the reviewer under test, giving it only the commit
message as the stated intent and the invariants as they stood at the base (see below). A hit is a
Critical or Important finding that names the defect in the "should have flagged" entry; a Minor, or
a finding in the right class that misses the specific failure, is a partial. Record hits, partials,
misses, and the count of other findings per case, with the date, reviewer, and model, in the table
at the end of this file.

How the 2026-10-26 baseline was run, to keep later runs comparable:
- One detached worktree per case at the introducing commit, created **outside** this repo (e.g.
  `C:\dev\GitHub\.eval-wt\<id>`), so the current `CLAUDE.md`/`AGENTS.md` cannot load by walking up
  from the files the reviewer reads. Remove them afterwards with `git worktree remove`.
- The dispatch names the worktree, BASE and HEAD, forbids reading anything later than HEAD (other
  checkouts, `git log --all`, later commits), and points at a copy of the current `Review rules`
  section of `AGENTS.md`. The rules name bug classes, not these bugs, so they are part of the
  reviewer under test; the `Hard invariants` are not passed, because they name some of these bugs.
- Scored here: the 8 engine cases with `engine-reviewer`. The charts and interactives cases have no
  reviewer agent of their own yet; score them with Codex or a general reviewer.

## Contamination warning (read before scoring)

Several of these defects have since been written into the repos' own invariants, so pasting the
*current* invariants into a review prompt hands the reviewer the answer:

- engine `AGENTS.md` names `method: "poly"` on temporal axes and the five CONFIG-SPEC false claims.
- charts `CLAUDE.md` names `loading="lazy"` on the embed iframe and `navy` as a series colour.

For a fair score, paste the invariants **as of the base commit**, or none, and record which. The
engine's "Hard invariants" section first appeared in `CLAUDE.md` in c9d3a16 (2026-08-20), so every
engine base here except f12-* had no invariants section. The f12-* bases (2026-10-06) have one that
predates the F12 lessons.

## Summary

| id | repo | base..introducing | fix | bug class | catchable | conf. |
|---|---|---|---|---|---|---|
| poly-temporal-singular | engine | c731f0d..e8ccf92 | 18f3c82 | dimensionally wrong numeric tolerance | yes, with numeric reasoning | high |
| poly-tolerance-refix | engine | 51b0c66..6f56c78 | 18f3c82 | a "fix" that keeps the defect | yes, with numeric reasoning | high |
| spec-blank-column-break | engine | 0c3c4f4..2c7007f | 0266927 | docs claim the code doesn't honour | repo context (overlays.ts) | high |
| coord-echo-bare-year | engine | a83b87a..f26004e | c9104f2 (v1.16.3) | type sniffed from raw cell instead of declared axis type | repo context (parseDate accepts bare YYYY) | high |
| stagger-fp-hang | engine | 05c7ff6..b6cdaf9 | 8a631aa (v1.6.1) | non-terminating loop on float equality | yes | high |
| pane-widths-export | engine | 8c613c3..629261f | 28ae463 | live-only change missing from PNG export | repo context (export caller) | high |
| f12-dup-order-markers | engine | 296a537..23eab67 | f6cd7b0 (revert of fix 3 is f6d5dab) | indexOf on a list that can hold duplicates | repo context (schema allows dupes; Plot dedups) | medium-high |
| f12-normaliser-bypass (control) | engine | f6d5dab..f6cd7b0 | fc74386 | guard removed while a public entry point bypasses the replacement | yes | high |
| embed-lazy-iframe | charts | 8d6c7d9..bfbba6d | 82e1f84 | consumer-environment regression | repo context (non-scrolling PDF/scraper consumers) | high |
| embed-snapshot-selector | interactives | (root)..9bb55440 | none, OPEN | unescaped user string in CSS selector | yes | high |

The control case was caught at the time (by Codex and by the Claude re-reviewer), so it measures
recall on a known-catchable defect, not an escape.

---

## Engine (budget-lab-chart-engine)

### poly-temporal-singular

- **Introducing:** e8ccf92 "feat: add bivariate least-squares fitting for overlays" (2026-08-18), base c731f0d. Branch `feat/barstack-hover-and-overlays`, merged as PR #31 (v1.12.0).
- **Fix:** 18f3c82 "fix: make the fit's singularity test dimensionless" (2026-08-20), same branch, so it never shipped.
- **Bug class:** dimensionally wrong numeric tolerance. A singularity test compares quantities of different units.
- **Should have flagged:** `src/engine/fit.ts:47-49` (in `invert`): `scale = max(1, |row entries|)`, then `|pv| < 1e-12 * scale`. XᵀX columns scale as different powers of the x-spread `a`. On a temporal axis x is epoch ms, so `a` is huge and every degree ≥ 2 design is declared singular. The commit's own header comment says x is "year/epoch-scale".
- **Failure:** an overlay with `method: poly, degree: 2` on any `xAxisType: temporal` chart spanning more than about 12 minutes makes `fitPoly` return null, and nothing is drawn, silently. `lm` (degree 1) and numeric year x still work.
- **Catchable:** yes from the diff, but it takes numerical reasoning about unit scaling. Tests in the commit used small-scale x only.
- **Evidence:** a probe (not committed) ran each revision's `fitPoly` on 20 points spanning 1 h, 30 d and 10 y of epoch ms, and on bare years. At e8ccf92 and 6f56c78, degrees 2 and 3 return NULL on all three temporal spans, and degree 1 and numeric years return ok. At 18f3c82 every case returns ok. Confidence high.

### poly-tolerance-refix

- **Introducing:** 6f56c78 "fix: make invert()'s pivot tolerance genuinely scale-relative" (2026-08-18), base 51b0c66. Same branch and PR.
- **Fix:** 18f3c82.
- **Bug class:** a fix that keeps the defect. It changed the tolerance to a per-column maximum of the original matrix (`fit.ts:44-57`, `colScale`), which is still dimensionally wrong: an ~a⁴ column scale is used to judge an ~a² pivot.
- **Failure:** the same as above. The probe gives identical NULLs at 6f56c78.
- **Catchable:** yes from the diff. This is a good second test of the same reasoning, because the diff is small and entirely about the tolerance.
- **Evidence:** the same probe. Confidence high.

### spec-blank-column-break

- **Introducing:** 2c7007f "docs: document the overlays block" (2026-08-18), base 0c3c4f4. PR #31.
- **Fix:** 0266927 "fix: a blank `column` overlay cell breaks the line, as documented" (2026-08-20). The code changed to match the doc.
- **Bug class:** the docs claim behaviour the code does not have (CONFIG-SPEC is vendored into budget-lab-charts and gated there, which makes this a shipped defect).
- **Should have flagged:** `CONFIG-SPEC.md:432` (at 2c7007f): "A blank cell is treated as absent, not as zero, so a sparse column breaks its line." At the same tree, `src/engine/overlays.ts:260` does `if (... y == null || !Number.isFinite(y)) continue;`, which skips the row so its neighbours join.
- **Failure:** `overlays: [{column: proj}]` where `proj` is blank in 2023 draws a straight segment from 2022 to 2024, a line through data the column never claimed, instead of a gap.
- **Catchable:** only with repo context. The docs-only diff has to be checked against `overlays.ts` at the base. This is the clearest of the "five false claims" (#3 in the 1.12.0 list). The other four involve hover-path reachability (`tbl-coord-pill` on dumbbells, `chrome.valuePills` scope), and their introducing sentences were partly re-false after the first correction (f3812f5), so they are worse eval material.
- **Evidence:** read `git show 2c7007f:CONFIG-SPEC.md` and `git show 2c7007f:src/engine/overlays.ts`. The skip was introduced in 84f7272, before the doc, and the fix diff replaces exactly that `continue`. Confidence high.

### coord-echo-bare-year (v1.16.3)

- **Introducing:** f26004e "Polish coordinated cursor: pill offset, color-match, axis-matched x label" (2026-06-23), base a83b87a. Landed via PR #1.
- **Fix:** c9104f2 (PR #45, v1.16.3, 2026-10-09).
- **Bug class:** the type is sniffed from the raw cell instead of the declared axis type, and the fallback prints an internal value.
- **Should have flagged:** `src/engine/crosshair.ts:1426` `const isDate = /^\d{4}-\d{2}-\d{2}/.test(sampleX);` and the `else` at `:1463-1464`, `String(nx)`. At this tree `parse-time.ts` `parseDate` falls back to `new Date(s)`, so a bare `"2020"` is a valid temporal x, but it fails the sniff.
- **Failure:** a small-multiples line chart with `xAxisType: temporal` and x = `2020, 2021, ...`. Hovering a pane makes the active pane's axis echo print `1577836800000` instead of `2020`.
- **Catchable:** only with repo context: that temporal x accepts bare YYYY (`parse-time.ts`), and that `xAxisType` is the declared signal. The `parse-time.ts` header already calls ad-hoc regexes in the crosshair a problem it was meant to remove.
- **Evidence:** read f26004e's `crosshair.ts` (the sniff, then the `String(nx)` fallback) and `parse-time.ts`. The fix diff replaces exactly the sniff with `opts.xAxisType`. Confidence high.

### stagger-fp-hang (v1.6.1)

- **Introducing:** b6cdaf9 "Coordinated cursor: match axis-label state + de-collide bar value labels" (2026-06-24), base 05c7ff6. Landed via PR #1.
- **Fix:** 8a631aa (PR #17, v1.6.1, 2026-07-21).
- **Bug class:** a non-terminating loop that depends on float equality.
- **Should have flagged:** `src/engine/crosshair.ts:1495`: `if (horiz && Math.abs(y - out[j]!) < pad) { y = out[j]! + pad; moved = true; }` inside `while (moved)`. `(out[j] + pad) - out[j]` can be `pad - ε`, so the test stays true, `y` is reassigned to the same value, and the loop never exits.
- **Failure:** two or more colliding bar value pills with `out[j] = 55.908811709466455`, `pad = 16` (captured from a hung State of Tariffs tab) freeze the browser tab on hover or on legend selection.
- **Catchable:** yes from the diff alone. A random check: about 2% of `o ∈ [0, 1000)` give `(o + 16) - o < 16`.
- **Evidence:** read the loop in b6cdaf9 and the fix's regression values, and reproduced the float condition in node. Confidence high.

### pane-widths-export

- **Introducing:** 629261f "feat(figure): variable pane widths for faceted charts (small_multiples.pane_widths)" (2026-07-01), base 8c613c3. PR #6 (v1.2.1).
- **Fix:** 28ae463 "Export: lay out panes at their pane_widths widths" (2026-10-12, PR #46, v1.17.0).
- **Bug class:** a live-only change missing from the PNG export.
- **Should have flagged:** `src/engine/figure.ts:135` adds a `weights?` parameter to `sharedColumnWidths`, and `renderFigure` passes `colWeights`. The other caller, `src/embed/export-png.ts:264-266` (not in the diff), still calls `sharedColumnWidths(INNER_W, cols, COL_GAP)` with no weights and places each pane in an equal cell. The commit message says "Live grid + PNG export consume the resulting column widths unchanged", which is false.
- **Failure:** a faceted bar chart with `pane_widths: "equal-bar"` (or `[2,1]`). Live, the bars are equal width across panes. In the PNG, each pane's SVG (rendered at its weighted width) is scaled into an equal-width cell, so bar widths differ per pane, which defeats the feature.
- **Catchable:** only with repo context: the hard invariant "the PNG export re-renders from the spec" (not in AGENTS.md at that base), plus a grep for other callers of the changed function.
- **Evidence:** read `git show 629261f:src/embed/export-png.ts` lines 255-300 (unweighted call; `colWidth` used for cell width) and the `figure.ts` diff. The fix makes `colWidth` read `fig.columnWidths`. Confidence high on the defect. The visual failure was not re-rendered at 629261f.

### f12-dup-order-markers (lead #1 retargeted)

- **Introducing:** 23eab67 "F12: pane point markers follow the figure legend" (2026-10-06), base 296a537. Branch `feat/treemap`, PR #42 (v1.16.0). It never shipped.
- **Fix:** f6cd7b0 (F12 fix 4: duplicates rejected by schema, and deduped at entry points). The attempted fix 798611b was reverted by f6d5dab.
- **Bug class:** `indexOf` lookup into a list that can hold duplicates, feeding a scale that dedups its domain.
- **Should have flagged:** `src/engine/theme.ts:93` `markerSymbolForSeries` (`order.indexOf(series)`), used at `marks/line.ts:307` and `marks/point.ts:44` to build `range` parallel to a domain. `figure.ts:401` builds `figureSeries` from `series_order` without deduping, and the schema had no `uniqueItems`.
- **Failure:** a faceted line chart with `points: true` and `series_order: [M, M, N]`. Pane domain [M, M, N] gives range [circle, circle, triangle]. Plot keeps distinct [M, N] paired with range[0..1], so N draws a circle (M's symbol) while the legend keys N differently. Before F12 the range was [0, 1, 2], so M was a circle and N a square.
- **Catchable:** only with repo context: that `series_order` may repeat entries (the schema at base), and that Plot's ordinal scale pairs the k-th *distinct* domain value with `range[k]`. It escaped the F12 review, Codex f12, and two fix-round reviews (ledger `.superpowers/sdd/treemap-plan/progress.md` ~l.410-430). It surfaced as Ruling 65 after fix round 2.
- **Why not "F12 fix 3" itself:** 798611b had no defect of its own. It reproduced pre-F12 output for duplicates at +423/-27 lines (including the pre-existing duplicate legend rows). Sylva chose to reject duplicates instead (Ruling 66), so the revert reverses a design choice. It is not a review escape.
- **Evidence:** read the 23eab67 diff (`theme.ts`, `line.ts`, `point.ts`) and `figure.ts:401` at 23eab67, the 798611b message and `markerSymbolRange` comment (which describes Plot's dedup pairing), and the ledger. The Plot pairing claim comes from 798611b's comment and tests and was not independently re-run. Confidence medium-high.

### f12-normaliser-bypass (control: caught at the time)

- **Introducing:** f6cd7b0 "F12 fix 4: a repeated series_order/shape_order entry is an author error", base f6d5dab. PR #42.
- **Fix:** fc74386 "F12 fix 5: exported renderers drop repeated order entries themselves".
- **Bug class:** a defensive guard removed while a public entry point bypasses its replacement.
- **Should have flagged:** `src/engine/marks/stacked.ts:166` (the `new Set(seriesNames).size` became `seriesNames.length`) and `marks/treemap.ts:146` (the `new Set(series_order)` was dropped). Dedup was added only in renderChart, renderFigure, mountChart and buildExportSvg, while `renderPane` (`src/engine/index.ts:370`) and `renderTreemap` are exported and skip it.
- **Failure:** `renderPane` on a stacked spec with `series_order: [A, A]` draws two net dots. `renderTreemap` with `[A, A, B]` gives 3 legend rows and a colour shift.
- **Catchable:** yes from the diff, which removes the guards and names the four entry points. Codex f12fix4 rated it IMPORTANT and the Claude re-reviewer noted it too. Use it as a recall control.
- **Evidence:** read the f6cd7b0 diff of `stacked.ts` and `treemap.ts`, `renderPane` export at f6cd7b0, the fc74386 stat and message, and the ledger. Confidence high.

---

## Charts (budget-lab-charts)

### embed-lazy-iframe

- **Introducing:** bfbba6d "Self-contained chart embed framework (embed/v1) (#2)" (2026-06-24), base 8d6c7d9.
- **Fix:** 82e1f84 "Load chart embed iframes eagerly (#64)" (2026-09-17).
- **Bug class:** a regression in the consumer's environment: an optimisation that assumes a scrolling human viewer.
- **Should have flagged:** `embed/v1/embed.js:44` `iframe.loading = 'lazy';`.
- **Failure:** a 13-figure article rendered by a non-scrolling consumer (Doppio PDF build via headless `page.pdf()`, card scrapers) renders 1 of 13 figures, and the rest are empty 100px boxes. `networkidle` fires before most iframes request anything. It reaches every published embed at once, because all snippets load the one `/embed/v1/embed.js`.
- **Catchable:** only with repo context: that the embeds are consumed by PDF builders and scrapers, not only browsers. A strong general reviewer might raise lazy-iframe and headless-render behaviour without it.
- **Sibling:** budget-lab-interactives has the same line from its root commit 9bb55440, fixed in 9f03d2fd (2026-09-17). The charts loader's header says it "Mirrors the budget-lab-interactives embed loader".
- **Evidence:** read `git show bfbba6d:embed/v1/embed.js` (line 44) and the 82e1f84 diff and message (measurements). Confidence high.

---

## Interactives (budget-lab-interactives)

### embed-snapshot-selector (still OPEN)

- **Introducing:** 9bb55440 "Initial release (v1.0.0)" (2026-05-11). This is the root commit, so there is no parent. Scope the eval diff to `embed/v1/embed.js` and `README.md`.
- **Fix:** none. Still present on `origin/main` (`embed/v1/embed.js:37`) as of 2026-10-26.
- **Bug class:** an unescaped user-supplied string interpolated into a CSS selector.
- **Should have flagged:** `embed/v1/embed.js:37` `iframe.id = 'tbl-embed-' + tool + '-' + rand` and `:77` `iFrameResize({...}, '#' + iframe.id)`. The vendored iframe-resizer runs `document.querySelectorAll(target)` on a string target. The same commit's `README.md:68` documents `data-tool="deficits-affordability/versions/2026-05-11"`, which contains `/`.
- **Failure:** the README's snapshot snippet makes `querySelectorAll('#tbl-embed-deficits-affordability/versions/2026-05-11-ab12cd')` throw SyntaxError ("not a valid selector"). The iframe never resizes and stays at 100px. Every snapshot embed is affected, and canonical (slash-free) embeds are fine.
- **Catchable:** yes from the diff alone (snippet and selector are in the same commit). The charts loader shows the correct pattern: `chart.replace(/[^a-z0-9]+/gi, '-')`.
- **Evidence:** read `git show 9bb55440:embed/v1/embed.js` (lines 37 and 77) and `README.md:68`, grepped `iframeResizer.min.js` for `querySelectorAll(n||"iframe")`, and checked `origin/main`. The SyntaxError itself was not re-run here: it is from the 2026-10-08 reproduction in memory (`embed-snapshot-resize-bug.md`). Confidence high.
- **Note:** this repo's working tree is on `blsmm` with uncommitted edits to `embed.js`, which were not touched.

---

## Leads dropped

- **#1 F12 fix 3 revert (798611b / f6d5dab):** a design reversal, not a defect. Retargeted to the underlying defect in 23eab67 (above).
- **#5 charts #73 revert of #71 (ecec-macro):** PR body: "Reverts #71, which was merged early." A process error. #71's content was re-landed as #74 after the 1.16.3 repin (#75). There is no code defect to review.
- **#7 `navy` series colour:** no commit on any branch of budget-lab-charts sets a series colour to `navy` (`git log --all -G navy` over `charts/` hits only the gate PR #62 and Pages deploy commits). The figure was probably in untracked `charts/trackers/` or never committed, so it cannot be pinned. The gate (e5f1f46, PR #62) exists, but there is no introducing diff to score against.
- **v1.16.2 (2fa69f7):** a design change (cells painted `--tbl-bg` became transparent, to match charts), not a defect with an introducing commit.
- **v1.16.1 (65404b8):** three table fixes (mid-word split under a `column_width` cap, glyph wrapping, inline-math fragments in PNG). Each is long-standing layout behaviour, and none was pinned with confidence. The inline-math PNG leak could be pursued later.
- **v1.8.1:** reversed value axis was "never a declared feature". The `[lo, hi]` assumption is spread over many commits (five domain branches), so there is no single introducing commit.
- **v1.4.1:** layout polish and responsive export height. There is no single introducing defect.

## Scores

| date | reviewer | model | hits | partials | misses | other findings | notes |
|---|---|---|---|---|---|---|---|
| 2026-10-26 | engine-reviewer | claude-opus-5-5 | 6 / 8 | 2 | 0 | 18 (not triaged) | baseline; 1.7-3.4 min per case |

2026-10-26 per case:
- poly-temporal-singular: **hit** (Important, with an epoch-ms probe). Other: 0.
- poly-tolerance-refix: **hit** (Important: tolerance still depends on x units; epoch-ms noted as
  still failing). Other: 1 Minor.
- spec-blank-column-break: **hit** (Important). Other: 2 more false CONFIG-SPEC sentences in the same
  class, 3 Minor. These look like the other 1.12.0 false claims and are probably real.
- coord-echo-bare-year: **partial**. Important finding in the right class (axis format sniffed from
  the raw string instead of the declared axis), with year-only and quarterly scenarios, but not the
  bare-year x printing epoch ms. Other: 3 Minor.
- stagger-fp-hang: **hit** (Critical, with a probe). Other: 1 Important, 2 Minor.
- pane-widths-export: **hit** (Critical, with the unweighted export caller). Other: 2 Important, 2
  Minor, 1 Pre-existing.
- f12-dup-order-markers: **hit** (Important, confirmed against vendored Plot). Other: 1 Important.
- f12-normaliser-bypass (control): **partial**. Found the `renderPane` bypass in `stacked.ts` but
  graded it Minor because `renderPane` is undocumented, and judged the treemap path safe. Codex rated
  it Important at the time. Other: 1 Minor.

Caveat: these were single-commit reviews with the current review rules and a current model. Most of
the original escapes were reviewed by older models without review rules, so the comparison is with
the reviewer as configured now, not with the original review.
