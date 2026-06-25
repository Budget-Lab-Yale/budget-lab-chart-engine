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
    environmentMatchGlobs: [["test/table/dom/**", "jsdom"]],
    globalSetup: ["./test/setup/global-build.ts"],
    env: { TZ: "UTC" },
  },
});
