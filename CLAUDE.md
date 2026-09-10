# budget-lab-chart-engine

The chart engine: the tool that renders Budget Lab figures. Content (chart specs + data) lives in
`budget-lab-charts`, which pins a tagged version of this repo.

- **Schema**: `CONFIG-SPEC.md` is the authority for figure config. `budget-lab-charts` vendors it
  verbatim at its pinned version and gates it in CI, so a change here reaches authors only when they
  repin — and this file's contents must stay accurate to what the code accepts.
- **Releasing**: bump `version` in `package.json`, commit, tag `vX.Y.Z`, push the tag. A repin
  re-renders every figure in the archive, so a change to a default or a renamed field lands across
  all published figures at once, not just in new ones. Note it in `CHANGELOG.md`.
- **No design docs or plans in this repo.** There is no `docs/` folder, and adding one back for a
  spec or an implementation plan is wrong — nine such files accumulated here describing features
  that had already shipped (histogram, dumbbell, value affixes, shading, reversed axis, annotation
  legend and rug), carrying 81 unchecked task boxes and none checked. Rationale for a change goes in
  the PR description, transient plans stay in the session scratchpad, and invariants go in a comment
  where they apply. See the global policy in `~/.claude/CLAUDE.md`.

## Hard invariants

Constraints that no single file states and that a reviewer cannot infer from a diff. **A violation of
any of these is a top-severity finding, not a nitpick.** Paste this section verbatim into code-review
prompts (see the `gpt-review` skill). Add to it when a bug or a review reveals a new one.

- **No `eval`, no `new Function`, anywhere.** The engine bundles into standalone HTML served under a
  strict CSP. The `overlays[].fun` grammar is *parsed and interpreted* (`src/spec/expr.ts`); it is
  never evaluated. (Plot's vendored DSV code contains a textual `new Function` the engine never
  reaches — do not "fix" it, and do not cite it as precedent.)
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
  import `annotation-legend.ts` (it reports `keyed: boolean`; the caller mints the key).
- **HTML injected into an SVG lands in the XHTML namespace and does not rasterise.** Markup helpers
  come in pairs for this reason (`legendRowMarkup` / `legendRowMarkupSvg` in `src/engine/icon.ts`), and
  hook contexts carry `medium: "html" | "svg"` so a consumer can branch. Screen-only correctness here
  is a silent divergence in the download.
- **A green suite is not evidence a feature works.** Goldens catch regressions and are silent on
  behaviour that was wrong from its first commit — `method: "poly"` drew nothing on any temporal axis
  through 2219 passing tests. New behaviour needs a test that would fail if the feature did nothing.
