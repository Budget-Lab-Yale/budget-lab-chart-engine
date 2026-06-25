// Build a single self-contained HTML page embedding every example chart for local testing.
// Inlines the live bundle + CSS ONCE, then mounts each chart into its own container.
//   node scripts/build-gallery.mjs
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { CHART_CSS } from "../dist/embed/styles.js";
import { loadData } from "../dist/data/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Render order (the figure numbering).
const CHARTS = [
  ["F1", "F1_revenue_headline"],
  ["F2", "F2_revenue_by_income_type"],
  ["F3", "F3_revenue_by_instrument"],
  ["F4", "F4_revenue_vs_factor_income"],
  ["F5", "F5_revenue_fixed_vs_reallocated"],
  ["F6", "F6_inequality_gini"],
  ["F7", "F7_atr_by_decile"],
  ["FA1", "FA1_gdp_growth_history"],
  ["FA2", "FA2_labor_share_history"],
  ["FA3", "FA3_revenue_vs_pretax_income"],
  ["FA4", "FA4_debt_to_gdp"],
];

const safeJson = (v) => JSON.stringify(v).replace(/</g, "\\u003c");

const liveBundle = (await readFile(resolve(root, "dist/embed/live.js"), "utf8")).replace(
  /<\/script/gi,
  "<\\/script",
);

const sections = [];
const mounts = [];
let i = 0;
for (const [fig, dir] of CHARTS) {
  const base = resolve(root, "examples", dir);
  const spec = parseYaml(await readFile(resolve(base, "chart.yaml"), "utf8"));
  const rows = await loadData(spec.data, { baseDir: base });
  const id = `chart-${i}`;
  sections.push(
    `<section class="card"><div class="eyebrow">${fig} &middot; <code>${dir}</code></div>` +
      `<div id="${id}"></div></section>`,
  );
  mounts.push(
    `BudgetLabChart.mountChart(document.getElementById(${safeJson(id)}), { spec: ${safeJson(spec)}, rows: ${safeJson(rows)}, downloadName: ${safeJson(dir)} });`,
  );
  i++;
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI-Fiscal charts — test gallery</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
${CHART_CSS}
body { margin: 0; background: #f4f5f7; font-family: Figtree, system-ui, sans-serif; color: #1f2430; }
.page { max-width: 880px; margin: 0 auto; padding: 32px 16px 80px; }
.page > h1 { font-size: 20px; margin: 0 0 4px; }
.page > p { color: #5a6270; margin: 0 0 24px; font-size: 14px; }
.card { background: #fff; border: 1px solid #e4e7ec; border-radius: 10px; padding: 20px 22px; margin: 18px 0; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
.eyebrow { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #8a9099; margin-bottom: 10px; }
.eyebrow code { text-transform: none; letter-spacing: 0; font-weight: 500; color: #5a6270; }
</style>
</head>
<body>
<div class="page">
<h1>AI-Fiscal charts — test gallery</h1>
<p>${CHARTS.length} charts, one embed each. Hover for tooltips; click/hover legends to filter.</p>
${sections.join("\n")}
</div>
<script>
${liveBundle}
</script>
<script>
${mounts.join("\n")}
</script>
</body>
</html>`;

const out = resolve(root, "examples", "gallery.html");
await writeFile(out, html, "utf8");
console.log("Wrote", out, `(${(html.length / 1024 / 1024).toFixed(1)} MB, ${CHARTS.length} charts)`);
