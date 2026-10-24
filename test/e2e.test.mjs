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

const names = (page) => page.locator('[data-k=name]').evaluateAll((els) => els.map((e) => e.value));

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

  // time left under each status, coloured rows, and a thumbnail for every scanned line
  assert.match(await page.locator('tr.r-expired .left').innerText(), /^Expired \d+ years? ago$/);
  assert.equal(await page.locator('tr.r-soon30 .left').innerText(), 'Expires in 10 days');
  // rows are sorted earliest first: Alpha, Bravo, Charlie, Delta (unreadable date last)
  assert.match(await page.locator('#rows tr').nth(2).locator('.left').innerText(), /years left$/);
  assert.equal(await page.locator('#rows tr').nth(3).locator('.left').count(), 0); // unreadable date: only the "Date not found" message
  assert.equal(await page.locator('tr.r-expired').count(), 1);
  assert.equal(await page.locator('tr.r-soon30').count(), 1);
  const bg = (sel) => page.locator(sel).first().evaluate((tr) => getComputedStyle(tr.querySelector('td:nth-child(2)')).backgroundColor);
  assert.equal(await bg('tr.r-expired'), 'rgb(253, 236, 235)'); // light red
  assert.equal(await bg('tr.r-soon30'), 'rgb(255, 242, 217)'); // light amber
  assert.equal(await page.locator('.thumb img').count(), 4);
  const photoFiles = () => (fs.existsSync(path.join(path.dirname(dataFile), 'photos')) ? fs.readdirSync(path.join(path.dirname(dataFile), 'photos')) : []);
  assert.equal(photoFiles().length, 1); // one photo, kept on this computer
  await page.locator('.thumb').first().click();
  await page.locator('#lightbox').waitFor();
  assert.match(await page.locator('#lightbox').innerText(), /Source photo\. Check the line against the real box\./);
  assert.ok((await page.locator('#lb-img').evaluate((i) => i.complete && i.naturalWidth)) > 0); // the photo really loads
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('#lightbox').isHidden());
  await page.locator('.thumb').first().click();
  await page.getByRole('button', { name: 'Close' }).click();
  assert.ok(await page.locator('#lightbox').isHidden());

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
  assert.match(await page.locator('#confirm').innerText(), /Remove all medicines and their saved photos from this list\? This cannot be undone\./);
  await page.getByRole('button', { name: 'Cancel' }).click();
  assert.equal((await names(page)).length, 4);
  assert.equal(photoFiles().length, 1); // Cancel keeps the photo
  await page.getByRole('button', { name: 'Clear all' }).click();
  await page.getByRole('button', { name: 'Remove all' }).click();
  assert.equal((await names(page)).length, 0);
  await page.reload();
  assert.equal((await names(page)).length, 0);
  assert.equal(JSON.parse(fs.readFileSync(dataFile, 'utf8')).items.length, 0);
  assert.equal(photoFiles().length, 0); // Clear all deleted the photo from the disk

  assert.deepEqual(external, []);
  await ctx.close();
});

const putState = (state) => fetch(`${base}/api/state`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
const photosDir = () => path.join(path.dirname(dataFile), 'photos');
const photoFiles = () => (fs.existsSync(photosDir()) ? fs.readdirSync(photosDir()) : []);

test('a saved photo is deleted when the last line that uses it is removed', async () => {
  await putState({ items: [], nextCheck: '2030-01-01' });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(base);
  await page.setInputFiles('#photo', PHOTO);
  await page.locator('#rows tr').nth(3).waitFor();
  assert.equal(photoFiles().length, 1);
  for (let left = 3; left >= 1; left--) {
    await page.getByRole('button', { name: 'Remove' }).first().click();
    await page.locator('#rows tr').nth(left - 1).waitFor();
    assert.equal(photoFiles().length, 1, `still used by ${left} line(s)`);
  }
  await page.getByRole('button', { name: 'Remove' }).first().click();
  await page.locator('#empty').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('#rows tr').length === 0);
  assert.equal(photoFiles().length, 0);
  await ctx.close();
});

