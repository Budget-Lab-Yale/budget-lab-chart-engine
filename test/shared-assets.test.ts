/**
 * Tests for src/embed/shared-assets.ts — the naming contract between `tbl-chart assets` (which
 * writes the files) and buildStandaloneHtml (which links them). If these two ever disagree, every
 * published page 404s its runtime, so the names are pinned here.
 */

import { describe, it, expect } from "vitest";
import {
  buildSharedStylesheet,
  joinAssetUrl,
  runtimeAssetName,
  sharedAssetRefs,
  stylesAssetName,
} from "../src/embed/shared-assets";

describe("shared asset names", () => {
  it("carry the engine version, so a page never silently gets a different runtime", () => {
    expect(runtimeAssetName("1.9.0")).toBe("engine-1.9.0.js");
    expect(stylesAssetName("1.9.0")).toBe("chart-1.9.0.css");
  });

  it("change with the version", () => {
    expect(runtimeAssetName("1.10.0")).not.toBe(runtimeAssetName("1.9.0"));
  });
});

describe("joinAssetUrl", () => {
  it("inserts exactly one slash", () => {
    expect(joinAssetUrl("../../embed/v1", "engine-1.0.0.js")).toBe("../../embed/v1/engine-1.0.0.js");
    expect(joinAssetUrl("../../embed/v1/", "engine-1.0.0.js")).toBe("../../embed/v1/engine-1.0.0.js");
  });

  it("treats an empty base as 'beside the page'", () => {
    expect(joinAssetUrl("", "engine-1.0.0.js")).toBe("engine-1.0.0.js");
  });

  it("keeps references relative", () => {
    for (const url of Object.values(sharedAssetRefs("../../embed/v1", "1.9.0"))) {
      expect(url.startsWith("../../embed/v1/")).toBe(true);
      expect(url).not.toMatch(/^(?:[a-z]+:)?\/\//i);
    }
  });
});

describe("shared stylesheet", () => {
  it("carries the font as base64, which is what keeps file:// pages from falling back", () => {
    // Fonts are fetched in CORS mode and a file:// page has a null origin, so a separate font
    // file is blocked there — thumbnails and saved pages would render in a fallback face.
    const sheet = buildSharedStylesheet(".figure-card{color:red}");
    expect(sheet).toContain("@font-face");
    expect(sheet).toContain("data:font/ttf;base64,");
    expect(sheet).not.toMatch(/src:url\((?!data:)/);
    expect(sheet).toContain(".figure-card{color:red}");
  });
});
