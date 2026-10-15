// The CSV fixture reader the golden and treemap/timeline tests share. Not a test file.
//
// It is deliberately naive — a header row, then one row per line split on every comma, no quoting —
// because the goldens were recorded with exactly this parse. A stricter parser would read a fixture
// with a quoted comma differently and move the golden, so do not "fix" it here; a test that needs
// real CSV parsing should use `parseCsv` from src/data.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { TidyRow } from "../../src/data/index";

/** A reader for CSV fixtures named relative to `base` — pass the calling test file's
 *  `import.meta.url`, so `"./fixtures/x.csv"` resolves against that file's directory:
 *  `const parseCsv = csvFixtureReader(import.meta.url);` */
export function csvFixtureReader(base: string | URL): (path: string) => TidyRow[] {
  return (path) => {
    const text = readFileSync(fileURLToPath(new URL(path, base)), "utf8").trim();
    const [header, ...lines] = text.split(/\r?\n/);
    const cols = (header as string).split(",");
    return lines.map((line) => {
      const cells = line.split(",");
      const row: Record<string, string> = {};
      cols.forEach((c, i) => { row[c] = cells[i] ?? ""; });
      return row as TidyRow;
    });
  };
}