test('the photo URLs only serve our own files', async () => {
  for (const p of ['/photos/..%2Fserver.mjs', '/photos/0123456789abcdef.jpg', '/photos/../server.mjs', '/demo-photos/server.mjs', '/demo-photos/..%2Fserver.mjs']) {
    assert.equal((await fetch(base + p)).status, 404, p);
  }
  const r = await fetch(`${base}/demo-photos/1-shelf-paracetamol.jpg`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/jpeg');
});

// Every product-name field must be at least one normal line tall and show all of its text.
const assertNamesReadable = async (page, where) => {
  const m = await page.locator('[data-k=name]').evaluateAll((els) => els.map((e) => ({ h: e.clientHeight, clipped: e.scrollHeight > e.clientHeight + 1 })));
  assert.ok(m.length > 0, where);
  for (const [i, x] of m.entries()) {
    assert.ok(x.h >= 36, `${where}: name field ${i} is only ${x.h}px tall`);
    assert.equal(x.clipped, false, `${where}: name field ${i} cuts off its text`);
  }
};

test('demo flow from the empty state: name fields are readable and the demo banner sits above the list (desktop and phone)', async () => {
  for (const [label, viewport] of [['desktop', { width: 1100, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    await putState({ items: [], nextCheck: '2030-01-01' });
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.getByRole('button', { name: 'Try the demo cabinet' }).click(); // the table was hidden until now
    await page.locator('#rows tr').nth(6).waitFor();
    await assertNamesReadable(page, `${label} after demo`);
    const box = await page.evaluate(() => {
      const r = (id) => document.getElementById(id).getBoundingClientRect();
      return { banner: r('demo-banner'), button: r('demo-remove'), table: r('table') };
    });
    assert.ok(box.banner.height > 0 && box.button.height > 0, `${label}: demo banner and button are visible`);
    assert.ok(box.banner.bottom <= box.table.top, `${label}: banner is above the list`);
    // switching tabs and back must not squash the fields either
    await page.getByRole('tab', { name: 'About' }).click();
    await page.getByRole('tab', { name: 'Cabinet' }).click();
    await assertNamesReadable(page, `${label} after tab switch`);
    // a hand-typed long name grows the field and stays readable
    await page.getByRole('button', { name: 'Add a line' }).click();
    await page.locator('[data-k=name]').last().fill('A rather long product name as printed on the box, with brand, medicine, strength 500 mg and the pack size 20 coated tablets');
    await assertNamesReadable(page, `${label} after typing`);
    await ctx.close();
  }
});

test('demo cabinet: seven fictional boxes, clearly labelled, removable without touching your own lines', async () => {
  await putState({ items: [], nextCheck: '2030-01-01' });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(base);
  assert.ok(await page.locator('#empty').isVisible());
  assert.match(await page.locator('#empty').innerText(), /No medicines yet\. Add a photo, or add a line by hand\./);
  assert.match(await page.locator('#empty').innerText(), /Not ready to scan yet\? Look around with seven fictional boxes\./);
  assert.ok(await page.locator('.empty-art').isVisible());
  assert.ok(await page.locator('#demo-banner').isHidden());

  await page.getByRole('button', { name: 'Try the demo cabinet' }).click();
  await page.locator('#rows tr').nth(6).waitFor();
  assert.equal(await page.locator('#rows tr').count(), 7);
  assert.match(await page.locator('#demo-banner').innerText(), /Demo data: fictional boxes\. These lines were read by Gemma from generated test photos\./);
  assert.equal(await page.locator('.thumb img').count(), 7);
  assert.ok((await page.locator('.thumb img').first().evaluate((i) => i.complete && i.naturalWidth)) > 0); // demo photos load
  assert.ok((await names(page)).includes('Kalmora Paracetamol 500 mg 20 tablets'));

  // add a line of your own, then remove only the demo lines
  await page.getByRole('button', { name: 'Add a line' }).click();
  await page.locator('#rows tr').nth(7).waitFor();
  await page.locator('[data-k=name]').last().fill('My own box');
  await page.locator('[data-k=name]').last().blur();
  await page.getByRole('button', { name: 'Remove demo data' }).click();
  await page.waitForFunction(() => document.querySelectorAll('#rows tr').length === 1);
  assert.deepEqual(await names(page), ['My own box']);
  assert.ok(await page.locator('#demo-banner').isHidden());
  assert.equal(JSON.parse(fs.readFileSync(dataFile, 'utf8')).items.some((i) => i.demo), false);
  await ctx.close();
});

test('long product names wrap and grow instead of being cut off', async () => {
  await putState({ items: [{ name: 'Short', expiry: '01/2099' }, { name: 'A very long product name as printed on the box, with the brand, the medicine, the strength 500 mg and the pack size 20 coated tablets', expiry: '01/2099' }], nextCheck: '2030-01-01' });
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(base);
  await page.locator('#rows tr').nth(1).waitFor();
  const m = await page.locator('[data-k=name]').evaluateAll((els) => els.map((e) => ({ h: e.clientHeight, clipped: e.scrollHeight > e.clientHeight + 1 })));
  assert.equal(m[0].clipped, false);
  assert.equal(m[1].clipped, false); // everything is visible
  assert.ok(m[1].h > m[0].h * 1.8, `long name field (${m[1].h}px) should be taller than the short one (${m[0].h}px)`);
  await ctx.close();
});

test('phone layout: no sideways scrolling, rows stack as cards', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(base);
  await page.getByRole('button', { name: 'Add a line' }).click();
  await page.locator('[data-k=name]').first().fill('A rather long product name to test wrapping 500 mg 20 tablets');
  await page.locator('[data-k=name]').first().blur();
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

