import { chromium } from "playwright";
const dir = "C:/Users/ask76/AppData/Local/Temp/claude/C--dev-GitHub-budget-lab-chart-engine/91f8cb3e-9087-4e09-9ccc-4633911e3ed3/scratchpad";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 1200 }, deviceScaleFactor: 1.5 });
await p.goto("file://" + dir + "/fig7-v13.html");
await p.waitForTimeout(900);
await p.screenshot({ path: dir + "/fig7-v13-full.png", fullPage: true });
await b.close(); console.log("ok");
