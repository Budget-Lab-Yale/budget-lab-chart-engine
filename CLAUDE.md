# budget-lab-chart-engine

The chart engine: the tool that renders Budget Lab figures. Content (chart specs + data) lives in
`budget-lab-charts`, which pins a tagged version of this repo.

- **Schema**: `CONFIG-SPEC.md` is the authority for figure config. `budget-lab-charts` vendors it
  verbatim at its pinned version and gates it in CI, so a change here reaches authors only when they
  repin — and this file's contents must stay accurate to what the code accepts.
- **Releasing**: bump `version` in `package.json`, commit, tag `vX.Y.Z`, push the tag. A repin
  re-renders every figure in the archive, so a change to a default or a renamed field lands across
  all published figures at once, not just in new ones. Note it in `CHANGELOG.md`.
  A released entry records what shipped and is never edited afterwards; a correction goes in the
  release that makes it (or `[Unreleased]`), as a line pointing back at the entry it fixes.
- **No design docs or plans in this repo.** There is no `docs/` folder, and adding one back for a
  spec or an implementation plan is wrong — nine such files accumulated here describing features
  that had already shipped (histogram, dumbbell, value affixes, shading, reversed axis, annotation
  legend and rug), carrying 81 unchecked task boxes and none checked. Rationale for a change goes in
  the PR description, transient plans stay in the session scratchpad, and invariants go in a comment
  where they apply. See the global policy in `~/.claude/CLAUDE.md`.
- **Subagents**: dispatch implementers and fixers as `engine-implementer`, first-pass and
  whole-branch reviewers as `engine-reviewer`, and fix-round re-reviewers as `engine-rereviewer`
  (`.claude/agents/`), not `general-purpose`. They carry the repo rules; the dispatch carries the
  task. Sessions started from `C:\dev\GitHub` see them through a junction at
  `C:\dev\GitHub\.claude\agents\chart-engine`.
- **Review rounds must converge.** Only Critical and Important findings open a fix round; Minors and
  Pre-existing findings go on a ledger for the whole-branch review. A re-review covers the fix diff
  only. If a task still has open findings after two re-review rounds, stop and bring it to Sylva
  with the open findings and a question about the approach, rather than a third round.
- **Codex** (`gpt-review`) reviews each task commit alongside the Claude reviewer, and the branch
  again before the PR, but not fix rounds: the `engine-rereviewer` covers those. An audit of 98
  Codex findings (2026-10-26) found per-task Codex runs caught 20 ordinary-input defects the parallel
  Claude reviewer missed, while fix-round runs added one.

## Invariants and review rules

The hard invariants and the review rules live in `AGENTS.md` so Codex reads them too. Edit them
there.

@AGENTS.md
