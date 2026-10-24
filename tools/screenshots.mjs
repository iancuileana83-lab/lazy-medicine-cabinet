// Takes the README screenshots. The tables are seeded with the REAL model outputs stored in
// samples/generated/results-v2-prompt.json, so no model run is needed. Usage: node tools/screenshots.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { todayISO, addMonths } from '../lib/inventory.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const res = JSON.parse(fs.readFileSync(path.join(ROOT, 'samples/generated/results-v2-prompt.json'), 'utf8'));
const three = res.photos['5-three-boxes.jpg'].raw;
const side = res.photos['4-side-date-saline.jpg'].raw;
const one = res.photos['2-table-ibuprofen.jpg'].raw;
const vit = res.photos['3-shelf-vitamin.jpg'].raw;
const paracetamol = res.photos['1-shelf-paracetamol.jpg'].raw;

process.env.LMC_DATA = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lmc-shot-')), 'cabinet.json');
const { server } = await import('../server.mjs');
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://localhost:${server.address().port}`;
const out = (f) => path.join(ROOT, 'docs', f);
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });

const nextCheck = addMonths(todayISO(), 3);
const seed = (items) => fetch(`${base}/api/state`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items, nextCheck }) });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });

// 1. the cabinet after scanning: all five test photos' lines
await seed([...paracetamol, ...one, ...vit, ...three]);
await page.goto(base);
await page.locator('#rows tr').nth(5).waitFor();
await page.screenshot({ path: out('screenshot-cabinet.png'), fullPage: true });

// 2. a date the model got wrong is flagged, not guessed
await seed([...three, ...side]);
await page.reload();
await page.locator('.badge.unknown').waitFor();
await page.screenshot({ path: out('screenshot-unreadable-date.png'), fullPage: true });

// 3. pharmacy bag
await seed([...paracetamol, ...one, ...vit, ...three, ...side]);
await page.goto(`${base}/#bag`);
await page.reload(); // a hash-only goto does not reload, so the new data would not be loaded
await page.locator('#bag-list li').first().waitFor();
await page.screenshot({ path: out('screenshot-pharmacy-bag.png'), fullPage: true });

// 4. phone
const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await phone.goto(base);
await phone.locator('#rows tr').nth(3).waitFor();
await phone.locator('.controls').scrollIntoViewIfNeeded();
await phone.screenshot({ path: out('screenshot-phone.png') });

await browser.close();
server.close();
console.log('ok');
