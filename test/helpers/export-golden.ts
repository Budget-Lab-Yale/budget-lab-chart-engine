// Shared by the export goldens (test/export-golden.test.ts, test/table/export-golden.test.ts).
//
// Why this exists: every export SVG inlines the base64 Figtree font and the logo as `data:` URIs,
// about 100 KB per file, which would make each golden almost entirely asset bytes. Each `data:`
// payload is replaced with a stable token carrying its length and SHA-256, e.g.
// `data:font/ttf;base64,<sha256:ab12…;len=123456>`. The asset stays pinned by its hash, and every
// other byte of the serialised SVG is still compared verbatim.
//
// Serialisation is XMLSerializer, the serialiser `rasterize()` uses to turn the export SVG into a PNG.
import { createHash } from "node:crypto";

// `data:<mediatype>[;params],<payload>`; the payload ends at a quote, a paren or whitespace (how
// it is delimited in an attribute or a CSS `url(...)`).
const DATA_URI = /(data:[^,"'()\s]*,)([^"'()\s]+)/g;

export function serializeExportSvg(el: Element): string {
  return new XMLSerializer()
    .serializeToString(el)
    .replace(DATA_URI, (_m, head: string, payload: string) =>
      `${head}<sha256:${createHash("sha256").update(payload).digest("hex")};len=${payload.length}>`);
}
