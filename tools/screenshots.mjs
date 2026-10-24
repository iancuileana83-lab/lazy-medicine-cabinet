// Takes the README screenshots. The tables are seeded with the REAL model outputs stored in
// samples/generated/results-v2-prompt.json, so no model run is needed. Usage: node tools/screenshots.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const res = JSON.parse(fs.readFileSync(path.join(ROOT, 'samples/generated/results-v2-prompt.json'), 'utf8'));
const three = res.photos['5-three-boxes.jpg'].raw;
const side = res.photos['4-side-date-saline.jpg'].raw;

process.env.LMC_DATA = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lmc-shot-')), 'cabinet.json');
const { server } = await import('../server.mjs');
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://localhost:${server.address().port}`;
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const seed = (items) => fetch(`${base}/api/items`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(items) });

await seed(three);
await page.goto(base);
await page.locator('#rows tr').nth(2).waitFor();
await page.screenshot({ path: path.join(ROOT, 'docs/screenshot-results.png') });

await seed([...three, ...side]);
await page.reload();
await page.locator('.badge.unknown').waitFor();
await page.screenshot({ path: path.join(ROOT, 'docs/screenshot-unreadable-date.png') });

await browser.close();
server.close();
console.log('ok');
