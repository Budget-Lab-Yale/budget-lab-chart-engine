import { chromium } from 'playwright';

const url = 'http://localhost:8844/tools/taxes-at-the-top/index.html';
const shotDir = 'C:/Users/ask76/AppData/Local/Temp/claude/C--dev-GitHub/32a5169d-cdb9-4588-9979-42bc1ed896b0/scratchpad';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console.error: ' + msg.text()); });

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForSelector('#distChart svg', { timeout: 10000 });

// Turn on Corporate rate at max (28) for a real negative-delta scenario.
await page.locator('#rateSw .sw', { hasText: 'Corporate rate' }).click();
await page.waitForTimeout(150);
const dialInput = page.locator('#rateSw .lever.on input[type="number"]').first();
await dialInput.fill('28');
await dialInput.dispatchEvent('change');
await page.waitForTimeout(300);

// context: should be anchored to etrMax-based axis (fixed max regardless of view).
await page.locator('#distViewTog button[data-v="context"]').click();
await page.waitForTimeout(300);
const contextMax = await page.locator('#distChart svg text').allTextContents();
await page.screenshot({ path: `${shotDir}/recheck-context.png`, fullPage: true });

// etr: should share the SAME axis max as context (no rescale between the two).
await page.locator('#distViewTog button[data-v="etr"]').click();
await page.waitForTimeout(300);
const etrMax = await page.locator('#distChart svg text').allTextContents();
await page.screenshot({ path: `${shotDir}/recheck-etr.png`, fullPage: true });

// new: diverging, autoscaled to its own (much smaller) range.
await page.locator('#distViewTog button[data-v="new"]').click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${shotDir}/recheck-new.png`, fullPage: true });

function topTick(texts) {
  return texts.filter(t => /%$/.test(t.trim())).slice(0, 3);
}
console.log('context axis ticks (top few):', topTick(contextMax));
console.log('etr axis ticks (top few):', topTick(etrMax));

console.log('--- Console/page errors ---');
console.log(errors.length ? errors.join('\n') : '(none)');

await browser.close();
