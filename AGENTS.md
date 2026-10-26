# budget-lab-chart-engine

The TypeScript engine that renders Budget Lab figures. Content (chart specs + data) lives in
`budget-lab-charts`, which pins a tagged version of this repo and re-renders its whole archive on a
repin. `CONFIG-SPEC.md` is the authority for figure config.

Checks: `npx tsc --noEmit`, `npm run goldens` (verifies goldens, cannot write them), `npm test`.

## Hard invariants

Constraints that no single file states and that a reviewer cannot infer from a diff. **A violation of
any of these is a top-severity finding, not a nitpick.** Paste this section verbatim into code-review
prompts (see the `gpt-review` skill). Add to it when a bug or a review reveals a new one.

- **No `eval`, no `new Function` in shipped code** — `src/` and everything bundled from it (`dist/`,
  standalone HTML). The engine bundles into standalone HTML served under a strict CSP. Test harnesses
  that execute generated page scripts inside jsdom (`test/serve.test.ts` `runOpenAll`) are outside
  it: the invariant exists for the CSP of published pages. The `overlays[].fun` grammar is *parsed
  and interpreted* (`src/spec/expr.ts`); it is never evaluated. (d3's vendored DSV code in
  `src/engine/vendor/` contains a textual `new Function` the engine never reaches — do not "fix" it,
  and do not cite it as precedent.) Gated for `src/` and for the inline scripts of a standalone page
  by `test/invariants-scan.test.ts`.
- **Rendered output must stay byte-identical for every pre-existing spec, except by a named
  exception.** Golden SVG tests enforce it. A repin re-renders the entire published archive, so an
  unconditional behaviour change alters already-published figures at once. **A moved golden means
  something fires that should be gated — diagnose it; never re-record to make the suite pass.**
  A defect fix may change rendered output, and some have, but only when all three hold: every
  affected published figure is found by reading the archive's **specs** (not by regexing rendered
  text — read that way, a scan named two colour keys as callout labels and put them in a changelog);
  each is named under **Upgrading** with what moves and why; and **no golden is re-recorded**, so
  either the change is gated or the goldens provably never covered it. A waiver granted without that
  archive scan is not a waiver — that is the gap that left the 1.14.0 axis-domain waiver correct in
  substance but unverified in process.
  Goldens are verified with `npm run goldens`, which cannot write snapshots; a local `npm test` run
  is not evidence that output is unchanged if it could have written one. A new golden is recorded
  only with `npm run goldens:record`.
- **`CONFIG-SPEC.md` is vendored verbatim by `budget-lab-charts` and gated in its CI.** A statement in
  it that the code does not honour is a real defect shipped to figure authors, not a docs nit. Five
  false claims were found in it during 1.12.0, several added in good faith by describing what someone
  believed the code did. Verify a claim with a test before writing it, and **search for the claim's
  text, not its line number** — the same promise is asserted in more than one place.
- **The PNG export re-renders from the spec** (`buildExportSvg` in `src/embed/export-png.ts`); it does
  not serialise the live DOM. Anything applied only to live DOM or CSS is silently absent from the
  download. Every render-path feature needs its export path checked, not assumed.
- **Functions cannot cross the publish boundary.** `src/cli/index.ts` → `buildStandaloneHtml`
  JSON-serialises spec and rows into a `<script>`, so hooks are static/build-time and events bubble.
  Nothing callable survives the trip.
- **Module graph:** `src/spec/*` must not import `src/engine/*`. `src/engine/overlays.ts` must not
  import `annotation-legend.ts` (it reports `keyed: boolean`; the caller mints the key). Gated by
  `test/invariants-scan.test.ts`.
- **HTML injected into an SVG lands in the XHTML namespace and does not rasterise.** Markup helpers
  come in pairs for this reason (`legendRowMarkup` / `legendRowMarkupSvg` in `src/engine/icon.ts`), and
  hook contexts carry `medium: "html" | "svg"` so a consumer can branch. Screen-only correctness here
  is a silent divergence in the download.
- **A green suite is not evidence a feature works.** Goldens catch regressions and are silent on
  behaviour that was wrong from its first commit — `method: "poly"` drew nothing on any temporal axis
  through 2219 passing tests. New behaviour needs a test that would fail if the feature did nothing.

## Review rules

For anyone reviewing a change here: Claude reviewer agents, Codex, `/code-review`.

**What failure means in this repo:** an already-published figure changes without a named
**Upgrading** entry; `CONFIG-SPEC.md` says something the code does not do; the PNG export differs
from the live chart. Weight findings by how directly they lead to one of these.

Check, on top of the invariants:
- **Moved goldens.** A changed `*.golden.svg` or export hash pin is a finding unless it is new or the
  brief names it as an approved exception. A re-recorded golden for a pre-existing spec is Critical.
- **Leakage into existing chart types.** New code on the validation or render path of existing chart
  types can change an existing spec's validity or its output. Trace it.
- **`CONFIG-SPEC.md` sentences** the diff adds or changes must match what the code accepts and does.
- **Live vs export.** A render-path change needs `buildExportSvg` checked as well as the live render.
- **Tests that would pass if the feature did nothing.**

Severity and noise:
- **Critical:** an invariant violation, or a defect that changes published output. **Important:** wrong
  or fragile behaviour in the change, a missed requirement, a test that asserts nothing. **Minor:**
  everything else, at most three per review. No style, naming, or formatting findings unless they
  hide a defect.
- Tag a defect the change did not introduce as **Pre-existing**. It does not block the change.
- Name the **class** of each bug and list every instance of it in the diff, so one fix round covers
  them all.
- Every finding needs a file:line from code you read and a concrete failure scenario (input → wrong
  output or crash). Do not infer behaviour from a file or function name. Mark what you could not
  verify as UNVERIFIED.
- A re-review covers the prior findings and the fix diff only. Do not re-report a finding already
  raised, ruled on, or deferred.

Skip: `dist/`, `node_modules/`, `.superpowers/`, `.claude/worktrees/`, `package-lock.json`, and the
minified files in `src/engine/vendor/`. Read golden SVGs only to see which ones changed.

Start the report with a count by severity ("1 Critical, 2 Minor"), or say "No issues found." plainly.
