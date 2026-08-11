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
