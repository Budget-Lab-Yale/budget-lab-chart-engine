import { defineConfig } from "vitest/config";

// Pin the test timezone to UTC. The engine's temporal axis uses local-time d3 (timeMonth /
// timeFormat), so interior month ticks shift by the host's DST offset — golden SVG baselines
// generated in one timezone won't match another. UTC is the right reference: production charts
// are rendered in CI (UTC), so UTC baselines match deployed output and are reproducible on every
// host. Set before workers fork so they inherit it; also pinned via test.env as a belt-and-suspenders.
process.env.TZ = "UTC";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // vitest 5 schedules workers more aggressively; the CPU-heavy property tests (treemap, timeline
    // layout) exceeded the 5s default under full-suite load though each passes alone in seconds.
    testTimeout: 15000,
    // Never write snapshots silently: vitest's default ("new") writes any golden that is missing and
    // passes, so a deleted or misnamed golden looks green locally. With "none" it fails, as in CI.
    // To record a NEW golden on purpose: `npm run goldens:record` (see scripts/goldens.mjs).
    update: "none",
    globalSetup: ["./test/setup/global-build.ts"],
    env: { TZ: "UTC" },
  },
});
