import test from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, formatDate, isDue, summarize, view, bagLists, normalizeState } from '../lib/inventory.mjs';

const T = '2026-10-24';
const items = [
  { name: 'Zeta', expiry: '12/2026' }, // soon90
  { name: 'Alpha', expiry: '2025-11' }, // expired
  { name: 'Mid', expiry: '??' }, // unknown
  { name: 'Beta', expiry: '01/2028' }, // ok
  { name: 'Gamma', expiry: '03/2026' }, // expired
  { name: '', expiry: '' }, // blank line, not counted
];

test('addMonths clamps to the end of the month and rolls the year', () => {
  assert.equal(addMonths('2026-10-24', 3), '2027-01-24');
  assert.equal(addMonths('2026-11-30', 3), '2027-02-28');
  assert.equal(addMonths('2027-11-30', 3), '2028-02-29');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
});

test('formatDate and isDue', () => {
  assert.equal(formatDate('2027-01-24'), '24 January 2027');
  assert.equal(isDue('2026-10-24', T), true);
  assert.equal(isDue('2026-10-25', T), false);
  assert.equal(isDue(null, T), false);
});

test('summarize counts each status and ignores blank lines', () => {
  assert.deepEqual(summarize(items, T), { expired: 2, soon30: 0, soon90: 1, ok: 1, unknown: 1 });
});

test('filter and sort keep the stored index; unreadable dates go last', () => {
  assert.deepEqual(view(items, T, { filter: 'expired', sort: 'earliest' }).map((r) => r.item.name), ['Alpha', 'Gamma']); // 2025-11 before 2026-03
  assert.deepEqual(view(items, T, { filter: 'expired', sort: 'earliest' }).map((r) => r.index), [1, 4]);
  assert.deepEqual(view(items, T, { sort: 'earliest' }).map((r) => r.item.name).slice(0, 5), ['Alpha', 'Gamma', 'Zeta', 'Beta', 'Mid']);
  assert.deepEqual(view(items, T, { sort: 'latest' }).map((r) => r.item.name).slice(0, 5), ['Beta', 'Zeta', 'Gamma', 'Alpha', 'Mid']);
  assert.deepEqual(view(items, T, { sort: 'name' }).map((r) => r.item.name).slice(0, 3), ['', 'Alpha', 'Beta']);
  assert.equal(view(items, T, { filter: 'unknown' }).length, 2); // 'Mid' and the blank line
});

test('pharmacy bag lists expired items first-expired-first and unreadable dates separately', () => {
  const b = bagLists(items, T);
  assert.deepEqual(b.expired.map((r) => r.item.name), ['Alpha', 'Gamma']);
  assert.deepEqual(b.unknown.map((r) => r.item.name), ['Mid']);
});

test('normalizeState migrates the old array format and drops junk', () => {
  assert.deepEqual(normalizeState([{ name: 'A', expiry: 'x' }]), { items: [{ name: 'A', expiry: 'x' }], nextCheck: null });
  assert.deepEqual(normalizeState({ items: [{ name: 5 }, null], nextCheck: '2027-01-24' }), { items: [{ name: '5', expiry: '' }, { name: '', expiry: '' }], nextCheck: '2027-01-24' });
  assert.deepEqual(normalizeState({ nextCheck: 'soon' }), { items: [], nextCheck: null });
  assert.deepEqual(normalizeState(null), { items: [], nextCheck: null });
});
