// Takes the README screenshots by clicking through the real app. Nothing needs the model: the data comes from the
// demo cabinet, i.e. the REAL Gemma outputs stored in samples/generated/results-v2-prompt.json.
// Usage: node tools/screenshots.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.LMC_DATA = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lmc-shot-')), 'cabinet.json');
const { server } = await import('../server.mjs');
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://localhost:${server.address().port}`;
const out = (f) => path.join(ROOT, 'docs', f);
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
for (const old of ['screenshot-results.png']) fs.rmSync(out(old), { force: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
await page.goto(base);

// 1. empty state with the demo button
await page.locator('#empty').waitFor();
await page.screenshot({ path: out('screenshot-empty.png'), fullPage: true });

// 2. the cabinet with the demo loaded
await page.getByRole('button', { name: 'Try the demo cabinet' }).click();
await page.locator('#rows tr').nth(6).waitFor();
await page.waitForTimeout(400);
await page.screenshot({ path: out('screenshot-cabinet.png'), fullPage: true });

// 3. the source photo of a line, larger
await page.locator('.thumb').nth(3).click();
await page.locator('#lb-img').waitFor();
await page.waitForFunction(() => document.getElementById('lb-img').complete);
await page.screenshot({ path: out('screenshot-photo-viewer.png') });
await page.keyboard.press('Escape');

// 4. a date the model got wrong is flagged, not guessed
await page.selectOption('#filter', 'unknown');
await page.waitForTimeout(200);
await page.screenshot({ path: out('screenshot-unreadable-date.png'), fullPage: true });
await page.selectOption('#filter', 'all');

// 5. pharmacy bag
await page.getByRole('tab', { name: /Pharmacy bag/ }).click();
await page.locator('#bag-list li').first().waitFor();
await page.screenshot({ path: out('screenshot-pharmacy-bag.png'), fullPage: true });

// 6. phone
const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await phone.goto(base);
await phone.locator('#rows tr').nth(3).waitFor();
await phone.locator('.controls').scrollIntoViewIfNeeded();
await phone.screenshot({ path: out('screenshot-phone.png') });

await browser.close();
server.close();
console.log('ok');
