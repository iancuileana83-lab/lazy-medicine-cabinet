// Pure helpers for the inventory views. Shared by the browser and the tests; no DOM, no network.
import { statusFor } from './status.mjs';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const todayISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// '2026-10-31' + 4 months -> '2027-02-28' (day is clamped to the end of the target month)
export function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

export function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// Time left under each status. Days are counted to the last valid day (month-only dates: end of that month).
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export function timeLeft(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) return '';
  if (daysLeft < 0) {
    const d = -daysLeft;
    if (d < 60) return `Expired ${plural(d, 'day')} ago`;
    const months = Math.round(d / 30.44);
    if (months < 24) return `Expired ${plural(months, 'month')} ago`;
    return `Expired ${plural(Math.round(d / 365.25), 'year')} ago`;
  }
  if (daysLeft === 0) return 'Expires today';
  if (daysLeft === 1) return '1 day left';
  if (daysLeft <= 30) return `Expires in ${daysLeft} days`;
  if (daysLeft < 120) return `${daysLeft} days left`;
  const months = Math.round(daysLeft / 30.44);
  if (months < 24) return `about ${months} months left`;
  return `about ${Math.round(daysLeft / 365.25)} years left`;
}

export const isDue = (nextCheck, today) => !!nextCheck && nextCheck <= today;
export const isBlank = (it) => !it.name.trim() && !it.expiry.trim();

// Counts per status. Empty lines (just added, nothing typed yet) are not counted.
export function summarize(items, today) {
  const c = { expired: 0, soon30: 0, soon90: 0, ok: 0, unknown: 0 };
  for (const it of items) if (!isBlank(it)) c[statusFor(it.expiry, today).status]++;
  return c;
}

export const FILTERS = ['all', 'expired', 'soon30', 'soon90', 'ok', 'unknown'];

// Rows keep their index in the stored list so edits go to the right item after filtering or sorting.
export function view(items, today, { filter = 'all', sort = 'earliest' } = {}) {
  const rows = items.map((item, index) => ({ item, index, st: statusFor(item.expiry, today) }));
  const out = filter === 'all' ? rows : rows.filter((r) => r.st.status === filter);
  const byDate = (dir) => (a, b) => {
    if (a.st.iso === b.st.iso) return a.index - b.index;
    if (!a.st.iso) return 1; // unreadable dates always last
    if (!b.st.iso) return -1;
    return dir * (a.st.iso < b.st.iso ? -1 : 1);
  };
  if (sort === 'earliest') out.sort(byDate(1));
  else if (sort === 'latest') out.sort(byDate(-1));
  else if (sort === 'name') out.sort((a, b) => a.item.name.localeCompare(b.item.name) || a.index - b.index);
  return out;
}

// What goes in the pharmacy bag: expired items, plus lines whose date could not be read.
export function bagLists(items, today) {
  const rows = view(items, today, { sort: 'earliest' });
  return {
    expired: rows.filter((r) => r.st.status === 'expired'),
    unknown: rows.filter((r) => r.st.status === 'unknown' && !isBlank(r.item)),
  };
}

// Accepts the old format (a bare array) and the new one; always returns a clean state.
// `photo` is either "<16 hex>.jpg" (a scanned photo kept in data/photos) or "demo:<file>.jpg" (a generated test photo).
// Anything else is dropped, so a hand-edited data file cannot point the server at other files.
export const PHOTO_REF = /^(?:demo:[A-Za-z0-9_-]+|[0-9a-f]{16})\.jpg$/;

export function normalizeState(raw) {
  const obj = Array.isArray(raw) ? { items: raw } : raw && typeof raw === 'object' ? raw : {};
  const items = (Array.isArray(obj.items) ? obj.items : []).map((x) => {
    const it = { name: String(x?.name ?? ''), expiry: String(x?.expiry ?? '') };
    if (typeof x?.photo === 'string' && PHOTO_REF.test(x.photo)) it.photo = x.photo;
    if (x?.demo === true) it.demo = true;
    return it;
  });
  const nextCheck = typeof obj.nextCheck === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.nextCheck) ? obj.nextCheck : null;
  return { items, nextCheck };
}
