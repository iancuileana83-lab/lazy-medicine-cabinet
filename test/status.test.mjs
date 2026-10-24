import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExpiry, statusFor } from '../lib/status.mjs';

const iso = (s) => parseExpiry(s)?.date.toISOString().slice(0, 10);

test('month-only dates end on the last day of that month', () => {
  assert.equal(iso('EXP 03/2027'), '2027-03-31');
  assert.equal(parseExpiry('EXP 03/2027').monthOnly, true);
  assert.equal(iso('02/2028'), '2028-02-29'); // leap year
  assert.equal(iso('02/2027'), '2027-02-28');
  assert.equal(iso('10-26'), '2026-10-31');
  assert.equal(iso('2026-10'), '2026-10-31');
  assert.equal(iso('OCT 2026'), '2026-10-31');
  assert.equal(iso('Exp: October 2026'), '2026-10-31');
});

test('full dates are day-first or ISO', () => {
  assert.equal(iso('31/10/2026'), '2026-10-31');
  assert.equal(iso('15.06.27'), '2027-06-15');
  assert.equal(iso('2026-10-31'), '2026-10-31');
  assert.equal(parseExpiry('31/10/2026').monthOnly, false);
});

test('garbage and impossible dates are unknown', () => {
  for (const bad of ['', 'LOT 12345', '13/2027', '31/02/2027', '00/2027', null, undefined]) assert.equal(parseExpiry(bad), null);
  assert.equal(statusFor('???', '2026-10-24').status, 'unknown');
});

test('status boundaries', () => {
  const t = '2026-10-24';
  assert.equal(statusFor('23/10/2026', t).status, 'expired');
  assert.equal(statusFor('24/10/2026', t).status, 'soon30'); // today is still valid
  assert.equal(statusFor('23/11/2026', t).status, 'soon30'); // 30 days
  assert.equal(statusFor('24/11/2026', t).status, 'soon90'); // 31 days
  assert.equal(statusFor('22/01/2027', t).status, 'soon90'); // 90 days
  assert.equal(statusFor('23/01/2027', t).status, 'ok'); // 91 days
});

test('month-only date stays valid through the end of the month', () => {
  assert.equal(statusFor('10/2026', '2026-10-31').status, 'soon30');
  assert.equal(statusFor('10/2026', '2026-11-01').status, 'expired');
});
