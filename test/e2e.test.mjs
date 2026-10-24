// End-to-end: real browser + the real app server, with a tiny stand-in for Ollama so the test is fast and deterministic.
// Needs: npm install (playwright) and `npx playwright install chromium` once.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { todayISO, addMonths, formatDate } from '../lib/inventory.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PHOTO = path.join(HERE, '..', 'samples', 'generated', '1-shelf-paracetamol.jpg');
const today = todayISO();
const inDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};
const READ = [
  { name: 'Alpha expired', expiry: 'EXP 10/2020' },
  { name: 'Bravo soon', expiry: inDays(10) },
  { name: 'Charlie fine', expiry: 'EXP 01/2099' },
  { name: 'Delta unreadable', expiry: 'LOT 123' },
];

let fake, app, browser, base, dataFile;
const chatBodies = [];
const external = [];

before(async () => {
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      if (req.url === '/api/chat') chatBodies.push(JSON.parse(b));
      res.setHeader('Content-Type', 'application/json');
      res.end(req.url === '/api/chat' ? JSON.stringify({ message: { content: JSON.stringify({ items: READ }) } }) : JSON.stringify({ models: [] }));
    });
  });
  await new Promise((ok) => fake.listen(0, '127.0.0.1', ok));
  process.env.OLLAMA_URL = `http://127.0.0.1:${fake.address().port}`;
  dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lmc-e2e-')), 'cabinet.json');
  process.env.LMC_DATA = dataFile;
  ({ server: app } = await import('../server.mjs'));
  await new Promise((ok) => app.listen(0, '127.0.0.1', ok));
  base = `http://localhost:${app.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  app?.close();
  fake?.close();
});

const names = (page) => page.locator('input[data-k=name]').evaluateAll((els) => els.map((e) => e.value));

test('scan, summary cards, filter and sort, pharmacy bag, next check, persistence, clear all', async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // Nothing may leave the machine. (blob: and data: URLs are in-page previews, not network traffic.)
  page.on('request', (r) => { if (/^https?:/.test(r.url()) && !r.url().startsWith(base)) external.push(r.url()); });

  await page.goto(base);
  assert.match(await page.locator('.disclaimer').innerText(), /no medical advice, doses or interaction information/);
  assert.equal(await page.locator('[role=tab]').count(), 3);
  assert.equal(await page.locator('#nextcheck-text').innerText(), `Next check: ${formatDate(addMonths(today, 3))}`);
  assert.ok(await page.locator('#nextcheck-due').isHidden());
  assert.match(await page.locator('.note').innerText(), /Month-only dates are treated as the end of that month\./);

  // scan -> 4 lines
  await page.setInputFiles('#photo', PHOTO);
  await page.locator('#rows tr').nth(3).waitFor();
  assert.equal(chatBodies.length, 1);
  assert.equal(chatBodies[0].messages[0].images.length, 1); // the photo went to the (local) model

  // summary cards
  const count = (s) => page.locator(`.sum[data-status=${s}] .n`).innerText();
  assert.deepEqual([await count('expired'), await count('soon30'), await count('soon90'), await count('ok')], ['1', '1', '0', '1']);
  assert.match(await page.locator('#summary-unknown').innerText(), /Date not found: 1\. Please check these boxes by hand\./);
  assert.match(await page.locator('#reminder').innerText(), /Take them back to a pharmacy for safe disposal/);

  // sort: earliest first puts the expired one first and the unreadable date last; latest first reverses the dates
  assert.deepEqual(await names(page), ['Alpha expired', 'Bravo soon', 'Charlie fine', 'Delta unreadable']);
  await page.selectOption('#sort', 'latest');
  assert.deepEqual(await names(page), ['Charlie fine', 'Bravo soon', 'Alpha expired', 'Delta unreadable']);
  await page.selectOption('#sort', 'name');
  assert.deepEqual(await names(page), ['Alpha expired', 'Bravo soon', 'Charlie fine', 'Delta unreadable']);

  // filter by the dropdown and by clicking a card (click again clears it)
  await page.selectOption('#filter', 'ok');
  assert.deepEqual(await names(page), ['Charlie fine']);
  await page.selectOption('#filter', 'all');
  await page.locator('.sum[data-status=expired]').click();
  assert.deepEqual(await names(page), ['Alpha expired']);
  await page.locator('.sum[data-status=expired]').click();
  assert.equal((await names(page)).length, 4);

  // pharmacy bag
  await page.getByRole('tab', { name: /Pharmacy bag/ }).click();
  assert.ok(await page.locator('#panel-cabinet').isHidden());
  assert.deepEqual(await page.locator('#bag-list .nm').allInnerTexts(), ['Alpha expired']);
  assert.deepEqual(await page.locator('#bag-unknown .nm').allInnerTexts(), ['Delta unreadable']);
  assert.equal(await page.locator('#bag-count').innerText(), '1');
  assert.match(await page.locator('#bag').innerText(), /Expired medicines to take back to a pharmacy for safe disposal/);
  assert.ok(await page.getByRole('button', { name: 'Print this list' }).isVisible());
  assert.equal(await page.locator('#printhead').textContent(), `Take-back list, printed ${formatDate(today)}`);

  // fixing the date by hand empties the bag
  await page.getByRole('tab', { name: 'Cabinet' }).click();
  await page.locator('input[data-k=expiry]').first().fill('EXP 01/2099');
  await page.locator('input[data-k=expiry]').first().blur();
  await page.getByRole('tab', { name: /Pharmacy bag/ }).click();
  assert.ok(await page.locator('#bag-empty').isVisible());
  assert.equal(await page.locator('#bag-list li').count(), 0);

  // about tab
  await page.getByRole('tab', { name: 'About' }).click();
  assert.match(await page.locator('#panel-about').innerText(), /Nothing leaves this laptop\. No cloud services, no accounts, no analytics\./);

  // next check can be changed and survives a reload, together with the list
  await page.getByRole('tab', { name: 'Cabinet' }).click();
  await page.locator('#nextcheck-change').click();
  await page.locator('#nextcheck-input').fill('2020-01-05');
  assert.equal(await page.locator('#nextcheck-text').innerText(), 'Next check: 5 January 2020');
  assert.ok(await page.locator('#nextcheck-due').isVisible());
  await page.reload();
  await page.locator('#rows tr').first().waitFor();
  assert.equal(await page.locator('#nextcheck-text').innerText(), 'Next check: 5 January 2020');
  assert.equal((await names(page)).length, 4);
  assert.equal(JSON.parse(fs.readFileSync(dataFile, 'utf8')).items.length, 4); // saved to disk

  // clear all asks first; Cancel keeps the list
  await page.getByRole('button', { name: 'Clear all' }).click();
  assert.match(await page.locator('#confirm').innerText(), /Remove all medicines from this list\? This cannot be undone\./);
  await page.getByRole('button', { name: 'Cancel' }).click();
  assert.equal((await names(page)).length, 4);
  await page.getByRole('button', { name: 'Clear all' }).click();
  await page.getByRole('button', { name: 'Remove all' }).click();
  assert.equal((await names(page)).length, 0);
  await page.reload();
  assert.equal((await names(page)).length, 0);
  assert.equal(JSON.parse(fs.readFileSync(dataFile, 'utf8')).items.length, 0);

  assert.deepEqual(external, []);
  await ctx.close();
});

test('phone layout: no sideways scrolling, rows stack as cards', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(base);
  await page.getByRole('button', { name: 'Add a line' }).click();
  await page.locator('input[data-k=name]').first().fill('A rather long product name to test wrapping 500 mg 20 tablets');
  await page.locator('input[data-k=name]').first().blur();
  for (const tab of ['Cabinet', 'Pharmacy bag', 'About']) {
    await page.getByRole('tab', { name: new RegExp(tab) }).click();
    const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    assert.ok(sw <= iw, `${tab}: page is ${sw}px wide in a ${iw}px window`);
  }
  await page.getByRole('tab', { name: 'Cabinet' }).click();
  assert.equal(await page.locator('thead').isVisible(), false); // header row hidden, cells carry their own labels
  await ctx.close();
});

test('server only answers to localhost hosts', async () => {
  // fetch() ignores a custom Host header, so use http.get.
  const status = await new Promise((ok, no) => {
    http.get({ host: '127.0.0.1', port: app.address().port, path: '/api/state', headers: { Host: 'evil.example' } }, (res) => { res.resume(); ok(res.statusCode); }).on('error', no);
  });
  assert.equal(status, 403);
});

test('old data files (a bare array) are migrated', async () => {
  fs.writeFileSync(dataFile, JSON.stringify([{ name: 'Old', expiry: '01/2099' }]));
  const s = await (await fetch(`${base}/api/state`)).json();
  assert.deepEqual(s, { items: [{ name: 'Old', expiry: '01/2099' }], nextCheck: null });
});
