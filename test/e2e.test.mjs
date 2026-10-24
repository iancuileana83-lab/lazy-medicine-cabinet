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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PHOTO = path.join(HERE, '..', 'samples', 'generated', '1-shelf-paracetamol.jpg');

let fake, app, browser, base, chatBodies = [];
const external = [];

before(async () => {
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      if (req.url === '/api/chat') chatBodies.push(JSON.parse(b));
      res.setHeader('Content-Type', 'application/json');
      res.end(req.url === '/api/chat'
        ? JSON.stringify({ message: { content: JSON.stringify({ items: [{ name: 'Kalmora Paracetamol 500 mg', expiry: 'EXP 01/2099' }] }) } })
        : JSON.stringify({ models: [] }));
    });
  });
  await new Promise((ok) => fake.listen(0, '127.0.0.1', ok));
  process.env.OLLAMA_URL = `http://127.0.0.1:${fake.address().port}`;
  process.env.LMC_DATA = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lmc-e2e-')), 'cabinet.json');
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

test('scan a photo, correct a line by hand, see the reminder, keep data after reload', async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // Nothing may leave the machine: record every request that is not to the local app.
  // (blob: and data: URLs are in-page previews, not network traffic.)
  page.on('request', (r) => { if (/^https?:/.test(r.url()) && !r.url().startsWith(base)) external.push(r.url()); });

  await page.goto(base);
  await page.getByText('can misread labels').waitFor();
  assert.match(await page.locator('.disclaimer').innerText(), /no medical advice, doses or interaction information/);
  assert.match(await page.locator('.note').innerText(), /Month-only dates are treated as the end of that month\./);

  await page.setInputFiles('#photo', PHOTO);
  await page.locator('#rows tr').first().waitFor();
  assert.equal(await page.locator('input[data-k=name]').first().inputValue(), 'Kalmora Paracetamol 500 mg');
  assert.equal(await page.locator('.badge').first().innerText(), 'OK');
  assert.ok(await page.locator('#reminder').isHidden());
  assert.equal(chatBodies.length, 1);
  assert.equal(chatBodies[0].messages[0].images.length, 1); // the photo went to the (local) model

  // hand correction to a past date
  await page.locator('input[data-k=expiry]').first().fill('EXP 10/2020');
  await page.locator('input[data-k=expiry]').first().blur();
  await page.locator('.badge.expired').waitFor();
  assert.equal(await page.locator('.badge').first().innerText(), 'Expired');
  assert.match(await page.locator('#reminder').innerText(), /Take them back to a pharmacy for safe disposal/);

  // unreadable date asks for a manual check
  await page.locator('input[data-k=expiry]').first().fill('LOT 123');
  await page.locator('input[data-k=expiry]').first().blur();
  await page.locator('.badge.unknown').waitFor();
  assert.match(await page.locator('.badge').first().innerText(), /Date not found, please check the box/);

  await page.reload();
  await page.locator('#rows tr').first().waitFor();
  assert.equal(await page.locator('input[data-k=expiry]').first().inputValue(), 'LOT 123');

  assert.deepEqual(external, []);
  await ctx.close();
});

test('server only answers to localhost hosts', async () => {
  // fetch() ignores a custom Host header, so use http.request.
  const status = await new Promise((ok, no) => {
    http.get({ host: '127.0.0.1', port: app.address().port, path: '/api/items', headers: { Host: 'evil.example' } }, (res) => { res.resume(); ok(res.statusCode); }).on('error', no);
  });
  assert.equal(status, 403);
});
